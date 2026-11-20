"""LangGraph checkpointed workflow with SQLite persistence and thread_id."""
from pathlib import Path
from typing import TypedDict, Any
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.sqlite import SqliteSaver
from .agents import BacktrackerAgent, valid_board

DB = Path(__file__).resolve().parent.parent / "checkpoints.sqlite3"

class SudokuState(TypedDict, total=False):
    puzzle: list[list[int]]
    solution: list[list[int]] | None
    trace: list[dict[str, Any]]
    status: str
    hops: int
    max_hops: int


def _solve_node(state: SudokuState) -> SudokuState:
    solver = BacktrackerAgent()
    solution = solver.solve(state["puzzle"])
    return {"solution": solution, "trace": solver.trace,
            "status": "solved" if solution and valid_board(solution, state["puzzle"]) else "unsolved",
            "hops": state.get("hops", 0) + 1}


def build_graph(checkpointer):
    graph = StateGraph(SudokuState)
    graph.add_node("solve", _solve_node)
    graph.add_edge(START, "solve")
    graph.add_edge("solve", END)
    return graph.compile(checkpointer=checkpointer)


def run_checkpointed(puzzle: list[list[int]], thread_id: str = "sudoku-demo") -> dict:
    # SQLite saver remains open for the graph invocation; checkpoint rows persist after close.
    with SqliteSaver.from_conn_string(str(DB)) as saver:
        app = build_graph(saver)
        return app.invoke({"puzzle": puzzle, "status": "started", "hops": 0, "max_hops": 5},
                          config={"configurable": {"thread_id": thread_id}})
