"""Runtime agent roles with formal five-field contracts. Hard constraints, not the LLM, decide validity.

Roles: Proposer (cell + candidate ordering), RuleChecker/Evaluator (placement legality),
Verifier (partial/complete board verification) and Backtracker (drives the search, restores state).
The Supervisor lives in ``supervisor.py``. ``candidates`` and ``valid_board`` are kept as
backwards-compatible names for the original TA2 starter code.
"""
from __future__ import annotations

from . import sudoku_rules as R
from .models import AgentContract, Verdict

DIGITS = set(R.DIGITS)
candidates = R.candidates


def valid_board(board, original=None) -> bool:
    return R.is_complete_valid(board, original)


ORDERS = ("asc", "desc", "middle")
STRATEGIES = ("mrv", "first_empty")


def order_candidates(vals: list[int], order: str) -> list[int]:
    if order == "asc":
        return sorted(vals)
    if order == "desc":
        return sorted(vals, reverse=True)
    if order == "middle":
        return sorted(vals, key=lambda x: (x % 2, x))
    raise ValueError(f"unknown candidate order {order!r}")


class ProposerAgent:
    """Selects the next empty cell and the (deterministic) legal candidates in a chosen order."""
    name = "Proposer"
    contract = AgentContract(
        name="Proposer",
        goal="Select the next empty cell (minimum-remaining-values or first-empty) and list its legal candidates in a given order.",
        tools=["candidate generator (sudoku_rules.candidates)", "optional local qwen2.5:3b ordering hint (advisory, filtered)"],
        inputs_outputs="IN: 4x4 board, strategy, order. OUT: zero-based cell [row, col] (or None if full) and a list of legal candidates.",
        limits="Cannot commit a move; its output is always a permutation of the deterministic legal set (anything else is discarded).",
    )

    def propose(self, board, order: str = "asc", strategy: str = "mrv"):
        if strategy not in STRATEGIES:
            raise ValueError(f"unknown strategy {strategy!r}")
        cells = R.empty_cells(board)
        if not cells:
            return None, []
        if strategy == "first_empty":
            r, c = cells[0]
        else:
            r, c = min(cells, key=lambda rc: (len(R.candidates(board, *rc)), rc))
        return (r, c), order_candidates(R.candidates(board, r, c), order)


class RuleCheckerAgent:
    """Evaluator: checks one placement against row, column and 2x2-box constraints."""
    name = "RuleChecker"
    contract = AgentContract(
        name="Evaluator / RuleChecker",
        goal="Assess whether a single candidate placement is legal and explain any rejection.",
        tools=["row/column/box validator (sudoku_rules.placement_check)"],
        inputs_outputs="IN: board, cell [row, col], value. OUT: Verdict(ok, reason_code, reason).",
        limits="Judges one placement only; cannot claim the puzzle is solved from partial legality.",
    )

    def check(self, board, r: int, c: int, value: int) -> Verdict:
        ok, code, reason = R.placement_check(board, r, c, value)
        return Verdict(ok=ok, code=code, reason=reason)


class VerifierAgent:
    """Verifies partial boards and complete solutions; the only role allowed to accept a solution."""
    name = "Verifier"
    contract = AgentContract(
        name="Verifier",
        goal="Verify partial states for consistency, detect dead ends, and verify that a complete board is a valid solution preserving the clues.",
        tools=["sudoku_rules.find_conflicts", "sudoku_rules.is_complete_valid", "sudoku_rules.zero_candidate_cell"],
        inputs_outputs="IN: board (+ original puzzle). OUT: Verdict(ok, reason_code, reason).",
        limits="Never accepts an incomplete or rule-violating board, or one that changes an original clue.",
    )

    def verify_partial(self, board) -> Verdict:
        try:
            R.validate_shape(board)
        except R.InvalidBoard as e:
            return Verdict(ok=False, code="MALFORMED_BOARD", reason=str(e))
        conflicts = R.find_conflicts(board)
        if conflicts:
            c = conflicts[0]
            return Verdict(ok=False, code="CONTRADICTORY_BOARD",
                           reason=f"duplicate {c['value']} in {c['kind']} {c['index']}")
        dead = R.zero_candidate_cell(board)
        if dead is not None:
            return Verdict(ok=False, code="ZERO_CANDIDATES", reason=f"cell {list(dead)} has no legal candidates")
        return Verdict(ok=True, code="OK", reason="partial board is consistent")

    def verify_final(self, board, original=None) -> Verdict:
        try:
            R.validate_shape(board)
        except R.InvalidBoard as e:
            return Verdict(ok=False, code="MALFORMED_BOARD", reason=str(e))
        if any(v == 0 for row in board for v in row):
            return Verdict(ok=False, code="INCOMPLETE", reason="board still has empty cells")
        if R.find_conflicts(board):
            return Verdict(ok=False, code="RULE_VIOLATION", reason="duplicate digit in a row, column or box")
        if not R.is_complete_valid(board, original):
            return Verdict(ok=False, code="CLUE_CHANGED", reason="solution does not preserve the original clues")
        return Verdict(ok=True, code="VERIFIED", reason="complete board satisfies all rules and clues")


class BacktrackerAgent:
    """Drives the depth-first search, restores the exact parent state on failure, records the trace."""
    name = "Backtracker"
    contract = AgentContract(
        name="Verifier / Backtracker",
        goal="Detect dead ends, prune failed branches, restore the exact parent board, and record every decision as a trace event.",
        tools=["SearchEngine (ta2.search)", "state stack", "VerifierAgent"],
        inputs_outputs="IN: partial board/search state. OUT: branch status, restore action, trace events, verified solution or None.",
        limits="Must restore the exact parent state; cannot accept an unverified solution; bounded by max_nodes and a deadline.",
    )

    def __init__(self, max_nodes: int = 10000, memory_hook=None):
        from .search import SearchEngine  # local import: search imports this module
        self.engine = SearchEngine(memory_hook=memory_hook)
        self.max_nodes = max_nodes
        self.state: dict | None = None
        self.nodes = 0
        self.trace: list[dict] = []
        self.status = "idle"

    def solve(self, original, order: str = "asc", strategy: str = "mrv", run_id: str = "run-local",
              thread_id: str | None = None, deadline: float | None = None):
        s = self.engine.init_state(original, run_id, thread_id, strategy, order, self.max_nodes)
        self.engine.run(s, deadline=deadline)
        self.state, self.trace, self.status = s, s["events"], s["status"]
        self.nodes = s["counters"]["nodes"]
        return s["solution"]


CONTRACTS = [a.contract for a in (ProposerAgent, RuleCheckerAgent, VerifierAgent, BacktrackerAgent)]
