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
