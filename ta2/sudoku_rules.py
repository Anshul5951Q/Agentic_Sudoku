"""Pure, deterministic 4x4 Sudoku rules. The single authority on validity.

Convention used across TA2: boards are 4x4 lists of ints, 0 = empty, coordinates are
zero-based ``(row, col)``. Nothing in this module does I/O or calls an LLM.
"""
from __future__ import annotations

from typing import Any

N = 4
BOX = 2
DIGITS = frozenset({1, 2, 3, 4})
Board = list[list[int]]


class InvalidBoard(ValueError):
    """Raised when a board is malformed (shape, type or digit range)."""


def copy_board(board: Board) -> Board:
    return [row[:] for row in board]


def validate_shape(board: Any) -> None:
    """Raise InvalidBoard unless board is a 4x4 list of ints in 0..4 (bool rejected)."""
    if not isinstance(board, list) or len(board) != N:
        raise InvalidBoard("board must be a list of 4 rows")
    for row in board:
        if not isinstance(row, list) or len(row) != N:
            raise InvalidBoard("every row must be a list of 4 cells")
        for v in row:
            if isinstance(v, bool) or not isinstance(v, int):
                raise InvalidBoard("cells must be integers")
            if not 0 <= v <= N:
                raise InvalidBoard("cells must be 0 (empty) or 1..4")


def box_of(r: int, c: int) -> int:
    return (r // BOX) * BOX + c // BOX


def find_conflicts(board: Board) -> list[dict]:
    """All duplicate-digit conflicts among filled cells (works on partial boards)."""
    validate_shape(board)
    conflicts: list[dict] = []
    groups: dict[tuple[str, int], dict[int, list[tuple[int, int]]]] = {}
    for r in range(N):
        for c in range(N):
            v = board[r][c]
            if v == 0:
                continue
            for kind, idx in (("row", r), ("col", c), ("box", box_of(r, c))):
                groups.setdefault((kind, idx), {}).setdefault(v, []).append((r, c))
    for (kind, idx), by_val in sorted(groups.items()):
        for v, cells in sorted(by_val.items()):
            if len(cells) > 1:
                conflicts.append({"kind": kind, "index": idx, "value": v,
                                  "cells": [list(x) for x in cells]})
    return conflicts


def is_consistent(board: Board) -> bool:
    """No duplicates in any row/column/box (partial boards allowed)."""
    return not find_conflicts(board)


def is_complete_valid(board: Any, original: Board | None = None) -> bool:
    """True only for a full, rule-satisfying board that preserves every original clue."""
    try:
        validate_shape(board)
        if original is not None:
            validate_shape(original)
    except InvalidBoard:
        return False
    if any(v == 0 for row in board for v in row) or find_conflicts(board):
        return False
    if original is not None and any(original[r][c] and original[r][c] != board[r][c]
                                    for r in range(N) for c in range(N)):
        return False
    return True


def candidates(board: Board, r: int, c: int) -> list[int]:
    """Legal digits for an empty cell (ascending). Empty list for a filled cell."""
    if board[r][c] != 0:
        return []
    used = set(board[r]) | {board[i][c] for i in range(N)}
    br, bc = (r // BOX) * BOX, (c // BOX) * BOX
    used |= {board[i][j] for i in range(br, br + BOX) for j in range(bc, bc + BOX)}
    return sorted(DIGITS - used)


def placement_check(board: Board, r: int, c: int, value: int) -> tuple[bool, str, str]:
    """(ok, reason_code, reason_text) for placing value at (r, c)."""
    if value not in DIGITS or isinstance(value, bool):
        return False, "VALUE_OUT_OF_RANGE", "value must be in 1..4"
    if board[r][c] != 0:
        return False, "CELL_OCCUPIED", "cell is already occupied"
    if value in board[r]:
        return False, "ROW_CONFLICT", f"{value} already appears in row {r}"
    if any(board[i][c] == value for i in range(N)):
        return False, "COL_CONFLICT", f"{value} already appears in column {c}"
    br, bc = (r // BOX) * BOX, (c // BOX) * BOX
    if any(board[i][j] == value for i in range(br, br + BOX) for j in range(bc, bc + BOX)):
        return False, "BOX_CONFLICT", f"{value} already appears in the 2x2 box"
    return True, "OK", "valid placement"


def empty_cells(board: Board) -> list[tuple[int, int]]:
    return [(r, c) for r in range(N) for c in range(N) if board[r][c] == 0]


def zero_candidate_cell(board: Board) -> tuple[int, int] | None:
    """First empty cell with no legal candidate (a dead end), else None."""
    for r, c in empty_cells(board):
        if not candidates(board, r, c):
            return (r, c)
    return None


def count_solutions(board: Board, limit: int = 2) -> int:
    """Count solutions, stopping as soon as `limit` are found. Contradictory boards give 0."""
    validate_shape(board)
    if find_conflicts(board):
        return 0
    b = copy_board(board)
    found = 0

    def rec() -> None:
        nonlocal found
        cells = empty_cells(b)
        if not cells:
            found += 1
            return
        r, c = min(cells, key=lambda rc: len(candidates(b, *rc)))
        for v in candidates(b, r, c):
            b[r][c] = v
            rec()
            b[r][c] = 0
            if found >= limit:
                return

    rec()
    return found


def solve_one(board: Board) -> Board | None:
    """Deterministic reference solution (first found) or None."""
    validate_shape(board)
    if find_conflicts(board):
        return None
    b = copy_board(board)

    def rec() -> bool:
        cells = empty_cells(b)
        if not cells:
            return True
        r, c = min(cells, key=lambda rc: len(candidates(b, *rc)))
        for v in candidates(b, r, c):
            b[r][c] = v
            if rec():
                return True
            b[r][c] = 0
        return False

    return b if rec() else None


def board_key(board: Board) -> str:
    return "/".join("".join(map(str, row)) for row in board)
