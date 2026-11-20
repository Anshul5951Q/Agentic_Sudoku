"""Pydantic schemas for the API (spec 8.4).

Conventions (documented in docs/API.md): boards are 4x4 lists of integers, 0 = empty (never null);
coordinates are zero-based [row, col]; IDs are stable strings like ``run-3f9a1c0b7d21``.
"""
from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StrictInt, model_validator

from ta2 import sudoku_rules as R
from ta2.models import SearchNode, TraceEvent, VoteResult  # reused so API and engine share one definition

__all__ = ["Board", "SearchNode", "TraceEvent", "VoteResult"]


def _check_board(v):
    R.validate_shape(v)
    return v


Board = Annotated[list[list[StrictInt]], AfterValidator(_check_board)]
RunMode = Literal["cot", "tot", "multi-agent"]
RunStatus = Literal["queued", "running", "paused", "completed", "failed", "cancelled", "interrupted"]
TERMINAL_STATUSES = ("completed", "failed", "cancelled")


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ------------------------------------------------------------------ errors
class ErrorBody(BaseModel):
    code: str
    message: str
    recoverable: bool
    retryable: bool
    details: dict[str, Any] = Field(default_factory=dict)


class APIError(BaseModel):
    error: ErrorBody


# ------------------------------------------------------------------ puzzles
class PuzzleCreate(_Model):
    board: Board
    name: str | None = Field(default=None, max_length=80)
    source: Literal["user", "sample", "generated"] = "user"


class Puzzle(BaseModel):
    puzzle_id: str
    session_id: str
    name: str | None = None
    board: Board
    source: str = "user"
    created_at: str
    solution_count: int | None = Field(default=None, description="0, 1 or 2 (2 means 'two or more'); None if not checked")
    unique: bool | None = None
    solvable: bool | None = None
    generation: dict[str, Any] | None = None


class BoardRequest(_Model):
    board: Board


class Conflict(BaseModel):
    kind: Literal["row", "col", "box"]
    index: int
    value: int
    cells: list[list[int]]


class PuzzleValidation(BaseModel):
    valid: bool = Field(description="no duplicate in any row/column/box (partial boards allowed)")
    complete: bool
    solved: bool = Field(description="complete AND rule-valid; never true for an unverified grid")
    empties: int
    conflicts: list[Conflict]
    message: str


class SolutionCount(BaseModel):
    count: int = Field(description="solutions found, capped at limit")
    limit: int = 2
    classification: Literal["none", "unique", "multiple"]
    solvable: bool
    unique: bool


class GenerateRequest(_Model):
    clues: int = Field(default=6, ge=4, le=12)
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)
    max_attempts: int = Field(default=5000, ge=1, le=20000)
    save: bool = True


# ------------------------------------------------------------------ runs
class SolveRequest(_Model):
    puzzle_id: str | None = Field(default=None, max_length=64)
    board: Board | None = None
    strategy: Literal["mrv", "first_empty"] = "mrv"
    order: Literal["asc", "desc", "middle"] = "asc"
    max_nodes: int = Field(default=10000, ge=1, le=100000)
    timeout_s: float = Field(default=30.0, ge=0.05, le=300)

    @model_validator(mode="after")
    def _one_source(self):
        if (self.puzzle_id is None) == (self.board is None):
            raise ValueError("provide exactly one of puzzle_id or board")
        return self


class RunFailure(BaseModel):
    code: str
    reason: str


class RunResult(BaseModel):
    outcome: Literal["solved", "exhausted", "limit_reached", "failed", "cancelled", "no_valid_vote", "incorrect"]
    verified: bool = Field(description="True only if a complete board passed deterministic verification")
    solution: Board | None = None
    failure: RunFailure | None = None
    counters: dict[str, Any] = Field(default_factory=dict)
    vote: VoteResult | None = None
    llm_calls: int = 0
    tool_calls: int = 0
    elapsed_seconds: float | None = None
    note: str | None = None


class SolveRun(BaseModel):
    run_id: str
    thread_id: str
    session_id: str
    puzzle_id: str
    mode: RunMode
    status: RunStatus
    board: Board
    config: dict[str, Any]
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    result: RunResult | None = None
    progress: dict[str, Any] = Field(default_factory=dict)
    last_sequence: int = -1
    live: bool = Field(description="True while a worker is executing; a finished run's trace is a recorded replay")
    resumable: bool = False
    duplicate: bool = False
    deterministic_components: list[str] = []
    llm_components: list[str] = []


class TraceResponse(BaseModel):
    run_id: str
    status: RunStatus
    live: bool
    recorded: bool
    last_sequence: int
    terminal: bool
    events: list[TraceEvent]
    nodes: list[SearchNode]


class AgentMessage(BaseModel):
    event: str
    sequence: int
    reason_code: str | None = None
    reason: str | None = None
    timestamp: str


class AgentStatus(BaseModel):
    agent: str
    status: Literal["idle", "running", "waiting", "completed", "failed"]
    current_task: str | None = None
    latest_message: AgentMessage | None = None
    event_count: int = 0
    tool_calls: int = 0
    first_activity_at: str | None = None
    last_activity_at: str | None = None
    active_seconds: float | None = None
    error: str | None = None


class AgentStatusResponse(BaseModel):
    run_id: str
    run_status: RunStatus
    mode: RunMode
    agents: list[AgentStatus]
    routing_trace: list[dict[str, Any]] = []
    note: str


