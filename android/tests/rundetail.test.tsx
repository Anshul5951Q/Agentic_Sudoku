import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import RunDetailScreen from '@/screens/RunDetailScreen';
import { CONTRACTS, KEY, agent, agentsResp, attempt, ev, idle, run, trace, vote } from './fixtures';
import { BACKEND_UP, renderWithBackend, res } from './helpers';

let mockParams: Record<string, string> = { runId: 'run-1' };
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useLocalSearchParams: () => mockParams, useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]) }));

const base = (r: any, a: any, t: any, extra: Record<string, unknown> = {}) => ({
  ...BACKEND_UP, 'GET /api/solve/run-1': r, 'GET /api/agents/run-1/status': a, 'GET /api/solve/run-1/trace': t, 'GET /api/agents/contracts': CONTRACTS,
  'GET /api/solve/run-1/checkpoint': { thread_id: 'thread-abc', status: null, search_steps: null, depth: null, events: null, resumable: false, detail: 'only tree-of-thought runs are checkpointed per decision' }, ...extra,
});
const allAgents = [agent('Proposer'), agent('RuleChecker'), agent('Verifier'), idle('Backtracker'), agent('Supervisor')];
const t = (id: string) => screen.getByTestId(id);
const rx = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const section = async (s: string) => { await fireEvent.press(t(`section-${s}`)); };
beforeEach(() => { mockParams = { runId: 'run-1' }; });

describe('Agent Activity', () => {
  it('shows a card per role with status, task, latest structured message, tool calls, time and error state', async () => {
    await renderWithBackend(<RunDetailScreen />, base(run(), agentsResp(allAgents), trace([ev(0, 'search_started')])));
    await waitFor(() => expect(t('agent-Proposer')).toBeTruthy());
    for (const n of ['Proposer', 'Evaluator / RuleChecker', 'Verifier', 'Verifier / Backtracker', 'Supervisor']) expect(t(`agent-${n}`)).toBeTruthy();
    expect(t('agent-status-Proposer')).toHaveTextContent(/completed/);
    expect(t('agent-status-Verifier / Backtracker')).toHaveTextContent(/idle/);
    expect(t('agent-msg-Supervisor')).toHaveTextContent(rx('#20 search_completed [SOLVED]: verified winner selected'));
    expect(t('agent-msg-Verifier / Backtracker')).toHaveTextContent(rx('no activity in this run'));
    expect(t('agent-Supervisor')).toHaveTextContent(/0\.012 s from first to last event \(4 events; includes any pause or downtime\)/);
    expect(t('agent-error-Supervisor')).toHaveTextContent(rx('none'));
    expect(t('agents-note')).toHaveTextContent(/not independent LLM agents/);
  });

  it('shows the five-field role specification verbatim for every agent', async () => {
    await renderWithBackend(<RunDetailScreen />, base(run(), agentsResp(allAgents), trace([ev(0, 'search_started')])));
    await waitFor(() => expect(t('agent-Supervisor')).toBeTruthy());
    for (const c of CONTRACTS) {
      await fireEvent.press(t(`spec-toggle-${c.name}`));
      const spec = t(`spec-${c.name}`);
      for (const text of [c.name, c.goal, c.tools.join('; '), c.inputs_outputs, c.limits]) expect(spec).toHaveTextContent(rx(text));
    }
    expect(t('spec-Supervisor')).toHaveTextContent(/Hard MAX_HOPS/);
  });

  it('shows running / waiting / failed states, retries, recoveries and error text', async () => {
    const agents = [agent('Proposer', { status: 'running' }), agent('RuleChecker', { status: 'waiting' }), agent('Verifier'), agent('Backtracker'),
      agent('Supervisor', { status: 'failed', tool_calls: 2, retries: 1, recovered: 1, error: 'MAX_HOPS=3 reached; refused to route to Supervisor' })];
    await renderWithBackend(<RunDetailScreen />, base(run(), agentsResp(agents, { run_status: 'running' }), trace([ev(0, 'search_started')])));
    await waitFor(() => expect(t('agent-status-Proposer')).toHaveTextContent(/running/));
    expect(t('agent-status-Evaluator / RuleChecker')).toHaveTextContent(/waiting/);
    expect(t('agent-status-Supervisor')).toHaveTextContent(/failed/);
    expect(t('agent-retry-Supervisor')).toHaveTextContent(rx('1 retried · 1 recovered'));
    expect(t('agent-Supervisor')).toHaveTextContent(/Tool calls\s*2/);
    expect(t('agent-error-Supervisor')).toHaveTextContent(rx('MAX_HOPS=3 reached; refused to route to Supervisor'));
  });

  it('labels deterministic and LLM components from the backend, and live vs recorded', async () => {
    await renderWithBackend(<RunDetailScreen />, base(run(), agentsResp(allAgents), trace([ev(0, 'search_started')])));
    await waitFor(() => expect(t('run-det')).toHaveTextContent(/supervisor routing and MAX_HOPS/));
    expect(t('run-llm')).toHaveTextContent(/none: this run uses no language model/);
    expect(t('recorded-label')).toHaveTextContent(/Recorded run/);
  });

  it('a CoT run shows the LLM component the backend reports', async () => {
    const cot = run({ mode: 'cot', deterministic_components: ["final board verification (the model's answer is never trusted)"], llm_components: ['qwen2.5:3b single-path reasoning (frozen TA1 CoT prompt)'] });
    await renderWithBackend(<RunDetailScreen />, base(cot, agentsResp(allAgents, { mode: 'cot' }), trace([ev(0, 'search_started')])));
    await waitFor(() => expect(t('run-llm')).toHaveTextContent(/qwen2\.5:3b single-path reasoning/));
  });
});

