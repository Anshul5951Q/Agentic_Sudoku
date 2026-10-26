"""Supervisor, three independent search attempts, verified vote, and metrics."""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from time import perf_counter
from .agents import BacktrackerAgent, valid_board

class Supervisor:
    def __init__(self, max_hops: int = 5):
        self.max_hops = max_hops

    def solve_and_vote(self, puzzle: list[list[int]]) -> dict:
        started = perf_counter()
        orders = ["asc", "desc", "middle"]
        def run(order):
            solver = BacktrackerAgent()
            t0 = perf_counter()
            result = solver.solve(deepcopy(puzzle), order=order)
            return {"agent": f"Solver-{order}", "order": order, "solution": result,
                    "valid": bool(result and valid_board(result, puzzle)),
                    "nodes": solver.nodes, "seconds": round(perf_counter()-t0, 6), "trace": solver.trace}
        with ThreadPoolExecutor(max_workers=3) as pool:
            runs = list(pool.map(run, orders))
        # Only verified complete boards are eligible for voting.
        votes: dict[str, int] = {}
        for run in runs:
            if run["valid"]:
                key = "/".join(",".join(map(str,row)) for row in run["solution"])
                votes[key] = votes.get(key, 0) + 1
        winner_key = max(votes, key=votes.get) if votes else None
        winner = None
        if winner_key:
            winner = [[int(x) for x in row.split(",")] for row in winner_key.split("/")]
        return {"solution": winner, "valid": bool(winner and valid_board(winner, puzzle)),
                "votes": votes, "runs": runs, "elapsed_seconds": round(perf_counter()-started, 6),
                "solver_calls": len(runs), "max_hops": self.max_hops,
                "note": "Vote counts only rule-verified completed grids; if no valid grid exists, no winner is returned."}
