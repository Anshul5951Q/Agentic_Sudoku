"""WebSocket event stream: persisted events with sequence numbers, catch-up via ?after=, explicit terminal message.

Protocol (JSON text frames):
  {"type":"event","event":<TraceEvent>}                      one persisted trace event
  {"type":"status","status":..., "last_sequence":N}          run status changes (separate from trace events)
  {"type":"terminal","status":..., "outcome":..., "last_sequence":N}   sent once, then the server closes (1000)
  {"type":"error","error":{...}}                             unknown run etc.; server closes with 4404
A reconnecting client passes ?after=<last sequence it processed>; events are only ever sent once per connection
and are read from SQLite, so the stream never depends on a live worker.
"""
import asyncio
import json

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from ..core.errors import APIError, ID_RE
from ..schemas import TERMINAL_STATUSES

router = APIRouter(tags=["websocket"])
POLL_S = 0.05


@router.websocket("/ws/solve/{run_id}")
async def ws_solve(ws: WebSocket, run_id: str, after: int = Query(default=-1, ge=-1)) -> None:
    ctx = ws.app.state.ctx
    await ws.accept()
    run = await asyncio.to_thread(ctx.db.get_run, run_id) if ID_RE.match(run_id) else None
    if not run:
        await ws.send_json(APIError(404, "RUN_NOT_FOUND", "run was not found", recoverable=False).body() | {"type": "error"})
        await ws.close(code=4404)
        return
    last, sent_status = after, None
    try:
        while True:
            events = await asyncio.to_thread(ctx.db.get_events, run_id, last, 500)
            for e in events:
                await ws.send_json({"type": "event", "event": e})
                last = e["sequence"]                     # monotonic: an event is never sent twice on this connection
            run = await asyncio.to_thread(ctx.db.get_run, run_id)
            if run["status"] != sent_status:
                sent_status = run["status"]
                await ws.send_json({"type": "status", "status": sent_status, "last_sequence": last})
            if run["status"] in TERMINAL_STATUSES and not events:
                # status is set only after the final events are stored, so an empty read here means fully drained
                res = run.get("result") or {}
                await ws.send_json({"type": "terminal", "status": run["status"], "outcome": res.get("outcome"),
                                    "verified": res.get("verified"), "last_sequence": last})
                await ws.close(code=1000)
                return
            if not events:
                await asyncio.sleep(POLL_S)
    except WebSocketDisconnect:
        return