describe('Supervisor routing and MAX_HOPS', () => {
  const hopRun = run({
    status: 'failed', config: { ...run().config, max_hops: 3 },
    result: { ...run().result, outcome: 'failed', verified: false, solution: null, failure: { code: 'HOP_LIMIT_EXCEEDED', reason: 'MAX_HOPS=3 reached; refused to route to Supervisor' }, vote: null,
      counters: { hops: 3, max_hops: 3, attempts: [attempt('variant-asc', 'asc')] } },
  });
  const hopAgents = agentsResp(allAgents, { routing_trace: agentsResp([]).routing_trace.slice(0, 3) });
  const hopTrace = trace([ev(0, 'search_started'), ev(1, 'route', { reason: 'Supervisor -> Verifier: validate the input puzzle', data: { hop: 1, to: 'Verifier' } }),
    ev(5, 'search_failed', { reason_code: 'HOP_LIMIT_EXCEEDED', reason: 'MAX_HOPS=3 reached; refused to route to Supervisor' })]);

  it('shows the annotated trace, hops used of MAX_HOPS, and the refusal when the limit is hit', async () => {
    await renderWithBackend(<RunDetailScreen />, base(hopRun, hopAgents, hopTrace));
    await waitFor(() => expect(t('agent-Supervisor')).toBeTruthy());
    await section('routing');
    expect(t('hops-used')).toHaveTextContent(rx('Hops used: 3 of MAX_HOPS 3'));
    expect(t('hop-1')).toHaveTextContent(rx('1/3'));
    expect(t('hop-1')).toHaveTextContent(rx('→ Verifier: validate the input puzzle'));
    expect(t('hop-3')).toHaveTextContent(rx("verify every attempt's board deterministically"));
    expect(screen.queryByTestId('hop-4')).toBeNull();
    expect(t('hop-limit-notice')).toHaveTextContent(rx('Hop limit enforced: MAX_HOPS=3 reached; refused to route to Supervisor'));
    expect(t('run-failure')).toHaveTextContent(rx('HOP_LIMIT_EXCEEDED'));
    expect(t('demo-banner')).toHaveTextContent(/MAX_HOPS limited to 3/);
  });

  it('a normal run stays within its limit and shows no refusal', async () => {
    await renderWithBackend(<RunDetailScreen />, base(run(), agentsResp(allAgents), trace([ev(0, 'search_started')])));
    await waitFor(() => expect(t('agent-Supervisor')).toBeTruthy());
    await section('routing');
    expect(t('hops-used')).toHaveTextContent(rx('Hops used: 4 of MAX_HOPS 8'));
    expect(screen.queryByTestId('hop-limit-notice')).toBeNull();
  });

  it('non-multi-agent runs say routing does not apply (no invented trace)', async () => {
    await renderWithBackend(<RunDetailScreen />, base(run({ mode: 'tot' }), agentsResp(allAgents, { mode: 'tot' }), trace([ev(0, 'search_started')])));
    await waitFor(() => expect(t('agent-Supervisor')).toBeTruthy());
    await section('routing');
    expect(screen.getByText('No supervisor routing in this run')).toBeTruthy();
  });
});

