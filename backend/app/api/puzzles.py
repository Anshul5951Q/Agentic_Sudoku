from fastapi import APIRouter, Depends

from ta2.models import utc_now

from ..context import Context, get_ctx
from ..core.errors import APIError, check_id, not_found
from ..core.ids import new_id
from ..schemas import BoardRequest, GenerateRequest, Puzzle, PuzzleCreate, PuzzleValidation, SolutionCount
from ..services import puzzles as svc

router = APIRouter(prefix="/api/puzzles", tags=["puzzles"])


def _save(ctx: Context, board, name, source, check: bool, generation=None) -> dict:
    count = svc.count(board) if check else None
    return ctx.db.create_puzzle(new_id("puzzle"), new_id("session"), board, name, source,
                                count["count"] if count else None, count["unique"] if count else None,
                                count["solvable"] if count else None, generation)


@router.post("", response_model=Puzzle, status_code=201, summary="Create/save a puzzle (and its session)")
def create_puzzle(body: PuzzleCreate, ctx: Context = Depends(get_ctx)) -> dict:
    # Saving an inconsistent board is allowed (a user may be mid-entry); solving it is not.
    return _save(ctx, body.board, body.name, body.source, check=True)


@router.get("/{puzzle_id}", response_model=Puzzle, summary="Get a saved puzzle")
def get_puzzle(puzzle_id: str, ctx: Context = Depends(get_ctx)) -> dict:
    check_id(puzzle_id, "puzzle_id")
    p = ctx.db.get_puzzle(puzzle_id)
    if not p:
        raise not_found("puzzle", puzzle_id)
    return p


@router.post("/validate", response_model=PuzzleValidation, summary="Validate board constraints")
def validate(body: BoardRequest) -> dict:
    return svc.validate(body.board)


@router.post("/count-solutions", response_model=SolutionCount, summary="Count solutions (stops after two)")
def count_solutions(body: BoardRequest) -> dict:
    return svc.count(body.board)


@router.post("/generate", response_model=Puzzle, status_code=201, summary="Generate a puzzle verified solvable and unique")
def generate(body: GenerateRequest, ctx: Context = Depends(get_ctx)) -> dict:
    found = svc.generate(body.clues, body.seed, body.max_attempts)
    if found is None:
        raise APIError(422, "GENERATION_FAILED", "No puzzle with a verified unique solution was found; "
                       "try more clues, a different seed or more attempts.", retryable=True)
    board, info = found
    if body.save:
        return _save(ctx, board, f"generated-{body.clues}-clues", "generated", check=True, generation=info)
    # Not saved: still a full Puzzle shape, with fresh (unsaved) IDs.
    return {"puzzle_id": new_id("puzzle"), "session_id": new_id("session"), "name": None, "board": board, "source": "generated",
            "created_at": utc_now(), "solution_count": 1, "unique": True,
            "solvable": True, "generation": info}
