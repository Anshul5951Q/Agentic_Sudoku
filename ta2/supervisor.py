"""Supervisor: routes work, enforces MAX_HOPS / time / tool budgets, runs candidate-order variants
and counts votes ONLY from deterministically verified complete solutions.

The "variants" below are the same deterministic search with a different candidate ordering.
They are NOT independent LLM agents; a vote among them is a consistency check, not independent
reasoning evidence.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from copy import deepcopy
from time import perf_counter
from typing import Callable

from . import sudoku_rules as R
from .agents import BacktrackerAgent, VerifierAgent
from .failure import BudgetExceeded, ToolRunner
from .models import AgentContract, VoteResult
from .trace import Recorder

VARIANT_ORDERS = ("asc", "desc", "middle")
DEFAULT_MAX_HOPS = 8  # validate, context, dispatch, verify, vote use 5; 3 spare hops


class HopLimitExceeded(Exception):
    pass


SUPERVISOR_CONTRACT = AgentContract(
    name="Supervisor",
    goal="Coordinate the agents, enforce execution policy, collect results and return a verified winner or an explicit failure.",
    tools=["agent router", "ToolRunner (retry/fallback)", "trace recorder", "vote tally (verified solutions only)"],
    inputs_outputs="IN: puzzle + run configuration. OUT: routing trace, attempt records, VoteResult, final verified solution or failure code.",
    limits="Hard MAX_HOPS, per-run timeout, node and tool-call budgets; invalid, partial or timed-out attempts never vote; never returns an unverified winner.",
)


def default_solver(puzzle, variant: dict, deadline: float | None, max_nodes: int) -> dict:
    b = BacktrackerAgent(max_nodes=max_nodes)
    sol = b.solve(deepcopy(puzzle), order=variant["order"], strategy=variant["strategy"],
                  run_id=f"{variant['run_id']}-{variant['name']}", deadline=deadline)
    return {"solution": sol, "status": b.status, "nodes": b.nodes, "counters": b.state["counters"],
            "trace": b.trace}


def tally_votes(puzzle, attempts: list[dict]) -> VoteResult:
    """Pure function: recompute the vote from saved attempt records, re-verifying every solution."""
    verifier = VerifierAgent()
    votes: dict[str, int] = {}
    eligible, excluded, boards = [], [], {}
    for a in attempts:
        sol = a.get("solution")
        if a.get("status") in ("timeout", "error", "limit_reached", "failed", "exhausted") and sol is None:
            excluded.append({"attempt": a["name"], "reason": f"status={a.get('status')}"})
            continue
        v = verifier.verify_final(sol, puzzle) if sol is not None else None
        if v is None or not v.ok:
            excluded.append({"attempt": a["name"], "reason": "no solution" if v is None else v.code})
            continue
        key = R.board_key(sol)
        votes[key] = votes.get(key, 0) + 1
        boards[key] = sol
        eligible.append(a["name"])
    disagreement = len(votes) > 1
    solution_count = R.count_solutions(puzzle, 2) if votes else None
    winner_key = None
    if votes:
        top = max(votes.values())
        leaders = [k for k, n in votes.items() if n == top]
        winner_key = leaders[0] if len(leaders) == 1 else None
    note = ("vote counts only deterministically verified complete boards from candidate-order variants; "
            "invalid, partial, errored or timed-out attempts are excluded")
    if disagreement:
        note += "; verified solutions DISAGREE (puzzle likely has several solutions), reported rather than hidden"
    if not votes:
        note += "; no valid vote, so no winner"
    return VoteResult(votes=votes, winner=boards.get(winner_key) if winner_key else None, winner_key=winner_key,
                      eligible=eligible, excluded=excluded, disagreement=disagreement,
                      solution_count=solution_count, note=note)


class Supervisor:
    def __init__(self, max_hops: int = DEFAULT_MAX_HOPS, timeout_s: float = 30.0, max_nodes: int = 10000,
                 strategy: str = "mrv", orders: tuple[str, ...] = VARIANT_ORDERS,
                 solver: Callable | None = None, router: Callable | None = None,
                 tool_runner: ToolRunner | None = None, context_tools: tuple[str, ...] = (), parallel: bool = True):
        self.max_hops, self.timeout_s, self.max_nodes = max_hops, timeout_s, max_nodes
        self.parallel = parallel  # False: run the variants one after another (measured in the evaluation)
        self.strategy, self.orders = strategy, orders
        self.solver = solver or default_solver
        self.router = router or self._default_router
        self.tools, self.context_tools = tool_runner, context_tools

    @staticmethod
    def _default_router(ctx: dict) -> str:
        plan = ["validate", "context", "dispatch", "verify", "vote", "finish"]
        return plan[min(ctx["cursor"], len(plan) - 1)]

    def solve_and_vote(self, puzzle, run_id: str = "run-local") -> dict:
        t0 = perf_counter()
        rec = Recorder(run_id)
        if self.tools is not None:
            self.tools.rec = rec
        ctx = {"cursor": 0, "hops": 0}
        routing, attempts, context, result_extra = [], [], {}, {}
        status, failure = "running", None
        deadline = t0 + self.timeout_s
        last = "Supervisor"

        def hop(to: str, reason: str) -> None:
            nonlocal last
            if ctx["hops"] >= self.max_hops:
                raise HopLimitExceeded(f"MAX_HOPS={self.max_hops} reached; refused to route to {to}")
            ctx["hops"] += 1
            routing.append({"hop": ctx["hops"], "from": last, "to": to, "reason": reason})
            rec.emit("route", "Supervisor", reason_code="ROUTE", reason=f"{last} -> {to}: {reason}",
                     data={"hop": ctx["hops"], "to": to})
            last = to

        vote: VoteResult | None = None
        try:
            while True:
                action = self.router(ctx)
                if action == "finish":
                    break
                if action == "validate":
                    hop("Verifier", "validate the input puzzle")
                    v = VerifierAgent().verify_partial(puzzle)
                    if not v.ok:
                        status, failure = "failed", {"code": v.code, "reason": v.reason}
                        break
                elif action == "context":
                    for name in self.context_tools:
                        hop("Tool:" + name, "optional context tool")
                        context[name] = self.tools.call(name, puzzle).__dict__ if self.tools else None
                elif action == "dispatch":
                    hop("SolverVariants", f"run {len(self.orders)} candidate-order variants")
                    attempts = self._dispatch(puzzle, run_id, deadline)
                elif action == "verify":
                    hop("Verifier", "verify every attempt's board deterministically")
                    for a in attempts:
                        a["valid"] = bool(a["solution"] is not None and
                                          VerifierAgent().verify_final(a["solution"], puzzle).ok)
                elif action == "vote":
                    hop("Supervisor", "tally votes from verified solutions only")
                    vote = tally_votes(puzzle, attempts)
                    rec.emit("vote_tallied", "Supervisor", reason_code="VOTE",
                             reason=vote.note, data={"votes": vote.votes, "eligible": vote.eligible})
                else:
                    raise ValueError(f"router returned unknown action {action!r}")
                ctx["cursor"] += 1
        except HopLimitExceeded as e:
            status, failure = "failed", {"code": "HOP_LIMIT_EXCEEDED", "reason": str(e)}
            rec.emit("search_failed", "Supervisor", reason_code="HOP_LIMIT_EXCEEDED", reason=str(e))
        except BudgetExceeded as e:
            status, failure = "failed", {"code": "TOOL_BUDGET_EXCEEDED", "reason": str(e)}
            rec.emit("search_failed", "Supervisor", reason_code="TOOL_BUDGET_EXCEEDED", reason=str(e))
        winner = vote.winner if vote else None
        if failure is None:
            if winner is not None and VerifierAgent().verify_final(winner, puzzle).ok:
                status = "solved"
            else:
                status, failure = "failed", {"code": "NO_VALID_VOTE" if not (vote and vote.votes) else "NO_UNIQUE_WINNER",
                                             "reason": vote.note if vote else "no vote was taken"}
        rec.emit("search_completed" if status == "solved" else "search_failed", "Supervisor",
                 reason_code="SOLVED" if status == "solved" else failure["code"],
                 reason="verified winner selected" if status == "solved" else failure["reason"])
        solver_calls = len(attempts)
        return {
            "run_id": run_id, "status": status, "solution": winner if status == "solved" else None,
            "valid": status == "solved", "failure": failure,
            "votes": vote.votes if vote else {}, "vote": vote.model_dump() if vote else None,
            "attempts": attempts, "runs": attempts, "routing_trace": routing, "events": rec.events,
            "context": context, "solver_calls": solver_calls, "hops": ctx["hops"], "max_hops": self.max_hops,
            "tool_calls": self.tools.calls if self.tools else 0,
            "tool_failures": self.tools.failures if self.tools else 0,
            "llm_calls": 0, "elapsed_seconds": round(perf_counter() - t0, 6), "dispatch": "parallel" if self.parallel else "sequential",
            "note": "Variants differ only in candidate ordering; they are not independent LLM agents.",
        }

    def _dispatch(self, puzzle, run_id: str, deadline: float) -> list[dict]:
        variants = [{"name": f"variant-{o}", "order": o, "strategy": self.strategy, "run_id": run_id}
                    for o in self.orders]

        def run(v: dict) -> dict:
            t = perf_counter()
            rec = {"name": v["name"], "kind": "candidate-order variant", "order": v["order"],
                   "strategy": v["strategy"], "solution": None, "status": "error", "nodes": 0,
                   "counters": {}, "trace": [], "error": None}
            try:
                out = self.solver(puzzle, v, deadline, self.max_nodes)
                rec.update(solution=out.get("solution"), status=out.get("status", "solved"),
                           nodes=out.get("nodes", 0), counters=out.get("counters", {}), trace=out.get("trace", []))
            except Exception as e:  # a failing worker must not take the supervisor down
                rec["error"] = type(e).__name__
            rec["seconds"] = round(perf_counter() - t, 6)
            return rec

        if not self.parallel:
            out = []
            for v in variants:
                if perf_counter() >= deadline:
                    out.append({"name": v["name"], "kind": "candidate-order variant", "order": v["order"],
                                "strategy": v["strategy"], "solution": None, "status": "timeout", "nodes": 0,
                                "counters": {}, "trace": [], "error": "timeout", "seconds": 0.0})
                else:
                    out.append(run(v))
            return out
        pool = ThreadPoolExecutor(max_workers=len(variants))
        futures = [(v, pool.submit(run, v)) for v in variants]
        out = []
        for v, f in futures:
            try:
                out.append(f.result(timeout=max(0.0, deadline - perf_counter())))
            except FutureTimeout:
                out.append({"name": v["name"], "kind": "candidate-order variant", "order": v["order"],
                            "strategy": v["strategy"], "solution": None, "status": "timeout", "nodes": 0,
                            "counters": {}, "trace": [], "error": "timeout", "seconds": self.timeout_s})
        pool.shutdown(wait=False, cancel_futures=True)
        return out
