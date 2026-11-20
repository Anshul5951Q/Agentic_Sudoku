"""Repeatable TA1-vs-TA2 evaluation. Every number is measured at run time; nothing is hardcoded.

Per case it runs: real TA1 ToT, real TA1 CoT (local Qwen), TA2 single-solver (MRV and TA1-order),
TA2 multi-agent (supervisor + candidate-order variants), and TA2 with long-term memory and RAG context.
Uniqueness of every puzzle is verified before it is used.
"""
from __future__ import annotations

import random
import statistics
import tempfile
from pathlib import Path
from copy import deepcopy
from time import perf_counter

from . import sudoku_rules as R
from .agents import BacktrackerAgent
from .supervisor import Supervisor

SAMPLE = [[0, 0, 3, 4], [3, 4, 0, 0], [0, 1, 4, 0], [4, 0, 0, 1]]
SOLVED = [[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]]
# (case name, number of clues kept, rng seed). Puzzles are derived from a relabelled/permuted valid grid.
GENERATED = [("generated-6-clues", 6, 11), ("generated-5-clues", 5, 22), ("generated-4-clues", 4, 33), ("generated-6-clues-b", 6, 44)]
REPEATS = 5


def _permuted_grid(rng: random.Random) -> R.Board:
    digits = [1, 2, 3, 4]
    rng.shuffle(digits)
    rows = [0, 1] if rng.random() < .5 else [1, 0]
    rows += [2, 3] if rng.random() < .5 else [3, 2]
    cols = [0, 1] if rng.random() < .5 else [1, 0]
    cols += [2, 3] if rng.random() < .5 else [3, 2]
    return [[digits[SOLVED[r][c] - 1] for c in cols] for r in rows]


def make_case(clues: int, seed: int) -> R.Board:
    rng = random.Random(seed)
    cells = [(r, c) for r in range(4) for c in range(4)]
    while True:
        grid = _permuted_grid(rng)
        keep = rng.sample(cells, clues)
        p = [[0] * 4 for _ in range(4)]
        for r, c in keep:
            p[r][c] = grid[r][c]
        if R.count_solutions(p) == 1 and p != SAMPLE:
            return p


def build_cases() -> list[dict]:
    cases = [{"case": 1, "name": "assignment-sample", "puzzle": deepcopy(SAMPLE)}]
    for i, (name, clues, seed) in enumerate(GENERATED, 2):
        cases.append({"case": i, "name": name, "puzzle": make_case(clues, seed)})
    for c in cases:
        n = R.count_solutions(c["puzzle"], limit=2)
        if n != 1:
            raise ValueError(f"case {c['case']} does not have a unique solution (count={n})")
        c["solution_count"] = n
        c["empties"] = len(R.empty_cells(c["puzzle"]))
    keys = {R.board_key(c["puzzle"]) for c in cases}
    if len(keys) != len(cases):
        raise ValueError("evaluation cases must be distinct")
    return cases


def test_puzzles() -> list[R.Board]:  # backwards-compatible name
    return [c["puzzle"] for c in build_cases()]


def _timed(fn, repeats: int = REPEATS):
    times, out = [], None
    for _ in range(repeats):
        t0 = perf_counter()
        out = fn()
        times.append(perf_counter() - t0)
    return out, statistics.median(times), times


def _single(puzzle, strategy: str, order: str) -> dict:
    def go():
        b = BacktrackerAgent()
        sol = b.solve(deepcopy(puzzle), order=order, strategy=strategy)
        return b, sol
    (b, sol), med, _ = _timed(go)
    c = b.state["counters"]
    return {"correct": bool(sol and R.is_complete_valid(sol, puzzle)), "nodes": c["nodes"], "candidates": c["candidates_proposed"],
            "pruned": c["pruned"], "backtracks": c["backtracks"], "dead_ends": c["dead_ends"], "median_seconds": med,
            "llm_calls": 0, "tool_calls": 0, "solver_calls": 1}


def _multi(puzzle, strategy: str, tools=None, context=()) -> dict:
    def go():
        return Supervisor(strategy=strategy, tool_runner=tools() if tools else None, context_tools=context).solve_and_vote(puzzle)
    r, med, _ = _timed(go, repeats=REPEATS if not tools else 1)
    return {"correct": r["valid"], "votes": r["votes"], "disagreement": r["vote"]["disagreement"] if r["vote"] else None,
            "solver_calls": r["solver_calls"], "nodes": sum(a["nodes"] for a in r["attempts"]),
            "pruned": sum(a["counters"].get("pruned", 0) for a in r["attempts"]),
            "backtracks": sum(a["counters"].get("backtracks", 0) for a in r["attempts"]),
            "hops": r["hops"], "tool_calls": r["tool_calls"], "tool_failures": r["tool_failures"],
            "llm_calls": r["llm_calls"], "median_seconds": med, "_result": r}