describe('Vote comparison', () => {
  const withAttempts = (list: any[]) => ({ ...run().result, counters: { ...run().result.counters, attempts: list } });
  const open = async (r: any) => {
    await renderWithBackend(<RunDetailScreen />, base(r, agentsResp(allAgents), trace([ev(0, 'search_started')])));
    await waitFor(() => expect(t('agent-Supervisor')).toBeTruthy());
    await section('votes');
  };

  it('labels the variants as candidate-order variants and shows the backend note', async () => {
    await open(run());
    expect(t('variant-label')).toHaveTextContent(/Candidate-order variants.*not independent LLM agents/);
    expect(t('vote-note')).toHaveTextContent(/only deterministically verified complete boards/);
    expect(t('attempt-verdict-variant-asc')).toHaveTextContent(rx('VOTES'));
    expect(t('vote-tally')).toHaveTextContent(rx('3 votes'));
    expect(t('winner')).toBeTruthy();
    expect(screen.queryByTestId('no-winner')).toBeNull();
  });

  it('shows invalid, crashed and timed-out attempts as EXCLUDED with the reason, and only verified ones vote', async () => {
    const list = [attempt('variant-asc', 'asc', { status: 'error', error: 'RuntimeError', valid: false, solution: null }),
      attempt('variant-desc', 'desc', { valid: false, solution: [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]] }),
      attempt('variant-middle', 'middle', { status: 'timeout', error: 'timeout', valid: false, solution: null })];
    const v = vote({ votes: {}, winner: null, winner_key: null, eligible: [], excluded: [{ attempt: 'variant-asc', reason: 'status=error' }, { attempt: 'variant-desc', reason: 'RULE_VIOLATION' }, { attempt: 'variant-middle', reason: 'status=timeout' }] });
    await open(run({ status: 'failed', result: { ...withAttempts(list), vote: v, outcome: 'no_valid_vote', verified: false, solution: null, failure: { code: 'NO_VALID_VOTE', reason: v.note } } }));
    expect(t('attempt-verdict-variant-asc')).toHaveTextContent(rx('EXCLUDED: status=error'));
    expect(t('attempt-verdict-variant-desc')).toHaveTextContent(rx('EXCLUDED: RULE_VIOLATION'));
    expect(t('attempt-verdict-variant-middle')).toHaveTextContent(rx('EXCLUDED: status=timeout'));
    expect(t('attempt-variant-asc')).toHaveTextContent(rx('error (RuntimeError)'));
    expect(screen.queryByTestId('vote-tally')).toBeNull();
  });

  it('shows NO WINNER with the backend reason when every attempt fails', async () => {
    const v = vote({ votes: {}, winner: null, winner_key: null, eligible: [], excluded: [{ attempt: 'variant-asc', reason: 'RULE_VIOLATION' }] });
    await open(run({ status: 'failed', result: { ...withAttempts([attempt('variant-asc', 'asc', { valid: false })]), vote: v, outcome: 'no_valid_vote', verified: false, solution: null, failure: { code: 'NO_VALID_VOTE', reason: 'no valid vote, so no winner' } } }));
    expect(t('no-winner')).toHaveTextContent(rx('No winner: NO_VALID_VOTE: no valid vote, so no winner'));
    expect(screen.queryByTestId('winner')).toBeNull();
  });

  it('surfaces a disagreement between verified solutions instead of hiding it', async () => {
    const other = '2143/4321/1234/3412';
    const v = vote({ votes: { [KEY]: 1, [other]: 1 }, winner: null, winner_key: null, disagreement: true, solution_count: 2, note: 'verified solutions DISAGREE (puzzle likely has several solutions), reported rather than hidden' });
    await open(run({ status: 'failed', result: { ...run().result, vote: v, outcome: 'no_valid_vote', verified: false, solution: null, failure: { code: 'NO_UNIQUE_WINNER', reason: v.note } } }));
    expect(t('disagreement')).toHaveTextContent(/DISAGREE.*2 or more/);
    expect(t('vote-tally')).toBeTruthy();
    expect(t('no-winner')).toHaveTextContent(/NO_UNIQUE_WINNER/);
  });

  it('says plainly that no vote was taken when the supervisor stopped first', async () => {
    await open(run({ status: 'failed', result: { ...run().result, vote: null, outcome: 'failed', verified: false, solution: null, failure: { code: 'HOP_LIMIT_EXCEEDED', reason: 'MAX_HOPS=3 reached' } } }));
    expect(t('no-vote')).toHaveTextContent(rx('No vote was taken: MAX_HOPS=3 reached'));
  });

  it('non-multi-agent runs have no vote', async () => {
    await renderWithBackend(<RunDetailScreen />, base(run({ mode: 'tot' }), agentsResp(allAgents, { mode: 'tot' }), trace([ev(0, 'search_started')])));
    await waitFor(() => expect(t('agent-Supervisor')).toBeTruthy());
    await section('votes');
    expect(screen.getByText('No vote in this run')).toBeTruthy();
  });
});

