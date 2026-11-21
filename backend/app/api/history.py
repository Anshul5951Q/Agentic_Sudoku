from fastapi import APIRouter, Depends, Query

from ..context import Context, get_ctx
from ..core.errors import APIError, check_id, not_found
from ..schemas import RunComparison, SessionDetail, SessionList

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


COMPARE_FIELDS = ("outcome", "verified", "seconds", "nodes", "pruned", "backtracks", "dead_ends", "llm_calls", "tool_calls",
                  "solver_calls", "memory_confirmed")


@router.get("/compare", response_model=RunComparison, summary="Compare two stored runs of the same puzzle, metric by metric")
def compare(a: str, b: str, ctx: Context = Depends(get_ctx)) -> dict:
    from .analytics import _metrics
    check_id(a, "a")
    check_id(b, "b")
    if a == b:
        raise APIError(422, "SAME_RUN", "Pick two different runs to compare.")
    ra, rb = ctx.runs.get(a), ctx.runs.get(b)
    if ra["board"] != rb["board"]:
        raise APIError(422, "RUNS_NOT_COMPARABLE", "The two runs were made on different puzzles; compare runs of the same puzzle.")
    ma, mb = _metrics(ra), _metrics(rb)
    diffs = [{"metric": f, "a": ma.get(f), "b": mb.get(f), "equal": ma.get(f) == mb.get(f)} for f in COMPARE_FIELDS]
    return {"same_puzzle": True, "board": ra["board"], "a": ma, "b": mb, "differences": diffs,
            "note": "both columns are read from the stored runs; nothing is recomputed or estimated"}


@router.get("/{session_id}", response_model=SessionDetail, summary="Session with its puzzle and all runs")
def session_detail(session_id: str, ctx: Context = Depends(get_ctx)) -> dict:
    check_id(session_id, "session_id")
    s = ctx.db.get_session(session_id)
    if not s:
        raise not_found("session", session_id)
    return {"session": session_summary(ctx, s), "puzzle": ctx.db.get_puzzle(s["puzzle_id"]),
            "runs": [run_summary(ctx, r) for r in ctx.db.list_runs(session_id)]}
