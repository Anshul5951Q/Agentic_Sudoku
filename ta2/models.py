"""Structured data models shared by the engine, traces, checkpoints and (later) the API.

Coordinate convention (whole project): zero-based ``[row, col]``; boards are 4x4 lists of ints
with ``0`` meaning empty. Human-readable prose may say "row 1, column 2" in 1-based words only
when it says so explicitly.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

# Section 6.4 event names, plus extension events produced by TA2 components.
CORE_EVENTS = (
    "search_started", "cell_selected", "candidates_generated", "candidate_proposed",
    "candidate_accepted", "rule_violation", "dead_end", "branch_pruned", "backtrack_started",
    "solution_found", "solution_verified", "search_completed", "search_failed",
)
EXTRA_EVENTS = (
    "checkpoint_saved", "search_resumed", "search_paused", "memory_hit_confirmed",
    "memory_hit_rejected", "route", "tool_call", "tool_failure", "tool_recovered",
    "guardrail_decision", "approval_requested", "approval_decision", "vote_tallied", "search_cancelled",
)
EVENT_NAMES = frozenset(CORE_EVENTS + EXTRA_EVENTS)

NodeStatus = Literal["pending", "expanded", "accepted", "rejected", "dead_end", "pruned", "solution"]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _check_cell(v):
    if v is not None and (len(v) != 2 or any(not 0 <= x <= 3 for x in v)):
        raise ValueError("cell must be [row, col] with zero-based values 0..3")
    return v


class TraceEvent(BaseModel):
    event_id: str
    run_id: str
    thread_id: str
    sequence: int = Field(ge=0)
    event: str
    agent: str
    depth: int = 0
    cell: list[int] | None = None
    candidate: int | None = None
    candidates: list[int] | None = None
    reason_code: str | None = None
    reason: str | None = None
    board_snapshot: list[list[int]] | None = None
    node_id: str | None = None
    timestamp: str = Field(default_factory=utc_now)
    data: dict[str, Any] = Field(default_factory=dict)

    @field_validator("event")
    @classmethod
    def _known_event(cls, v: str) -> str:
        if v not in EVENT_NAMES:
            raise ValueError(f"unknown event {v!r}")
        return v

    _cell = field_validator("cell")(lambda cls, v: _check_cell(v))


class SearchNode(BaseModel):
    node_id: str
    parent_node_id: str | None
    depth: int
    decision_cell: list[int] | None
    candidate_value: int | None
    board_snapshot: list[list[int]]
    status: NodeStatus = "pending"
    reason_code: str | None = None
    reason_text: str | None = None
    candidate_list: list[int] = Field(default_factory=list)
    created_at: str = Field(default_factory=utc_now)
    agent_id: str = "Backtracker"

    _cell = field_validator("decision_cell")(lambda cls, v: _check_cell(v))


class AgentContract(BaseModel):
    """The SOP's five-field role specification (Unit 4, U4-1)."""
    name: str
    goal: str
    tools: list[str]
    inputs_outputs: str
    limits: str


class Verdict(BaseModel):
    ok: bool
    code: str
    reason: str

    def __iter__(self):  # allows `ok, code, reason = verdict`
        return iter((self.ok, self.code, self.reason))


class VoteResult(BaseModel):
    vote_type: Literal["candidate_order_variants"] = "candidate_order_variants"
    votes: dict[str, int]
    winner: list[list[int]] | None
    winner_key: str | None
    eligible: list[str]
    excluded: list[dict[str, str]]
    disagreement: bool
    solution_count: int | None = None
    note: str
