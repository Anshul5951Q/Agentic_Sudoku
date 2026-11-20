from fastapi import APIRouter, Depends, Query

from ..context import Context, get_ctx
from ..core.errors import check_id, not_found
from ..schemas import SessionDetail, SessionList

router = APIRouter(prefix="/api/history", tags=["history"])


def run_summary(ctx: Context, r: dict) -> dict:
    res = r.get("result") or {}
    c = res.get("counters") or r.get("progress") or {}
    return {"run_id": r["run_id"], "mode": r["mode"], "status": r["status"], "created_at": r["created_at"],
            "finished_at": r["finished_at"], "outcome": res.get("outcome"), "verified": res.get("verified"),
            "nodes": c.get("nodes"), "pruned": c.get("pruned"), "backtracks": c.get("backtracks"),
            "elapsed_seconds": res.get("elapsed_seconds"), "llm_calls": res.get("llm_calls"), "resumable": ctx.runs.resumable(r)}


def session_summary(ctx: Context, s: dict) -> dict:
    puzzle = ctx.db.get_puzzle(s["puzzle_id"])
    runs = ctx.db.list_runs(s["session_id"])
    return {"session_id": s["session_id"], "puzzle_id": s["puzzle_id"], "title": s["title"], "board": puzzle["board"],
            "created_at": s["created_at"], "updated_at": s["updated_at"], "runs_count": len(runs),
            "last_run": run_summary(ctx, runs[0]) if runs else None}


@router.get("", response_model=SessionList, summary="List saved puzzle sessions (newest activity first)")
def list_history(limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0), ctx: Context = Depends(get_ctx)) -> dict:
    sessions, total = ctx.db.list_sessions(limit, offset)
    return {"total": total, "limit": limit, "offset": offset, "sessions": [session_summary(ctx, s) for s in sessions]}


@router.get("/{session_id}", response_model=SessionDetail, summary="Session with its puzzle and all runs")
def session_detail(session_id: str, ctx: Context = Depends(get_ctx)) -> dict:
    check_id(session_id, "session_id")
    s = ctx.db.get_session(session_id)
    if not s:
        raise not_found("session", session_id)
    return {"session": session_summary(ctx, s), "puzzle": ctx.db.get_puzzle(s["puzzle_id"]),
            "runs": [run_summary(ctx, r) for r in ctx.db.list_runs(session_id)]}
