/** TypeScript mirrors of the backend schemas (docs/API.md). Boards are 4x4 ints, 0 = empty; coords are zero-based [row, col]. */
export type Board = number[][];
export type Cell = [number, number];

export interface Puzzle {
  puzzle_id: string;
  session_id: string;
  name: string | null;
  board: Board;
  source: string;
  created_at: string;
  solution_count: number | null;
  unique: boolean | null;
  solvable: boolean | null;
  generation: Record<string, unknown> | null;
}

export interface Conflict {
  kind: 'row' | 'col' | 'box';
  index: number;
  value: number;
  cells: number[][];
}

export interface PuzzleValidation {
  valid: boolean;
  complete: boolean;
  solved: boolean;
  empties: number;
  conflicts: Conflict[];
  message: string;
}

export interface SolutionCount {
  count: number;
  limit: number;
  classification: 'none' | 'unique' | 'multiple';
  solvable: boolean;
  unique: boolean;
}

export interface ComponentStatus {
  name: string;
  status: 'up' | 'down' | 'degraded' | 'not_initialized';
  detail: string | null;
}

export interface RuntimeStatus {
  backend: ComponentStatus;
  ollama: ComponentStatus;
  models: ComponentStatus[];
  vector_store: ComponentStatus;
  database: ComponentStatus;
  ready_for_llm: boolean;
  ready_for_rag: boolean;
}

export interface Health {
  status: 'ok';
  service: string;
  version: string;
  time: string;
}

export interface RunSummary {
  run_id: string;
  mode: 'cot' | 'tot' | 'multi-agent';
  status: string;
  created_at: string;
  finished_at: string | null;
  outcome: string | null;
  verified: boolean | null;
  nodes: number | null;
  elapsed_seconds: number | null;
}

export interface SessionSummary {
  session_id: string;
  puzzle_id: string;
  title: string | null;
  board: Board;
  created_at: string;
  updated_at: string;
  runs_count: number;
  last_run: RunSummary | null;
}

export interface SessionList {
  total: number;
  limit: number;
  offset: number;
  sessions: SessionSummary[];
}

export interface AnalyticsSummary {
  sessions_saved: number;
  puzzles_total: number;
  runs_total: number;
  puzzles_solved: number;
  verified_runs: number;
  average_solve_seconds: number | null;
  search_nodes_explored: number;
  dead_end_branches: number;
  branches_pruned: number;
  backtracks: number;
  llm_calls: number;
  tool_calls: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; recoverable: boolean; retryable: boolean; details: Record<string, unknown> };
}

// ---------------------------------------------------------------- runs, agents, votes
export type RunMode = 'cot' | 'tot' | 'multi-agent';
export type RunStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface VoteResult {
  vote_type: string;
  votes: Record<string, number>;
  winner: number[][] | null;
  winner_key: string | null;
  eligible: string[];
  excluded: { attempt: string; reason: string }[];
  disagreement: boolean;
  solution_count: number | null;
  note: string;
}

export interface AttemptRecord {
  name: string;
  kind?: string;
  order: string;
  strategy: string;
  status: string;
  nodes: number;
  seconds?: number;
  error: string | null;
  valid: boolean;
  solution: number[][] | null;
  counters?: Record<string, number>;
}

export interface RunResult {
  outcome: string;
  verified: boolean;
  solution: number[][] | null;
  failure: { code: string; reason: string } | null;
  counters: Record<string, any> & { attempts?: AttemptRecord[]; hops?: number; max_hops?: number };
  vote: VoteResult | null;
  llm_calls: number;
  tool_calls: number;
  elapsed_seconds: number | null;
  note: string | null;
}

export interface SolveRun {
  run_id: string;
  thread_id: string;
  session_id: string;
  puzzle_id: string;
  mode: RunMode;
  status: RunStatus;
  board: number[][];
  config: Record<string, any>;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  result: RunResult | null;
  progress: Record<string, any>;
  last_sequence: number;
  live: boolean;
  resumable: boolean;
  duplicate: boolean;
  deterministic_components: string[];
  llm_components: string[];
}