class CheckpointSummary(BaseModel):
    thread_id: str
    status: str | None
    search_steps: int | None
    depth: int | None
    events: int | None
    resumable: bool
    detail: str | None = None


# ------------------------------------------------------------------ memory / rag
class MemoryCreate(_Model):
    user_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    kind: Literal["profile", "puzzle_history", "dead_ends"]
    key: str = Field(min_length=1, max_length=200)
    payload: dict[str, Any]


class MemoryRecord(BaseModel):
    memory_id: int
    user_id: str
    kind: str
    memory_key: str
    payload: Any
    created_at: str
    last_used_at: str | None = None
    use_count: int = 0


class RAGQuery(_Model):
    query: str = Field(min_length=1, max_length=500)
    k: Literal[1, 3] = 3


class Evidence(BaseModel):
    chunk_id: str | None
    heading: str | None
    text: str
    similarity: float
    distance: float | None = None


class RAGResponse(BaseModel):
    query: str
    k: int
    answer: str
    abstained: bool
    reason_code: str
    evidence: list[Evidence] = []
    retrieved_chunk_ids: list[str] = []
    top_similarity: float | None = None
    threshold: float | None = None
    llm_calls: int = 0


# ------------------------------------------------------------------ evaluation
class EvaluationRequest(_Model):
    with_cot: bool = False
    with_rag: bool = True


class EvaluationMetrics(BaseModel):
    """Measured metrics for one system on one case. Fields a system does not have are null."""
    correct: bool | None = None
    nodes: int | float | None = None
    pruned: int | None = None
    backtracks: int | None = None
    median_seconds: float | None = None
    seconds: float | None = None
    solver_calls: int | None = None
    llm_calls: int | None = None
    tool_calls: int | None = None
    hops: int | None = None
    votes: dict[str, int] | None = None
    disagreement: bool | None = None
    rag_retrievals: int | None = None
    skipped: str | None = None


class EvaluationCase(BaseModel):
    case: int
    name: str
    puzzle: Board
    empties: int
    solution_count: int
    systems: dict[str, EvaluationMetrics]


class EvaluationRun(BaseModel):
    evaluation_id: str
    status: Literal["running", "completed", "failed"]
    created_at: str
    finished_at: str | None = None
    options: dict[str, Any] = {}
    cases: list[EvaluationCase] = []
    memory_comparison: list[dict[str, Any]] = []
    notes: list[str] = []
    timing: str | None = None
    error: str | None = None


# ------------------------------------------------------------------ approvals (human oversight)
class ApprovalRequest(_Model):
    board: Board
    user_text: str = Field(default="", max_length=500)


class ApprovalDecision(_Model):
    approved: bool


class Approval(BaseModel):
    approval_id: str
    status: Literal["pending", "approved", "rejected", "blocked"]
    board_before: Board
    suggestion: dict[str, Any] | None = None
    suggestion_error: str | None = None
    guard: dict[str, Any] | None = None
    outcome: str | None = None
    board_after: Board | None = None
    applied: bool = False
    user_text: str = ""
    created_at: str
    decided_at: str | None = None
    events: list[dict[str, Any]] = []
    note: str = "AI suggestions are advisory: nothing is applied without deterministic validation and explicit approval."


# ------------------------------------------------------------------ status
class Health(BaseModel):
    status: Literal["ok"]
    service: str = "sudokumind-api"
    version: str
    time: str


class ComponentStatus(BaseModel):
    name: str
    status: Literal["up", "down", "degraded", "not_initialized"]
    detail: str | None = None


class RuntimeStatus(BaseModel):
    backend: ComponentStatus
    ollama: ComponentStatus
    models: list[ComponentStatus]
    vector_store: ComponentStatus
    database: ComponentStatus
    ready_for_llm: bool
    ready_for_rag: bool


# ------------------------------------------------------------------ history / analytics
class RunSummary(BaseModel):
    run_id: str
    mode: RunMode
    status: RunStatus
    created_at: str
    finished_at: str | None = None
    outcome: str | None = None
    verified: bool | None = None
    nodes: int | None = None
    pruned: int | None = None
    backtracks: int | None = None
    elapsed_seconds: float | None = None
    llm_calls: int | None = None
    resumable: bool = False


class SessionSummary(BaseModel):
    session_id: str
    puzzle_id: str
    title: str | None
    board: Board
    created_at: str
    updated_at: str
    runs_count: int
    last_run: RunSummary | None = None


class SessionList(BaseModel):
    total: int
    limit: int
    offset: int
    sessions: list[SessionSummary]


class SessionDetail(BaseModel):
    session: SessionSummary
    puzzle: Puzzle
    runs: list[RunSummary]


class AnalyticsSummary(BaseModel):
    sessions_saved: int
    puzzles_total: int
    runs_total: int
    runs_by_mode: dict[str, int]
    runs_by_status: dict[str, int]
    puzzles_solved: int
    verified_runs: int
    average_solve_seconds: float | None
    search_nodes_explored: int
    dead_end_branches: int
    branches_pruned: int
    backtracks: int
    llm_calls: int
    tool_calls: int
    latest_evaluation: dict[str, Any] | None = None
    source: str = "computed from stored runs; nothing is hardcoded"
