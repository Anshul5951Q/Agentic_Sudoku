"""Repeatable TA1-vs-TA2 evaluation harness. All numbers are measured at runtime."""
from copy import deepcopy
from time import perf_counter
from .agents import BacktrackerAgent, valid_board
from .supervisor import Supervisor

BASE = [[0,0,3,4],[3,4,0,0],[0,1,4,0],[4,0,0,1]]
# Five test cases derived by removing clues from a known valid 4x4 Sudoku.
SOLVED = [[1,2,3,4],[3,4,1,2],[2,1,4,3],[4,3,2,1]]
MASKS = [
    [(0,0),(0,1),(1,2),(1,3),(2,0),(2,3),(3,1),(3,2)],
    [(0,0),(0,2),(1,1),(1,3),(2,0),(2,2),(3,1),(3,3)],
    [(0,1),(0,3),(1,0),(1,2),(2,1),(2,3),(3,0),(3,2)],
    [(0,0),(0,1),(0,2),(1,1),(1,2),(2,0),(2,3),(3,2)],
    [(0,1),(0,3),(1,0),(1,3),(2,0),(2,2),(3,1),(3,3)],
]

def test_puzzles():
    puzzles = [deepcopy(BASE)]
    for mask in MASKS[:4]:
        p = deepcopy(SOLVED)
        for r,c in mask: p[r][c] = 0
        puzzles.append(p)
    return puzzles

def run_evaluation():
    rows=[]
    for i,puzzle in enumerate(test_puzzles(),1):
        t0=perf_counter(); baseline=BacktrackerAgent(); bsol=baseline.solve(puzzle); bt=perf_counter()-t0
        ta2=Supervisor().solve_and_vote(puzzle)
        rows.append({"case":i,"ta1_correct":bool(bsol and valid_board(bsol,puzzle)),
                     "ta1_nodes":baseline.nodes,"ta1_seconds":round(bt,6),
                     "ta2_correct":ta2["valid"],"ta2_solver_calls":ta2["solver_calls"],
                     "ta2_total_nodes":sum(x["nodes"] for x in ta2["runs"]),
                     "ta2_seconds":ta2["elapsed_seconds"],"votes":ta2["votes"]})
    return rows
