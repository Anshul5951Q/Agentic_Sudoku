"""Distinct Sudoku agent roles. Hard constraints, not the LLM, decide validity."""
from __future__ import annotations
from copy import deepcopy
from typing import Any

DIGITS = {1, 2, 3, 4}


def candidates(board: list[list[int]], r: int, c: int) -> list[int]:
    if board[r][c] != 0:
        return []
    used = set(board[r])
    used |= {board[i][c] for i in range(4)}
    br, bc = (r // 2) * 2, (c // 2) * 2
    used |= {board[i][j] for i in range(br, br + 2) for j in range(bc, bc + 2)}
    return sorted(DIGITS - used)


def valid_board(board: list[list[int]], original: list[list[int]] | None = None) -> bool:
    if len(board) != 4 or any(len(row) != 4 for row in board):
        return False
    if any(set(row) != DIGITS for row in board):
        return False
    if any({board[r][c] for r in range(4)} != DIGITS for c in range(4)):
        return False
    for br in (0, 2):
        for bc in (0, 2):
            if {board[r][c] for r in range(br, br+2) for c in range(bc, bc+2)} != DIGITS:
                return False
    if original and any(original[r][c] and original[r][c] != board[r][c] for r in range(4) for c in range(4)):
        return False
    return True


class ProposerAgent:
    """Proposes legal next moves using minimum-remaining-values heuristic."""
    name = "Proposer"
    def propose(self, board: list[list[int]], order: str = "asc") -> tuple[tuple[int, int] | None, list[int]]:
        best = None
        best_values: list[int] = []
        for r in range(4):
            for c in range(4):
                if board[r][c] == 0:
                    vals = candidates(board, r, c)
                    if best is None or len(vals) < len(best_values):
                        best, best_values = (r, c), vals
        if order == "desc":
            best_values = list(reversed(best_values))
        elif order == "middle":
            best_values = sorted(best_values, key=lambda x: (x % 2, x))
        return best, best_values


class RuleCheckerAgent:
    """Verifies a placement against row, column, and 2x2-box constraints."""
    name = "RuleChecker"
    def check(self, board: list[list[int]], r: int, c: int, value: int) -> tuple[bool, str]:
        if value not in DIGITS:
            return False, "value must be in 1..4"
        if board[r][c] != 0:
            return False, "cell is already occupied"
        if value in board[r]:
            return False, "row conflict"
        if any(board[i][c] == value for i in range(4)):
            return False, "column conflict"
        br, bc = (r // 2) * 2, (c // 2) * 2
        if any(board[i][j] == value for i in range(br, br+2) for j in range(bc, bc+2)):
            return False, "2x2 box conflict"
        return True, "valid placement"


class BacktrackerAgent:
    """Depth-first search with explicit pruning and state restoration."""
    name = "Backtracker"
    def __init__(self, max_nodes: int = 10000):
        self.max_nodes = max_nodes
        self.nodes = 0
        self.trace: list[dict[str, Any]] = []

    def solve(self, original: list[list[int]], order: str = "asc") -> list[list[int]] | None:
        board = deepcopy(original)
        self.nodes = 0
        self.trace = []
        solved = self._search(board, order, 0)
        return deepcopy(board) if solved else None

    def _search(self, board: list[list[int]], order: str, depth: int) -> bool:
        self.nodes += 1
        if self.nodes > self.max_nodes:
            self.trace.append({"event":"limit", "depth":depth, "reason":"MAX_NODES reached"})
            return False
        proposer = ProposerAgent()
        cell, vals = proposer.propose(board, order)
        if cell is None:
            return valid_board(board)
        r, c = cell
        self.trace.append({"event":"candidates", "cell":[r+1,c+1], "candidates":vals[:], "depth":depth})
        if not vals:
            self.trace.append({"event":"pruned", "cell":[r+1,c+1], "reason":"zero candidates", "depth":depth})
            return False
        checker = RuleCheckerAgent()
        for value in vals:
            ok, reason = checker.check(board, r, c, value)
            if not ok:
                self.trace.append({"event":"rejected", "cell":[r+1,c+1], "value":value, "reason":reason, "depth":depth})
                continue
            board[r][c] = value
            self.trace.append({"event":"try", "cell":[r+1,c+1], "value":value, "depth":depth})
            # Check forward: any remaining empty cell with no candidates is a dead end.
            empty_dead = next(((rr,cc) for rr in range(4) for cc in range(4)
                               if board[rr][cc] == 0 and not candidates(board,rr,cc)), None)
            if empty_dead:
                self.trace.append({"event":"pruned", "cell":[empty_dead[0]+1,empty_dead[1]+1],
                                   "reason":"no candidates after prior assignment", "depth":depth+1,
                                   "assignment":{"cell":[r+1,c+1],"value":value}})
            elif self._search(board, order, depth+1):
                return True
            board[r][c] = 0
            self.trace.append({"event":"backtrack", "cell":[r+1,c+1], "value":value, "depth":depth})
        return False