describe('Failure and recovery trace', () => {
  const tools = [ev(2, 'route', { reason: 'Supervisor -> Tool:rag_retrieve: optional context tool', data: { hop: 2, to: 'Tool:rag_retrieve' } }),
    ev(3, 'tool_call', { reason_code: 'TOOL_CALL', reason: 'rag_retrieve attempt 1', data: { tool: 'rag_retrieve', attempt: 1 } }),
    ev(4, 'tool_failure', { reason_code: 'TOOL_FAILURE', reason: "rag_retrieve failed (ToolError: injected failure in tool 'rag_retrieve'); retrying", data: { tool: 'rag_retrieve', attempt: 1 } }),
    ev(5, 'tool_call', { reason_code: 'TOOL_CALL', reason: 'rag_retrieve attempt 2', data: { tool: 'rag_retrieve', attempt: 2 } }),
    ev(6, 'tool_recovered', { reason_code: 'RETRY_SUCCEEDED', reason: 'rag_retrieve succeeded on retry 1', data: { tool: 'rag_retrieve', attempts: 2 } })];

  it('shows the injected failure, the retry and the recovery in order, flagged as a controlled demo', async () => {
    const r = run({ config: { ...run().config, inject_tool_failure: { tool: 'rag_retrieve', times: 1 } } });
    await renderWithBackend(<RunDetailScreen />, base(r, agentsResp([...allAgents.slice(0, 4), agent('Supervisor', { tool_calls: 2, retries: 1, recovered: 1 })]), trace([ev(0, 'search_started'), ...tools])));
    await waitFor(() => expect(t('demo-banner')).toHaveTextContent(/injected tool failure: rag_retrieve ×1/));
    expect(t('agent-retry-Supervisor')).toHaveTextContent(rx('1 retried · 1 recovered'));
    await section('events');
    await fireEvent.press(t('filter-tools'));
    expect(t('event-3')).toHaveTextContent(rx('tool_call'));
    expect(t('event-4')).toHaveTextContent(rx('tool_failure · Supervisor'));
    expect(t('event-4')).toHaveTextContent(rx("injected failure in tool 'rag_retrieve'); retrying"));
    expect(t('event-6')).toHaveTextContent(rx('[RETRY_SUCCEEDED] rag_retrieve succeeded on retry 1'));
    expect(screen.queryByTestId('event-0')).toBeNull();
  });

  it('filters: failures only, routing only, empty filter shows an empty state', async () => {
    await renderWithBackend(<RunDetailScreen />, base(run(), agentsResp(allAgents), trace([ev(0, 'search_started'), ...tools])));
    await waitFor(() => expect(t('agent-Supervisor')).toBeTruthy());
    await section('events');
    await fireEvent.press(t('filter-failures'));
    expect(t('event-4')).toBeTruthy();
    expect(screen.queryByTestId('event-3')).toBeNull();
    await fireEvent.press(t('filter-routing'));
    expect(t('event-2')).toBeTruthy();
    await fireEvent.press(t('filter-memory'));
    expect(screen.getByText('No events match this filter')).toBeTruthy();
  });
});

