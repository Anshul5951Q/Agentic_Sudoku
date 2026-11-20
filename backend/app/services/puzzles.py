"""Puzzle tools. All validity decisions come from ta2.sudoku_rules (deterministic, authoritative)."""
from __future__ import annotations

import random
import secrets

from ta2 import sudoku_rules as R

_SOLVED = [[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]]
CELLS = [(r, c) for r in range(4) for c in range(4)]


def validate(board) -> dict:
    conflicts = R.find_conflicts(board)
    empties = len(R.empty_cells(board))
    solved = R.is_complete_valid(board)
    if conflicts:
        msg = f"{len(conflicts)} duplicate(s) found; the board breaks the Sudoku rules."
    elif empties == 0:
        msg = "The board is complete and satisfies every rule."
    else:
        msg = f"No rule violations so far; {empties} empty cell(s) remain."
    return {"valid": not conflicts, "complete": empties == 0, "solved": solved, "empties": empties,
            "conflicts": conflicts, "message": msg}


def count(board, limit: int = 2) -> dict:
    n = R.count_solutions(board, limit)
    return {"count": n, "limit": limit, "classification": "none" if n == 0 else "unique" if n == 1 else "multiple",
            "solvable": n >= 1, "unique": n == 1}


def _permuted_grid(rng: random.Random):
    digits = [1, 2, 3, 4]
    rng.shuffle(digits)
    rows = ([0, 1] if rng.random() < .5 else [1, 0]) + ([2, 3] if rng.random() < .5 else [3, 2])
    cols = ([0, 1] if rng.random() < .5 else [1, 0]) + ([2, 3] if rng.random() < .5 else [3, 2])
    return [[digits[_SOLVED[r][c] - 1] for c in cols] for r in rows]


def generate(clues: int, seed: int | None, max_attempts: int) -> tuple[list[list[int]], dict] | None:
    """Return a puzzle verified solvable AND unique, or None if none was found within max_attempts."""
    seed = secrets.randbelow(2**31) if seed is None else seed
    rng = random.Random(seed)
    for attempt in range(1, max_attempts + 1):
        grid = _permuted_grid(rng)
        keep = rng.sample(CELLS, clues)
        board = [[0] * 4 for _ in range(4)]
        for r, c in keep:
            board[r][c] = grid[r][c]
        if R.count_solutions(board, 2) == 1:          # solvable and unique, checked, not assumed
            return board, {"seed": seed, "clues": clues, "attempts": attempt,
                           "verified": {"solvable": True, "unique": True, "solution_count": 1}}
    return None
