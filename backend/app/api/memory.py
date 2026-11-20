from fastapi import APIRouter, Depends, Query

from ta2.memory import KINDS, SudokuMemory

from ..context import Context, get_ctx
from ..core.errors import APIError, ID_RE
from ta2 import sudoku_rules as R

from ..schemas import MemoryCreate, MemoryRecord, StalePatternRequest

router = APIRouter(prefix="/api/memory", tags=["memory"])


def _mem(ctx: Context, user_id: str) -> SudokuMemory:
    if not ID_RE.match(user_id):
        raise APIError(422, "INVALID_ID", "user_id has an invalid format")
    return SudokuMemory(ctx.settings.memory_db, user_id=user_id)


@router.get("", response_model=list[MemoryRecord], summary="List memories for a user, optionally filtered by kind")
def list_memory(user_id: str = Query(default="demo-user", max_length=64), kind: str | None = Query(default=None),
                ctx: Context = Depends(get_ctx)) -> list[dict]:
    if kind is not None and kind not in KINDS:
        raise APIError(422, "INVALID_KIND", f"kind must be one of {list(KINDS)}")
    return _mem(ctx, user_id).list(kind)


@router.post("", response_model=MemoryRecord, status_code=201, summary="Store a memory in a (user_id, kind) namespace")
def store_memory(body: MemoryCreate, ctx: Context = Depends(get_ctx)) -> dict:
    mem = _mem(ctx, body.user_id)
    mem.put(body.kind, body.key, body.payload)
    return next(r for r in mem.list(body.kind) if r["memory_key"] == body.key)


@router.delete("/{memory_id}", status_code=204, summary="Delete one memory")
def delete_memory(memory_id: int, user_id: str = Query(default="demo-user", max_length=64), ctx: Context = Depends(get_ctx)) -> None:
    if not _mem(ctx, user_id).delete(memory_id):
        raise APIError(404, "MEMORY_NOT_FOUND", "memory was not found for this user")


@router.delete("", summary="Clear all of one user's memories (demo reset); requires confirm=true")
def clear_memory(user_id: str = Query(default="demo-user", max_length=64), confirm: bool = False, ctx: Context = Depends(get_ctx)) -> dict:
    if not confirm:
        raise APIError(422, "CONFIRMATION_REQUIRED", "pass confirm=true to clear this user's memories")
    return {"deleted": _mem(ctx, user_id).clear()}


@router.post("/demo/stale-pattern", response_model=MemoryRecord, status_code=201,
             summary="DEMO: store a deliberately WRONG dead-end pattern (it claims a correct move is a dead end)")
def stale_pattern(body: StalePatternRequest, ctx: Context = Depends(get_ctx)) -> dict:
    """The pattern marks the first decision of the true solution (first-empty order) as a dead end. A correct system must
    re-verify it, reject it as stale, and still solve the puzzle; the search records `memory_hit_rejected`."""
    sol = R.solve_one(body.board)
    empties = R.empty_cells(body.board)
    if sol is None or not empties:
        raise APIError(422, "NO_UNIQUE_DEMO", "The board must be solvable and have at least one empty cell.")
    r, c = empties[0]
    mem = _mem(ctx, body.user_id)
    pattern = mem.make_pattern(body.board, [r, c], sol[r][c], "ZERO_CANDIDATES")
    pattern["demo_stale"] = True
    mem.put("dead_ends", mem.pattern_key(pattern), pattern)
    return next(x for x in mem.list("dead_ends") if x["memory_key"] == mem.pattern_key(pattern))