export interface RunListItem {
  run_id: string;
  mode: RunMode;
  status: RunStatus;
  created_at: string;
  finished_at: string | null;
  outcome: string | null;
  verified: boolean | null;
  nodes: number | null;
  elapsed_seconds: number | null;
  resumable: boolean;
  puzzle_id: string;
  session_id: string;
  thread_id: string;
  board: number[][];
  config: Record<string, any>;
}

export interface TraceEvent {
  event_id: string;
  run_id: string;
  thread_id: string;
  sequence: number;
  event: string;
  agent: string;
  depth: number;
  cell: number[] | null;
  candidate: number | null;
  candidates: number[] | null;
  reason_code: string | null;
  reason: string | null;
  board_snapshot: number[][] | null;
  node_id: string | null;
  timestamp: string;
  data: Record<string, any>;
}

export interface TraceResponse {
  run_id: string;
  status: RunStatus;
  live: boolean;
  recorded: boolean;
  last_sequence: number;
  terminal: boolean;
  events: TraceEvent[];
}

export interface AgentContract {
  name: string;
  goal: string;
  tools: string[];
  inputs_outputs: string;
  limits: string;
}

export interface AgentMessage {
  event: string;
  sequence: number;
  reason_code: string | null;
  reason: string | null;
  timestamp: string;
}

export interface AgentStatus {
  agent: string;
  status: 'idle' | 'running' | 'waiting' | 'completed' | 'failed';
  current_task: string | null;
  latest_message: AgentMessage | null;
  event_count: number;
  tool_calls: number;
  retries: number;
  recovered: number;
  first_activity_at: string | null;
  last_activity_at: string | null;
  active_seconds: number | null;
  error: string | null;
}

export interface AgentStatusResponse {
  run_id: string;
  run_status: RunStatus;
  mode: RunMode;
  agents: AgentStatus[];
  routing_trace: { hop: number; to: string; reason: string | null; sequence: number }[];
  note: string;
}

export interface CheckpointSummary {
  thread_id: string;
  status: string | null;
  search_steps: number | null;
  depth: number | null;
  events: number | null;
  resumable: boolean;
  detail: string | null;
}

// ---------------------------------------------------------------- memory, rag, chat, approvals
export interface MemoryRecord {
  memory_id: number;
  user_id: string;
  kind: string;
  memory_key: string;
  payload: any;
  created_at: string;
  last_used_at: string | null;
  use_count: number;
}

export interface Evidence {
  chunk_id: string | null;
  heading: string | null;
  text: string;
  similarity: number;
  distance: number | null;
}

export interface RAGResponse {
  query: string;
  k: number;
  answer: string;
  abstained: boolean;
  reason_code: string;
  evidence: Evidence[];
  retrieved_chunk_ids: string[];
  top_similarity: number | null;
  threshold: number | null;
  llm_calls: number;
}

export interface ChatResponse {
  thread_id: string | null;
  memory: boolean;
  reply: string;
  messages_seen_by_model: number;
  history_len: number;
  note: string;
}

export interface ChatHistory {
  thread_id: string;
  messages: { role: string; content: string }[];
  puzzle: number[][] | null;
  restored_from_checkpoint: boolean;
}

export interface Approval {
  approval_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'blocked';
  board_before: number[][];
  suggestion: { row: number; col: number; value: number } | null;
  suggestion_error: string | null;
  proposer: string;
  guard: { allowed?: boolean; code: string; reason: string } | null;
  outcome: string | null;
  board_after: number[][] | null;
  applied: boolean;
  user_text: string;
  created_at: string;
  decided_at: string | null;
  events: Record<string, any>[];
  note: string;
}

export type SolveBody = {
  puzzle_id?: string;
  board?: number[][];
  strategy?: 'mrv' | 'first_empty';
  order?: 'asc' | 'desc' | 'middle';
  max_nodes?: number;
  timeout_s?: number;
  max_hops?: number;
  faults?: { variant: 'asc' | 'desc' | 'middle'; kind: 'invalid_board' | 'crash' | 'timeout' }[];
  inject_tool_failure?: { tool: 'rag_retrieve'; times: number };
  use_memory?: boolean;
  user_id?: string;
};
