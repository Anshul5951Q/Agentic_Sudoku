"""Regenerates the 'solved example' chunks of the RAG corpus by running the verified solver.

Usage: python -m ta2.corpus_build        (rewrites the SOLVED EXAMPLE section of the corpus file)
Nothing here is hand-typed: boards and event counts come from real search runs.
"""
from __future__ import annotations

from . import config
from . import sudoku_rules as R
from .agents import BacktrackerAgent

MARK = "[CHUNK 11: SOLVED EXAMPLE"
SAMPLE = [[0, 0, 3, 4], [3, 4, 0, 0], [0, 1, 4, 0], [4, 0, 0, 1]]
OTHER = [[0, 2, 0, 4], [3, 0, 1, 0], [0, 1, 0, 3], [4, 0, 2, 0]]


def grid(b) -> str:
    return " / ".join(" ".join(str(x) if x else "." for x in row) for row in b)


def example(n: int, puzzle, strategy: str, order: str) -> str:
    b = BacktrackerAgent()
    sol = b.solve(puzzle, order=order, strategy=strategy)
    assert sol is not None and R.is_complete_valid(sol, puzzle) and R.count_solutions(puzzle) == 1
    c = b.state["counters"]
    return (f"[CHUNK {10 + n}: SOLVED EXAMPLE {n}]\n"
            f"Puzzle (rows separated by '/', '.' = empty): {grid(puzzle)}. Unique solution: {grid(sol)}. "
            f"Solved with the {strategy} cell strategy and {order} candidate order in {c['nodes']} search nodes, "
            f"{c['dead_ends']} dead ends and {c['backtracks']} backtracks; the final board was verified against all rules and the original clues.")


def build() -> str:
    text = config.CORPUS.read_text(encoding="utf-8").replace("\r\n", "\n")
    base = text.split(MARK)[0].rstrip() + "\n\n"
    ex = [example(1, SAMPLE, "first_empty", "desc"), example(2, SAMPLE, "mrv", "asc"), example(3, OTHER, "mrv", "asc")]
    return base + "\n\n".join(ex) + "\n"


if __name__ == "__main__":
    config.CORPUS.write_text(build(), encoding="utf-8", newline="\n")
    print("rewrote", config.CORPUS.name)