describe('Run controls, checkpoint and resume', () => {
  const tot = (over: Record<string, any> = {}) => run({ mode: 'tot', status: 'paused', resumable: true, live: false, result: null, config: { strategy: 'first_empty', order: 'desc', use_memory: false }, ...over });
  const cp = { thread_id: 'thread-abc', status: 'running', search_steps: 16, depth: 5, events: 33, resumable: true, detail: null };

  it('shows the checkpoint a resume would continue from and calls resume', async () => {
    let resumed = 0;
    await renderWithBackend(<RunDetailScreen />, base(tot(), agentsResp(allAgents, { mode: 'tot' }), trace([ev(0, 'search_started')]), {
      'GET /api/solve/run-1/checkpoint': cp, 'POST /api/solve/run-1/resume': () => { resumed++; return res(200, tot({ status: 'running', live: true })); } }));
    await waitFor(() => expect(t('checkpoint-card')).toHaveTextContent(rx('step 16, depth 5, 33 events, status running')));
    expect(t('checkpoint-card')).toHaveTextContent(/resume continues from this checkpoint, not from the root/);
    expect(t('resume').props.accessibilityState.disabled).toBe(false);
    expect(t('pause').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(t('resume'));
    await waitFor(() => expect(resumed).toBe(1));
    expect(t('run-msg')).toHaveTextContent(rx('Resumed from the saved checkpoint.'));
  });

  it('an interrupted run (after a backend restart) is resumable and cancellable', async () => {
    await renderWithBackend(<RunDetailScreen />, base(tot({ status: 'interrupted' }), agentsResp(allAgents, { mode: 'tot', run_status: 'interrupted' }), trace([ev(0, 'search_started')], { terminal: false, recorded: false }), { 'GET /api/solve/run-1/checkpoint': cp }));
    await waitFor(() => expect(t('run-status')).toHaveTextContent(rx('interrupted')));
    expect(t('resume').props.accessibilityState.disabled).toBe(false);
    expect(t('cancel').props.accessibilityState.disabled).toBe(false);
    expect(t('stopped-label')).toHaveTextContent(rx('Not running (interrupted): resume to continue from the checkpoint'));
    expect(screen.queryByTestId('recorded-label')).toBeNull();     // an unfinished run is never shown as a recorded replay
  });

  it('pause calls the backend; its error is shown as the backend explained it', async () => {
    const running = tot({ status: 'running', live: true, resumable: false });
    let paused = 0;
    await renderWithBackend(<RunDetailScreen />, base(running, agentsResp(allAgents, { mode: 'tot', run_status: 'running' }), trace([ev(0, 'search_started')], { live: true, terminal: false, recorded: false }), {
      'GET /api/solve/run-1/checkpoint': cp, 'POST /api/solve/run-1/pause': () => { paused++; return res(409, { error: { code: 'INVALID_STATE', message: 'run finished (completed) before it could be paused', recoverable: true, retryable: false, details: {} } }); } }));
    await waitFor(() => expect(t('live-label')).toHaveTextContent(/LIVE/));
    await fireEvent.press(t('pause'));
    await waitFor(() => expect(paused).toBe(1));
    expect(t('run-msg')).toHaveTextContent(rx('run finished (completed) before it could be paused'));
  });

  it('multi-agent runs show no pause/resume controls (atomic runs)', async () => {
    await renderWithBackend(<RunDetailScreen />, base(run(), agentsResp(allAgents), trace([ev(0, 'search_started')])));
    await waitFor(() => expect(t('agent-Supervisor')).toBeTruthy());
    expect(screen.queryByTestId('pause')).toBeNull();
  });
});

describe('live polling and error states', () => {
  it('follows a live run until it completes and then stops polling', async () => {
    let n = 0;
    const r = await renderWithBackend(<RunDetailScreen />, base(run(), agentsResp(allAgents), trace([ev(0, 'search_started')]), {
      'GET /api/solve/run-1': () => { n++; return res(200, n < 2 ? run({ status: 'running', live: true, result: null }) : run()); } }));
    await waitFor(() => expect(t('live-label')).toBeTruthy());
    await waitFor(() => expect(t('recorded-label')).toBeTruthy(), { timeout: 4000 });
    const calls = r.be.state.calls.filter((c) => c === 'GET /api/solve/run-1').length;
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(r.be.state.calls.filter((c) => c === 'GET /api/solve/run-1').length).toBe(calls);
  });

  it('unknown run id gets a clear message', async () => {
    await renderWithBackend(<RunDetailScreen />, { ...BACKEND_UP, 'GET /api/solve/run-1': () => res(404, { error: { code: 'RUN_NOT_FOUND', message: 'run was not found', recoverable: true, retryable: false, details: {} } }), 'GET /api/agents/contracts': CONTRACTS });
    await waitFor(() => expect(t('run-error-msg')).toHaveTextContent(rx('This run was not found on the backend.')));
  });

  it('backend unreachable is explained, with a retry', async () => {
    await renderWithBackend(<RunDetailScreen />, base(run(), agentsResp(allAgents), trace([])), { down: true });
    await waitFor(() => expect(t('run-error-msg')).toHaveTextContent(/Could not reach the backend/));
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('memory section: shows what was retrieved and how, and says when nothing was', async () => {
    const r = run({ mode: 'tot', config: { strategy: 'first_empty', use_memory: true, user_id: 'demo-user' }, result: { ...run().result, counters: { memory_confirmed: 1, memory_rejected: 1 }, vote: null } });
    const evs = [ev(4, 'memory_hit_confirmed', { reason_code: 'MEMORY_CONFIRMED', reason: 'remembered dead end re-confirmed deterministically', data: { pattern_id: 7 } }),
      ev(9, 'memory_hit_rejected', { reason_code: 'MEMORY_STALE', reason: 'remembered pattern did not hold for the current board; ignored', data: { pattern_id: 8 } })];
    await renderWithBackend(<RunDetailScreen />, base(r, agentsResp(allAgents, { mode: 'tot' }), trace(evs)));
    await waitFor(() => expect(t('section-memory')).toBeTruthy());
    await section('memory');
    expect(t('mem-confirmed')).toHaveTextContent(rx('1 remembered dead end(s) re-verified deterministically, then pruned'));
    expect(t('mem-rejected')).toHaveTextContent(rx('1 stale pattern(s) ignored; the branch was explored normally'));
    expect(t('mem-event-9')).toHaveTextContent(rx('pattern 8'));
    expect(t('mem-event-9')).toHaveTextContent(rx('[MEMORY_STALE] remembered pattern did not hold for the current board; ignored'));
    expect(screen.getByText(/a verified solution was still found/)).toBeTruthy();
  });

  it('memory section: empty state when nothing was retrieved', async () => {
    const r = run({ mode: 'tot', config: { strategy: 'first_empty', use_memory: true, user_id: 'demo-user' } });
    await renderWithBackend(<RunDetailScreen />, base(r, agentsResp(allAgents, { mode: 'tot' }), trace([ev(0, 'search_started')])));
    await waitFor(() => expect(t('section-memory')).toBeTruthy());
    await section('memory');
    expect(t('no-memory-events')).toBeTruthy();
  });
});