def run_evaluation(with_cot: bool = True, with_rag: bool = True, memory=None) -> dict:
    from . import ta1_runner
    from .memory import SudokuMemory
    cases = build_cases()
    rows, traces = [], {}
    rag_ready = False
    if with_rag:
        try:
            from . import rag
            rag.retrieve_scored("warm up", 1)
            rag_ready = True
        except Exception:
            rag_ready = False
    for c in cases:
        p = c["puzzle"]
        row = {"case": c["case"], "name": c["name"], "puzzle": p, "empties": c["empties"], "solution_count": c["solution_count"]}
        ta1_tot, med, _ = _timed(lambda: ta1_runner.run_tot(p))
        row["ta1_tot"] = {"correct": ta1_tot["correct"], "nodes": ta1_tot["nodes"], "pruned": ta1_tot["pruned"],
                          "dead_ends": ta1_tot["dead_ends"], "median_seconds": med, "llm_calls": 0, "tool_calls": 0}
        traces[f"case{c['case']}_ta1_tot_search_tree"] = ta1_tot["search_tree"]
        if with_cot:
            try:
                cot = ta1_runner.run_cot(p)
                row["ta1_cot"] = {k: cot[k] for k in ("correct", "seconds", "llm_calls", "error")}
                traces[f"case{c['case']}_ta1_cot_raw_output"] = cot["raw_output"]
            except Exception as e:
                row["ta1_cot"] = {"skipped": type(e).__name__}
        row["ta2_single_mrv"] = _single(p, "mrv", "asc")
        row["ta2_single_first_empty_desc"] = _single(p, "first_empty", "desc")
        multi = _multi(p, "mrv")
        traces[f"case{c['case']}_ta2_multi_agent"] = {k: multi["_result"][k] for k in
                                                       ("status", "votes", "vote", "routing_trace", "events", "attempts")}
        row["ta2_multi_agent_mrv"] = {k: v for k, v in multi.items() if k != "_result"}
        multi_fe = _multi(p, "first_empty")
        row["ta2_multi_agent_first_empty"] = {k: v for k, v in multi_fe.items() if k != "_result"}
        if rag_ready:
            from . import rag
            from .failure import ToolRunner
            ctx = _multi(p, "mrv", tools=lambda: ToolRunner({"rag_retrieve": lambda puz: rag.retrieve_scored(
                "dead end backtracking candidates", 3)}), context=("rag_retrieve",))
            row["ta2_multi_agent_with_rag"] = {k: v for k, v in ctx.items() if k not in ("_result",)}
            row["ta2_multi_agent_with_rag"]["rag_retrievals"] = ctx["tool_calls"]
        rows.append(row)
    # memory disabled vs enabled on repeated cases (TA1-order search, which actually hits dead ends)
    tmp = None
    if memory is None:
        tmp = tempfile.TemporaryDirectory()
        memory = SudokuMemory(Path(tmp.name) / "eval_memory.sqlite3", user_id="evaluation")
    mem = memory
    mem_rows = []
    from .search import SearchEngine
    for c in cases:
        res = {}
        for label, hook in (("disabled", None), ("enabled_first_run", mem), ("enabled_repeat_run", mem)):
            eng = SearchEngine(memory_hook=hook)
            s = eng.run(eng.init_state(c["puzzle"], strategy="first_empty", order="desc"))
            res[label] = {"solved": s["status"] == "solved", "nodes": s["counters"]["nodes"], "dead_ends": s["counters"]["dead_ends"],
                          "memory_confirmed": s["counters"]["memory_confirmed"], "memory_rejected": s["counters"]["memory_rejected"]}
        mem_rows.append({"case": c["case"], **res})
    if tmp is not None:
        tmp.cleanup()
    return {"cases": rows, "memory_comparison": mem_rows, "traces": traces, "rag_available": rag_ready,
            "timing": f"median of {REPEATS} runs for deterministic solvers; TA1 CoT is a single real Qwen call",
            "notes": ["ta1_* columns execute the frozen ta1/ source files, not TA2 code",
                      "nodes: TA1 = 'Try' lines in its search tree; TA2 = search nodes created including the root",
                      "all puzzles verified unique at run time"]}
