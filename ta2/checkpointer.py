"""Resumable search workflow: LangGraph + SQLite checkpointer, one checkpoint per search decision.

The graph loops a single ``step`` node (one engine decision per superstep) so LangGraph persists the
full search state (board, decision stack, pending candidates, node tree, events, counters) under a
stable ``thread_id`` after every decision. A run can pause at a step boundary and be resumed later,
from a new connection or process, without restarting from the root.
"""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
from typing import Any, TypedDict

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph

from . import config
from . import sudoku_rules as R
from .models import utc_now
from .search import SearchEngine

DB = config.CHECKPOINT_DB


class CheckpointError(Exception):
    """Missing or invalid checkpoint; recoverable (start a new run)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


class SudokuState(TypedDict, total=False):
    run_id: str
    thread_id: str
    puzzle: list
    board: list
    stack: list
    nodes: dict
    events: list
    seq: int
    status: str
    phase: str
    solution: Any
    current_node_id: Any
    strategy: str
    order: str
    max_nodes: int
    node_seq: int
    counters: dict
    failure: Any
    pause_at_step: Any
    paused: bool


_REQUIRED = ("run_id", "puzzle", "board", "stack", "nodes", "events", "seq", "status", "phase", "counters")


def validate_state(s: dict) -> None:
    try:
        missing = [k for k in _REQUIRED if k not in s]
        if missing:
            raise ValueError(f"missing keys {missing}")
        R.validate_shape(s["puzzle"])
        R.validate_shape(s["board"])
        if not R.is_consistent(s["board"]):
            raise ValueError("board violates Sudoku rules")
        if any(s["puzzle"][r][c] and s["puzzle"][r][c] != s["board"][r][c] for r in range(4) for c in range(4)):
            raise ValueError("board no longer preserves the original clues")
        if s["seq"] != len(s["events"]):
            raise ValueError("event sequence does not match stored events")
        for f in s["stack"]:
            R.validate_shape(f["board_before"])
    except (ValueError, KeyError, TypeError, R.InvalidBoard) as e:
        raise CheckpointError("CHECKPOINT_INVALID", f"checkpoint failed validation: {e}") from None


def build_graph(checkpointer, memory_hook=None, crash_at_step: int | None = None):
    """crash_at_step simulates a process crash inside the step node (used by tests/demos)."""
    engine = SearchEngine(memory_hook=memory_hook)

    def step(state: SudokuState) -> SudokuState:
        s = deepcopy(dict(state))
        if s.get("paused"):
            engine._emit(s, "search_resumed", "Supervisor", reason_code="RESUMED",
                         reason="resumed from checkpoint", data={"at_step": s["counters"]["steps"]})
            s["paused"] = False
        if crash_at_step is not None and s["counters"]["steps"] + 1 == crash_at_step:
            raise RuntimeError("simulated crash")
        engine.step(s)
        return s

    def pause(state: SudokuState) -> SudokuState:
        s = deepcopy(dict(state))
        s["paused"] = True
        engine._emit(s, "search_paused", "Supervisor", reason_code="PAUSED",
                     reason="paused at a safe decision boundary", data={"at_step": s["counters"]["steps"]},
                     board_snapshot=R.copy_board(s["board"]))
        return s

    def route(state: SudokuState) -> str:
        if state["status"] != "running":
            return END
        limit = state.get("pause_at_step")
        if limit is not None and state["counters"]["steps"] >= limit:
            return "pause"
        return "step"

    g = StateGraph(SudokuState)
    g.add_node("step", step)
    g.add_node("pause", pause)
    g.add_edge(START, "step")
    g.add_conditional_edges("step", route, {"step": "step", "pause": "pause", END: END})
    g.add_edge("pause", END)
    return g.compile(checkpointer=checkpointer)


@contextmanager
def open_saver(db_path: str | Path = DB):
    with SqliteSaver.from_conn_string(str(db_path)) as saver:
        yield saver


def _cfg(thread_id: str) -> dict:
    return {"configurable": {"thread_id": thread_id}, "recursion_limit": 1_000_000}


def start_search(app, puzzle, thread_id: str, strategy: str = "mrv", order: str = "asc",
                 max_steps: int | None = None, max_nodes: int = 10000) -> dict:
    """Begin a new search on `thread_id`; optionally pause after `max_steps` decisions."""
    state = SearchEngine.init_state(puzzle, run_id=thread_id, thread_id=thread_id, strategy=strategy,
                                    order=order, max_nodes=max_nodes)
    state.update(pause_at_step=max_steps, paused=False)
    return app.invoke(state, _cfg(thread_id))


def load_state(app, thread_id: str) -> dict:
    snap = app.get_state(_cfg(thread_id))
    if not snap.values:
        raise CheckpointError("NO_CHECKPOINT", f"no checkpoint for thread '{thread_id}'")
    validate_state(snap.values)
    return dict(snap.values)


def resume_search(app, thread_id: str, max_steps: int | None = None) -> dict:
    """Continue from the last checkpoint of `thread_id` (never from the root)."""
    cfg = _cfg(thread_id)
    snap = app.get_state(cfg)
    if not snap.values:
        raise CheckpointError("NO_CHECKPOINT", f"no checkpoint for thread '{thread_id}'")
    validate_state(snap.values)
    if snap.values["status"] != "running":
        return dict(snap.values)  # already finished; nothing to resume
    if snap.next:  # interrupted mid-run (e.g. crash): replay from the last good checkpoint
        if max_steps is not None:
            app.update_state(cfg, {"pause_at_step": snap.values["counters"]["steps"] + max_steps})
        return app.invoke(None, cfg)
    limit = None if max_steps is None else snap.values["counters"]["steps"] + max_steps
    return app.invoke({"pause_at_step": limit}, cfg)


def checkpoint_summaries(saver, thread_id: str) -> list[dict]:
    out = []
    for t in saver.list(_cfg(thread_id)):
        v = t.checkpoint.get("channel_values", {})
        c = v.get("counters", {})
        out.append({"checkpoint_id": t.config["configurable"]["checkpoint_id"], "step": t.metadata.get("step"),
                    "status": v.get("status"), "search_steps": c.get("steps"), "events": len(v.get("events", [])),
                    "depth": len(v.get("stack", []))})
    return out


def run_checkpointed(puzzle, thread_id: str = "sudoku-demo", db_path: str | Path = DB, strategy: str = "mrv",
                     order: str = "asc") -> dict:
    """Backwards-compatible helper: solve to completion on a checkpointed thread."""
    with open_saver(db_path) as saver:
        app = build_graph(saver)
        try:
            return resume_search(app, thread_id)
        except CheckpointError as e:
            if e.code != "NO_CHECKPOINT":
                raise
            return start_search(app, puzzle, thread_id, strategy, order)
