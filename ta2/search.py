"""Iterative, checkpointable depth-first Tree-of-Thought search engine.

One call to :meth:`SearchEngine.step` performs exactly one search *decision* and mutates a plain
JSON-serialisable state dict, which is what makes the search resumable from a LangGraph
checkpoint. All validity decisions come from ``sudoku_rules``; no LLM is involved here.
"""
from __future__ import annotations

from copy import deepcopy
from time import perf_counter
from typing import Any, Callable, Protocol

from . import sudoku_rules as R
from .agents import ProposerAgent, RuleCheckerAgent, VerifierAgent
from .models import SearchNode, TraceEvent, utc_now


class MemoryHook(Protocol):
    def lookup(self, board: R.Board, cell: list[int], value: int) -> dict | None: ...
    def learn(self, board_before: R.Board, cell: list[int], value: int, reason_code: str) -> None: ...


def confirm_dead_end(board: R.Board, cell: list[int], value: int) -> bool:
    """Deterministically re-check that placing value at cell leaves no solution."""
    r, c = cell
    if not R.placement_check(board, r, c, value)[0]:
        return True
    b = R.copy_board(board)
    b[r][c] = value
    return R.count_solutions(b, limit=1) == 0


class SearchEngine:
    def __init__(self, memory_hook: MemoryHook | None = None):
        self.memory_hook = memory_hook
        self.proposer, self.checker, self.verifier = ProposerAgent(), RuleCheckerAgent(), VerifierAgent()

    # ---------------------------------------------------------------- state
    @staticmethod
    def init_state(puzzle: R.Board, run_id: str = "run-local", thread_id: str | None = None,
                   strategy: str = "mrv", order: str = "asc", max_nodes: int = 10000) -> dict:
        R.validate_shape(puzzle)
        return {
            "run_id": run_id, "thread_id": thread_id or run_id, "puzzle": R.copy_board(puzzle),
            "board": R.copy_board(puzzle), "stack": [], "nodes": {}, "events": [], "seq": 0,
            "status": "running", "phase": "start", "solution": None, "current_node_id": None,
            "strategy": strategy, "order": order, "max_nodes": max_nodes, "node_seq": 0,
            "counters": {"steps": 0, "nodes": 0, "expansions": 0, "candidates_proposed": 0,
                         "rule_violations": 0, "dead_ends": 0, "pruned": 0, "backtracks": 0,
                         "memory_confirmed": 0, "memory_rejected": 0, "max_depth": 0},
            "failure": None,
        }

    def _emit(self, s: dict, event: str, agent: str, **kw: Any) -> dict:
        seq = s["seq"]
        ev = TraceEvent(event_id=f"{s['run_id']}-event-{seq:05d}", run_id=s["run_id"],
                        thread_id=s["thread_id"], sequence=seq, event=event, agent=agent, **kw)
        s["seq"] = seq + 1
        d = ev.model_dump()
        s["events"].append(d)
        return d

    def _new_node(self, s: dict, parent: str | None, depth: int, cell, value, cands) -> str:
        nid = f"{s['run_id']}-node-{s['node_seq']:04d}"
        s["node_seq"] += 1
        s["nodes"][nid] = SearchNode(
            node_id=nid, parent_node_id=parent, depth=depth, decision_cell=cell, candidate_value=value,
            board_snapshot=R.copy_board(s["board"]), candidate_list=list(cands)).model_dump()
        s["counters"]["nodes"] += 1
        s["counters"]["max_depth"] = max(s["counters"]["max_depth"], depth)
        return nid

    @staticmethod
    def _mark(s: dict, nid: str | None, status: str, code: str | None = None, text: str | None = None):
        if nid and nid in s["nodes"]:
            n = s["nodes"][nid]
            n["status"] = status
            if code:
                n["reason_code"], n["reason_text"] = code, text

    # ----------------------------------------------------------------- step
    def step(self, s: dict) -> bool:
        """Perform one decision. Returns True while the search is still running."""
        if s["status"] != "running":
            return False
        s["counters"]["steps"] += 1
        phase = s["phase"]
        if phase == "start":
            self._emit(s, "search_started", "Supervisor", board_snapshot=R.copy_board(s["board"]),
                       data={"strategy": s["strategy"], "order": s["order"], "max_nodes": s["max_nodes"]})
            bad = self.verifier.verify_partial(s["board"])
            if not bad.ok:
                return self._fail(s, bad.code, bad.reason)
            s["current_node_id"] = self._new_node(s, None, 0, None, None, [])
            s["phase"] = "expand"
        elif phase == "expand":
            self._expand(s)
        elif phase == "advance":
            self._advance(s)
        elif phase == "backtrack":
            self._backtrack(s)
        return s["status"] == "running"

    def run(self, s: dict, max_steps: int | None = None, deadline: float | None = None) -> dict:
        n = 0
        while s["status"] == "running":
            if max_steps is not None and n >= max_steps:
                break
            if deadline is not None and perf_counter() > deadline:
                self._fail(s, "TIMEOUT", "search exceeded its time budget")
                break
            self.step(s)
            n += 1
        return s

    def _fail(self, s: dict, code: str, reason: str) -> bool:
        s["status"] = "limit_reached" if code in ("MAX_NODES", "TIMEOUT") else "failed"
        s["failure"] = {"code": code, "reason": reason}
        self._emit(s, "search_failed", "Supervisor", reason_code=code, reason=reason)
        return False

    def _expand(self, s: dict) -> None:
        board, depth, node = s["board"], len(s["stack"]), s["current_node_id"]
        s["counters"]["expansions"] += 1
        cell, vals = self.proposer.propose(board, s["order"], s["strategy"])
        if cell is None:  # full board
            self._emit(s, "solution_found", "Backtracker", depth=depth, node_id=node,
                       board_snapshot=R.copy_board(board))
            verdict = self.verifier.verify_final(board, s["puzzle"])
            if verdict.ok:
                s["solution"], s["status"] = R.copy_board(board), "solved"
                self._mark(s, node, "solution", "SOLUTION_VERIFIED", "complete board verified")
                self._emit(s, "solution_verified", "Verifier", depth=depth, node_id=node,
                           reason_code=verdict.code, reason=verdict.reason, board_snapshot=R.copy_board(board))
                self._emit(s, "search_completed", "Supervisor", reason_code="SOLVED",
                           reason="verified solution found", data={"counters": dict(s["counters"])})
            else:
                self._mark(s, node, "dead_end", verdict.code, verdict.reason)
                s["phase"] = "backtrack"
            return
        self._emit(s, "cell_selected", "Proposer", depth=depth, cell=list(cell), node_id=node,
                   reason_code=s["strategy"].upper(), reason=f"selected by {s['strategy']} strategy")
        self._emit(s, "candidates_generated", "Proposer", depth=depth, cell=list(cell), candidates=vals[:],
                   node_id=node)
        self._mark(s, node, "expanded")
        s["nodes"][node]["candidate_list"] = vals[:]
        s["nodes"][node]["decision_cell"] = list(cell)
        if not vals:
            s["counters"]["dead_ends"] += 1
            reason = f"cell [{cell[0]}, {cell[1]}] has no legal candidates"
            self._emit(s, "dead_end", "Verifier", depth=depth, cell=list(cell), node_id=node,
                       reason_code="ZERO_CANDIDATES", reason=reason, board_snapshot=R.copy_board(board))
            self._mark(s, node, "dead_end", "ZERO_CANDIDATES", reason)
            if s["stack"] and self.memory_hook:
                f = s["stack"][-1]
                self.memory_hook.learn(f["board_before"], f["cell"], f["placed"], "ZERO_CANDIDATES")
            self._prune(s, node, "ZERO_CANDIDATES", reason, depth)
            s["phase"] = "backtrack"
            return
        s["stack"].append({"cell": list(cell), "candidates": vals[:], "idx": 0, "node_id": node,
                           "board_before": R.copy_board(board), "placed": None})
        s["phase"] = "advance"

    def _prune(self, s: dict, node: str, code: str, reason: str, depth: int) -> None:
        s["counters"]["pruned"] += 1
        if s["nodes"][node]["status"] not in ("dead_end", "rejected"):
            self._mark(s, node, "pruned", code, reason)
        self._emit(s, "branch_pruned", "Backtracker", depth=depth, node_id=node,
                   reason_code=code, reason=reason)

    def _advance(self, s: dict) -> None:
        f = s["stack"][-1]
        depth = len(s["stack"])
        if f["idx"] >= len(f["candidates"]):
            node = f["node_id"]
            s["stack"].pop()
            if s["nodes"][node]["status"] == "expanded":
                self._prune(s, node, "ALL_CHILDREN_FAILED", "every candidate of this node failed", depth - 1)
            s["phase"] = "backtrack"
            return
        if s["counters"]["nodes"] >= s["max_nodes"]:
            self._fail(s, "MAX_NODES", f"node budget of {s['max_nodes']} reached")
            return
        value = f["candidates"][f["idx"]]
        f["idx"] += 1
        r, c = f["cell"]
        board = s["board"]
        s["counters"]["candidates_proposed"] += 1
        nid = self._new_node(s, f["node_id"], depth, f["cell"], value, [])
        self._emit(s, "candidate_proposed", "Proposer", depth=depth, cell=f["cell"], candidate=value, node_id=nid)
        ok, code, reason = self.checker.check(board, r, c, value)
        if not ok:
            s["counters"]["rule_violations"] += 1
            self._mark(s, nid, "rejected", code, reason)
            self._emit(s, "rule_violation", "RuleChecker", depth=depth, cell=f["cell"], candidate=value,
                       node_id=nid, reason_code=code, reason=reason)
            return
        if self.memory_hook:
            pat = self.memory_hook.lookup(board, f["cell"], value)
            if pat is not None:
                if confirm_dead_end(board, f["cell"], value):
                    s["counters"]["memory_confirmed"] += 1
                    self._emit(s, "memory_hit_confirmed", "Backtracker", depth=depth, cell=f["cell"],
                               candidate=value, node_id=nid, reason_code="MEMORY_CONFIRMED",
                               reason="remembered dead end re-confirmed deterministically",
                               data={"pattern_id": pat.get("id")})
                    self._mark(s, nid, "pruned", "MEMORY_CONFIRMED", "dead end from long-term memory, re-verified")
                    s["counters"]["pruned"] += 1
                    self._emit(s, "branch_pruned", "Backtracker", depth=depth, node_id=nid,
                               reason_code="MEMORY_CONFIRMED", reason="pruned via re-verified memory")
                    return
                s["counters"]["memory_rejected"] += 1
                self._emit(s, "memory_hit_rejected", "Verifier", depth=depth, cell=f["cell"], candidate=value,
                           node_id=nid, reason_code="MEMORY_STALE",
                           reason="remembered pattern did not hold for the current board; ignored",
                           data={"pattern_id": pat.get("id")})
        self._emit(s, "candidate_accepted", "RuleChecker", depth=depth, cell=f["cell"], candidate=value,
                   node_id=nid, reason_code=code, reason=reason)
        board[r][c] = value
        f["placed"] = value
        self._mark(s, nid, "accepted", code, reason)
        s["nodes"][nid]["board_snapshot"] = R.copy_board(board)
        s["current_node_id"] = nid
        s["phase"] = "expand"

    def _backtrack(self, s: dict) -> None:
        if not s["stack"]:
            s["status"] = "exhausted"
            self._emit(s, "search_completed", "Supervisor", reason_code="EXHAUSTED",
                       reason="search space exhausted; no solution exists",
                       data={"counters": dict(s["counters"])})
            return
        f = s["stack"][-1]
        s["counters"]["backtracks"] += 1
        self._emit(s, "backtrack_started", "Backtracker", depth=len(s["stack"]), cell=f["cell"],
                   candidate=f["placed"], node_id=f["node_id"], reason_code="RESTORE_PARENT",
                   reason="restoring the board to its state before this decision",
                   board_snapshot=R.copy_board(f["board_before"]))
        s["board"] = R.copy_board(f["board_before"])
        f["placed"] = None
        s["current_node_id"] = f["node_id"]
        s["phase"] = "advance"
