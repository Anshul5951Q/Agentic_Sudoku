import { SAMPLE } from './helpers';

/** Shapes copied from real backend responses (docs/API.md); the UI must render them verbatim. */
export const CONTRACTS = [
  { name: 'Proposer', goal: 'Select the next empty cell and list its legal candidates in a given order.', tools: ['candidate generator', 'optional local qwen2.5:3b ordering hint'], inputs_outputs: 'IN: board, strategy, order. OUT: cell and legal candidates.', limits: 'Cannot commit a move.' },
  { name: 'Evaluator / RuleChecker', goal: 'Assess whether a single candidate placement is legal.', tools: ['row/column/box validator'], inputs_outputs: 'IN: board, cell, value. OUT: Verdict.', limits: 'Judges one placement only.' },
  { name: 'Verifier', goal: 'Verify partial states and complete boards.', tools: ['find_conflicts', 'is_complete_valid'], inputs_outputs: 'IN: board. OUT: Verdict.', limits: 'Never accepts an incomplete board.' },
  { name: 'Verifier / Backtracker', goal: 'Detect dead ends and restore the exact parent board.', tools: ['SearchEngine', 'state stack'], inputs_outputs: 'IN: partial state. OUT: branch status.', limits: 'Must restore the exact parent state.' },
  { name: 'Supervisor', goal: 'Coordinate the agents and enforce execution policy.', tools: ['agent router', 'ToolRunner'], inputs_outputs: 'IN: puzzle + config. OUT: routing trace, VoteResult.', limits: 'Hard MAX_HOPS, per-run timeout, node and tool budgets.' },
];

export const agent = (name: string, over: Record<string, unknown> = {}) => ({
  agent: name, status: 'completed', current_task: 'verified winner selected', event_count: 4, tool_calls: 0, retries: 0, recovered: 0,
  first_activity_at: 't0', last_activity_at: 't1', active_seconds: 0.012, error: null,
  latest_message: { event: 'search_completed', sequence: 20, reason_code: 'SOLVED', reason: 'verified winner selected', timestamp: 't1' }, ...over,
});

export const idle = (name: string) => ({ agent: name, status: 'idle', current_task: null, latest_message: null, event_count: 0, tool_calls: 0, retries: 0, recovered: 0, first_activity_at: null, last_activity_at: null, active_seconds: null, error: null });

export const agentsResp = (agents: any[], over: Record<string, unknown> = {}) => ({
  run_id: 'run-1', run_status: 'completed', mode: 'multi-agent', agents,
  routing_trace: [
    { hop: 1, to: 'Verifier', reason: 'validate the input puzzle', sequence: 0 },
    { hop: 2, to: 'SolverVariants', reason: 'run 3 candidate-order variants', sequence: 1 },
    { hop: 3, to: 'Verifier', reason: "verify every attempt's board deterministically", sequence: 30 },
    { hop: 4, to: 'Supervisor', reason: 'tally votes from verified solutions only', sequence: 31 },
  ],
  note: 'Status is derived from the stored trace. Multi-agent "variants" are candidate-order variants of one deterministic solver, not independent LLM agents.', ...over,
});

export const KEY = '1234/3412/2143/4321';
export const attempt = (name: string, order: string, over: Record<string, unknown> = {}) => ({
  name, kind: 'candidate-order variant', order, strategy: 'first_empty', status: 'solved', nodes: 11, seconds: 0.002, error: null, valid: true,
  solution: [[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]], counters: { pruned: 2, backtracks: 2 }, ...over,
});

export const vote = (over: Record<string, unknown> = {}) => ({
  vote_type: 'candidate_order_variants', votes: { [KEY]: 3 }, winner: [[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]], winner_key: KEY,
  eligible: ['variant-asc', 'variant-desc', 'variant-middle'], excluded: [], disagreement: false, solution_count: 1,
  note: 'vote counts only deterministically verified complete boards from candidate-order variants; invalid, partial, errored or timed-out attempts are excluded', ...over,
});

export const run = (over: Record<string, any> = {}) => ({
  run_id: 'run-1', thread_id: 'thread-abc', session_id: 'session-1', puzzle_id: 'puzzle-1', mode: 'multi-agent', status: 'completed', board: SAMPLE,
  config: { strategy: 'first_empty', order: 'asc', max_nodes: 10000, timeout_s: 30, max_hops: null, faults: [], inject_tool_failure: null },
  created_at: 't', started_at: 't', finished_at: 't', progress: {}, last_sequence: 30, live: false, resumable: false, duplicate: false,
  deterministic_components: ['cell selection', 'rule checking', 'supervisor routing and MAX_HOPS', 'vote counting (verified solutions only)'], llm_components: [],
  result: {
    outcome: 'solved', verified: true, solution: [[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]], failure: null,
    counters: { hops: 4, max_hops: 8, solver_calls: 3, attempts: [attempt('variant-asc', 'asc'), attempt('variant-desc', 'desc'), attempt('variant-middle', 'middle')] },
    vote: vote(), llm_calls: 0, tool_calls: 0, elapsed_seconds: 0.01, note: 'Variants differ only in candidate ordering; they are not independent LLM agents.',
  }, ...over,
});

export const ev = (sequence: number, event: string, over: Record<string, unknown> = {}) => ({
  event_id: `run-1-event-${String(sequence).padStart(5, '0')}`, run_id: 'run-1', thread_id: 'thread-abc', sequence, event, agent: 'Supervisor', depth: 0,
  cell: null, candidate: null, candidates: null, reason_code: null, reason: null, board_snapshot: null, node_id: null, timestamp: 't', data: {}, ...over,
});

export const trace = (events: any[], over: Record<string, unknown> = {}) => ({ run_id: 'run-1', status: 'completed', live: false, recorded: true, last_sequence: events.length - 1, terminal: true, events, ...over });

export const approval = (over: Record<string, any> = {}) => ({
  approval_id: 'approval-1', status: 'pending', board_before: SAMPLE, suggestion: { row: 0, col: 1, value: 2 }, suggestion_error: null, proposer: 'stand_in',
  guard: { allowed: true, code: 'OK', reason: 'valid placement' }, outcome: null, board_after: null, applied: false, user_text: '', created_at: 't', decided_at: null,
  events: [], note: 'AI suggestions are advisory: nothing is applied without deterministic validation and explicit approval.', ...over,
});
