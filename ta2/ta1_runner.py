"""Runs the REAL, frozen TA1 scripts on arbitrary puzzles without modifying them.

TA1's files hardcode the puzzle and execute on import, so this loader reads the unmodified source,
substitutes only the ``puzzle = ...`` literal *in memory*, and executes it with captured stdout.
Correctness is judged by this project's deterministic validator, never by TA1's own printout.
"""
from __future__ import annotations

import contextlib
import io
import re
from pathlib import Path
from time import perf_counter

from . import config
from . import sudoku_rules as R

TA1_DIR = config.ROOT / "ta1"
_LIST_LITERAL = re.compile(r"^puzzle\s*=\s*\[.*?\n\]", re.S | re.M)
_STR_LITERAL = re.compile(r'^puzzle\s*=\s*""".*?"""', re.S | re.M)


def _source(name: str) -> str:
    return (TA1_DIR / name).read_text(encoding="utf-8")


def _list_literal(board) -> str:
    return "puzzle = [\n" + ",\n".join(f"    {row}" for row in board) + "\n]"


def run_tot(puzzle) -> dict:
    """Run TA1 tot_solver.py. Counts come from TA1's own search_tree lines."""
    R.validate_shape(puzzle)
    src = _LIST_LITERAL.sub(lambda m: _list_literal(puzzle), _source("tot_solver.py"), count=1)
    code = compile(src, "ta1/tot_solver.py", "exec")
    ns: dict = {"__name__": "ta1_tot_solver"}
    buf = io.StringIO()
    t0 = perf_counter()
    with contextlib.redirect_stdout(buf):
        exec(code, ns)
    seconds = perf_counter() - t0
    tree = ns["search_tree"]
    final = ns["puzzle"]
    return {"solution": final if R.is_complete_valid(final, puzzle) else None,
            "correct": R.is_complete_valid(final, puzzle), "seconds": seconds,
            "nodes": sum("Try" in line for line in tree), "dead_ends": sum("DEAD END" in line for line in tree),
            "pruned": sum("prune branch" in line for line in tree), "search_tree": tree,
            "llm_calls": 0, "tool_calls": 0}


def run_cot(puzzle) -> dict:
    """Run TA1 cot_attempt.py (one local qwen2.5:3b call). The final grid is parsed and re-validated."""
    R.validate_shape(puzzle)
    text = "\n".join(" ".join(str(x) if x else "." for x in row) for row in puzzle)
    src = _STR_LITERAL.sub(lambda m: f'puzzle = """\n{text}\n"""', _source("cot_attempt.py"), count=1)
    code = compile(src, "ta1/cot_attempt.py", "exec")
    buf = io.StringIO()
    t0 = perf_counter()
    error = None
    try:
        with contextlib.redirect_stdout(buf):
            exec(code, {"__name__": "ta1_cot_attempt"})
    except Exception as e:
        error = type(e).__name__
    seconds = perf_counter() - t0
    out = buf.getvalue()
    rows = [[int(x) for x in ln.split()] for ln in out.splitlines() if re.fullmatch(r"\s*[1-4](\s+[1-4]){3}\s*", ln)]
    grid = rows[-4:] if len(rows) >= 4 else None
    ok = bool(grid) and R.is_complete_valid(grid, puzzle)
    return {"solution": grid if ok else None, "parsed_grid": grid, "correct": ok, "seconds": seconds,
            "llm_calls": 1, "tool_calls": 0, "error": error, "raw_output": out, "nodes": None}
