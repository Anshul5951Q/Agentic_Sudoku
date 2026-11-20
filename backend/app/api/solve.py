from typing import Literal

from fastapi import APIRouter, Depends, Header, Query, Response

from ..context import Context, get_ctx
from ..core.errors import APIError, check_id, not_found
from ..core.ids import new_id
from ..schemas import CheckpointSummary, SolveRequest, SolveRun, TERMINAL_STATUSES, TraceResponse
from ..services.agents import TERMINAL_EVENTS

router = APIRouter(prefix="/api/solve", tags=["solve"])


def _resolve(ctx: Context, body: SolveRequest) -> dict:
    if body.puzzle_id:
        check_id(body.puzzle_id, "puzzle_id")
        p = ctx.db.get_puzzle(body.puzzle_id)
        if not p:
            raise not_found("puzzle", body.puzzle_id)
        return p
    return ctx.db.create_puzzle(new_id("puzzle"), new_id("session"), body.board, None, "user")


def _start(mode: str, body: SolveRequest, ctx: Context, response: Response, idem: str | None) -> dict:
    puzzle = _resolve(ctx, body)
    cfg = {"strategy": body.strategy, "order": body.order, "max_nodes": body.max_nodes, "timeout_s": body.timeout_s}
    run, duplicate = ctx.runs.create(mode, puzzle["board"], puzzle, cfg, idem)
    response.status_code = 200 if duplicate else 202
    view = ctx.runs.view(run)
    view["duplicate"] = duplicate
    return view


@router.post("/cot", response_model=SolveRun, status_code=202, responses={200: {"model": SolveRun, "description": "Duplicate Idempotency-Key with an identical request: the existing run (duplicate=true)"}}, summary="Start a CoT attempt (frozen TA1 prompt, local Qwen)")
def solve_cot(body: SolveRequest, response: Response, ctx: Context = Depends(get_ctx),
              idempotency_key: str | None = Header(default=None)) -> dict:
    return _start("cot", body, ctx, response, idempotency_key)


@router.post("/tot", response_model=SolveRun, status_code=202, responses={200: {"model": SolveRun, "description": "Duplicate Idempotency-Key with an identical request: the existing run (duplicate=true)"}}, summary="Start a Tree-of-Thought search (checkpointed, pausable)")
def solve_tot(body: SolveRequest, response: Response, ctx: Context = Depends(get_ctx),
              idempotency_key: str | None = Header(default=None)) -> dict:
    return _start("tot", body, ctx, response, idempotency_key)


@router.post("/multi-agent", response_model=SolveRun, status_code=202, responses={200: {"model": SolveRun, "description": "Duplicate Idempotency-Key with an identical request: the existing run (duplicate=true)"}}, summary="Start a supervised multi-agent run with verified voting")
def solve_multi(body: SolveRequest, response: Response, ctx: Context = Depends(get_ctx),
                idempotency_key: str | None = Header(default=None)) -> dict:
    return _start("multi-agent", body, ctx, response, idempotency_key)


@router.get("/{run_id}", response_model=SolveRun, summary="Run status and result")
def get_run(run_id: str, ctx: Context = Depends(get_ctx)) -> dict:
    check_id(run_id, "run_id")
    return ctx.runs.view(ctx.runs.get(run_id))


@router.get("/{run_id}/trace", response_model=TraceResponse, summary="Persisted trace (events + search nodes); supports ?after= for catch-up")
def get_trace(run_id: str, response: Response, after: int = Query(default=-1, ge=-1), download: bool = False,
              ctx: Context = Depends(get_ctx)) -> dict:
    check_id(run_id, "run_id")
    run = ctx.runs.get(run_id)
    events = ctx.db.get_events(run_id, after)
    live = ctx.runs.is_live(run_id)
    if download:
        response.headers["Content-Disposition"] = f'attachment; filename="{run_id}-trace.json"'
    return {"run_id": run_id, "status": run["status"], "live": live, "recorded": not live and run["status"] in TERMINAL_STATUSES,
            "last_sequence": ctx.db.last_sequence(run_id), "terminal": run["status"] in TERMINAL_STATUSES,
            "events": events, "nodes": ctx.db.get_nodes(run_id)}


@router.post("/{run_id}/pause", response_model=SolveRun, summary="Pause at a safe checkpoint (acknowledged after state is persisted)")
def pause(run_id: str, ctx: Context = Depends(get_ctx)) -> dict:
    check_id(run_id, "run_id")
    return ctx.runs.view(ctx.runs.pause(run_id))


@router.post("/{run_id}/resume", response_model=SolveRun, summary="Resume from the saved checkpoint")
def resume(run_id: str, ctx: Context = Depends(get_ctx)) -> dict:
    check_id(run_id, "run_id")
    return ctx.runs.view(ctx.runs.resume(run_id))


@router.post("/{run_id}/cancel", response_model=SolveRun, summary="Cancel a run safely")
def cancel(run_id: str, ctx: Context = Depends(get_ctx)) -> dict:
    check_id(run_id, "run_id")
    return ctx.runs.view(ctx.runs.cancel(run_id))


@router.get("/{run_id}/checkpoint", response_model=CheckpointSummary, summary="Summary of the saved search checkpoint (what resume continues from)")
def checkpoint(run_id: str, ctx: Context = Depends(get_ctx)) -> dict:
    check_id(run_id, "run_id")
    return ctx.runs.checkpoint_summary(ctx.runs.get(run_id))
