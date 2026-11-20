import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';
import PlayScreen from '@/screens/PlayScreen';
import SearchTreeScreen from '@/screens/SearchTreeScreen';
import { BACKEND_UP, SAMPLE, renderWithBackend, res, validateHandler } from './helpers';

/* Real traces recorded from the backend. */
const tot = require('./recorded/tot-sample.json');
const multi = require('./recorded/multi-sample.json');
const limit = require('./recorded/tot-limit.json');

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useLocalSearchParams: () => mockParams, useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]) }));

const t = (id: string) => screen.getByTestId(id);
const rx = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const press = async (id: string) => { await fireEvent.press(t(id)); };
const boardLabel = () => (screen.getAllByTestId(/^cell-\d-\d$/).map((c) => (c.props.accessibilityLabel as string).match(/value (\d)/)?.[1] ?? '0').join(''));
const routesFor = (rec: any, extra: Record<string, unknown> = {}) => {
  const id = rec.run.run_id;
  return { ...BACKEND_UP, [`GET /api/solve/${id}`]: rec.run, [`GET /api/solve/${id}/trace`]: rec.trace, ...extra };
};
beforeEach(() => { (router.push as jest.Mock).mockClear(); });

describe('Search tree: recorded replay of a real trace', () => {
  beforeEach(() => { mockParams = { runId: tot.run.run_id }; });

  it('is clearly labelled as a recorded replay, not a live run, and opens on the final verified step', async () => {
    await renderWithBackend(<SearchTreeScreen />, routesFor(tot));
    await waitFor(() => expect(t('mode-replay')).toHaveTextContent(rx('RECORDED REPLAY')));
    expect(screen.queryByTestId('mode-live')).toBeNull();
    expect(t('frame-pos')).toHaveTextContent(`Step ${tot.trace.events.length} of ${tot.trace.events.length}`);
    expect(t('verified-solution')).toBeTruthy();
    expect(t('tree-llm')).toHaveTextContent(rx('none'));
    expect(t('count-dead-ends')).toHaveTextContent(String(tot.run.result.counters.dead_ends));
    expect(t('count-backtracks')).toHaveTextContent(String(tot.run.result.counters.backtracks));
  });

  it('restart, step forward and step back move through the stored events and update the board', async () => {
    await renderWithBackend(<SearchTreeScreen />, routesFor(tot));
    await waitFor(() => expect(t('frame-pos')).toBeTruthy());
    await press('pb-restart');
    expect(t('frame-pos')).toHaveTextContent(`Step 1 of ${tot.trace.events.length}`);
    expect(boardLabel()).toBe(tot.run.board.flat().join(''));
    expect(screen.queryByTestId('verified-solution')).toBeNull();      // not yet verified at step 1
    const firstAccept = tot.trace.events.findIndex((e: any) => e.event === 'candidate_accepted');
    for (let i = 0; i < firstAccept; i++) await press('pb-forward');
    const e = tot.trace.events[firstAccept];
    expect(t('frame-event')).toHaveTextContent(rx(`#${e.sequence} candidate_accepted`));
    const expected = tot.run.board.map((r: number[]) => r.slice()); expected[e.cell[0]][e.cell[1]] = e.candidate;
    expect(boardLabel()).toBe(expected.flat().join(''));
    await press('pb-back');
    expect(boardLabel()).toBe(tot.run.board.flat().join(''));
    expect(t('pb-back').props.accessibilityState.disabled).toBe(false);
  });

  it('shows the selected cell, candidate chips and the exact event details at a dead end', async () => {
    await renderWithBackend(<SearchTreeScreen />, routesFor(tot));
    await waitFor(() => expect(t('frame-pos')).toBeTruthy());
    const deadIdx = tot.trace.events.findIndex((e: any) => e.event === 'dead_end');
    await press('pb-restart');
    for (let i = 0; i < deadIdx; i++) await press('pb-forward');
    const d = tot.trace.events[deadIdx];
    expect(t('frame-event')).toHaveTextContent(rx(`dead_end · ${d.agent}`));
    expect(t('frame-event')).toHaveTextContent(rx(`[ZERO_CANDIDATES] ${d.reason}`));
    expect(t('frame-cell')).toHaveTextContent(rx(`[${d.cell[0]}, ${d.cell[1]}]`));
    expect(t('count-dead-ends')).toHaveTextContent('1');
  });

  it('play advances automatically and stops at the end; speed is selectable', async () => {
    await renderWithBackend(<SearchTreeScreen />, routesFor(tot));
    await waitFor(() => expect(t('frame-pos')).toBeTruthy());
    await press('pb-restart');
    await press('speed-3');                          // 4x = 150 ms per step
    await press('pb-play');
    await waitFor(() => expect(t('frame-pos')).toHaveTextContent(/Step [3-9]\d* of/), { timeout: 2000 });
    await press('pb-play');                          // pause
    const pos = (t('frame-pos').props.children as any[]).join('');
    await new Promise((r) => setTimeout(r, 400));
    expect((t('frame-pos').props.children as any[]).join('')).toBe(pos);
  });

  it('node inspector shows a dead-end node\'s status and reason; branches collapse', async () => {
    await renderWithBackend(<SearchTreeScreen />, routesFor(tot));
    await waitFor(() => expect(t('tree-card')).toBeTruthy());
    const dead = tot.trace.nodes.find((n: any) => n.status === 'dead_end');
    await press(`node-${dead.node_id}`);
    expect(t('inspector-status')).toHaveTextContent(rx('dead end'));
    expect(t('inspector-reason')).toHaveTextContent(rx(`[${dead.reason_code}] ${dead.reason_text}`));
    const root = tot.trace.nodes.find((n: any) => n.parent_node_id === null);
    const before = screen.getAllByTestId(/^node-run-/).length;
    await press(`toggle-${root.node_id}`);
    expect(screen.getAllByTestId(/^node-run-/).length).toBe(1);
    await press(`toggle-${root.node_id}`);
    expect(screen.getAllByTestId(/^node-run-/).length).toBe(before);
  });

  it('the node tree matches the backend\'s stored nodes and statuses', async () => {
    await renderWithBackend(<SearchTreeScreen />, routesFor(tot));
    await waitFor(() => expect(t('tree-card')).toBeTruthy());
    for (const n of tot.trace.nodes) expect(t(`node-status-${n.node_id}`)).toHaveTextContent(n.status.replace('_', ' '));
  });

  it('event filter narrows the list; tapping an event jumps the playback to it', async () => {
    await renderWithBackend(<SearchTreeScreen />, routesFor(tot));
    await waitFor(() => expect(t('event-list')).toBeTruthy());
    await press('ef-backtracks');
    const bts = tot.trace.events.filter((e: any) => e.event === 'backtrack_started');
    for (const b of bts) expect(t(`ev-${b.sequence}`)).toBeTruthy();
    expect(screen.queryByTestId('ev-0')).toBeNull();
    await press(`ev-${bts[0].sequence}`);
    expect(t('frame-event')).toHaveTextContent(rx(`#${bts[0].sequence} backtrack_started`));
    expect(boardLabel()).toBe(bts[0].board_snapshot.flat().join(''));       // restored board, exactly as recorded
    await press('ef-memory');
    expect(t('ef-empty')).toBeTruthy();
  });

  it('links to the agents/routing/votes view', async () => {
    await renderWithBackend(<SearchTreeScreen />, routesFor(tot));
    await waitFor(() => expect(t('open-agents')).toBeTruthy());
    await press('open-agents');
    expect(router.push).toHaveBeenCalledWith({ pathname: '/run/[runId]', params: { runId: tot.run.run_id } });
  });
});

describe('Search tree: other runs and failure states', () => {
  it('multi-agent: one tree per candidate-order variant, selectable', async () => {
    mockParams = { runId: multi.run.run_id };
    await renderWithBackend(<SearchTreeScreen />, routesFor(multi));
    await waitFor(() => expect(t('variant-variant-asc')).toBeTruthy());
    expect(t('variant-variant-desc')).toBeTruthy();
    expect(t('verified-solution')).toBeTruthy();
    await press('variant-variant-desc');
    expect(t('variant-variant-desc').props.accessibilityState.selected).toBe(true);
    expect(t('verified-solution')).toBeTruthy();
  });

  it('a failed run shows the solver failure verbatim and no verified solution', async () => {
    mockParams = { runId: limit.run.run_id };
    await renderWithBackend(<SearchTreeScreen />, routesFor(limit));
    await waitFor(() => expect(t('tree-failed')).toHaveTextContent(rx(`Solver failed: MAX_NODES: ${limit.run.result.failure.reason}`)));
    expect(screen.queryByTestId('verified-solution')).toBeNull();
  });

  it('a CoT run with Ollama down shows the Ollama-unavailable state', async () => {
    const run = { ...tot.run, run_id: 'run-cot', mode: 'cot', status: 'failed', llm_components: ['qwen2.5:3b single-path reasoning (frozen TA1 CoT prompt)'],
      result: { ...tot.run.result, outcome: 'failed', verified: false, solution: null, failure: { code: 'OLLAMA_UNAVAILABLE', reason: 'The local model call failed; check that Ollama is running.' } } };
    mockParams = { runId: 'run-cot' };
    await renderWithBackend(<SearchTreeScreen />, { ...BACKEND_UP, 'GET /api/solve/run-cot': run, 'GET /api/solve/run-cot/trace': { ...tot.trace, run_id: 'run-cot', events: tot.trace.events.slice(0, 1) } });
    await waitFor(() => expect(t('tree-ollama')).toHaveTextContent(rx('check that Ollama is running')));
    expect(t('tree-llm')).toHaveTextContent(rx('qwen2.5:3b'));
  });

  it('a timed-out run is labelled as a timeout', async () => {
    const run = { ...tot.run, run_id: 'run-to', status: 'failed', result: { ...tot.run.result, outcome: 'failed', verified: false, solution: null, failure: { code: 'TIMEOUT', reason: 'search exceeded its time budget' } } };
    mockParams = { runId: 'run-to' };
    await renderWithBackend(<SearchTreeScreen />, { ...BACKEND_UP, 'GET /api/solve/run-to': run, 'GET /api/solve/run-to/trace': { ...tot.trace, events: tot.trace.events.slice(0, 10) } });
    await waitFor(() => expect(t('tree-timeout')).toHaveTextContent(rx('search exceeded its time budget')));
  });

  it('unknown run and unreachable backend', async () => {
    mockParams = { runId: 'run-nope' };
    const a = await renderWithBackend(<SearchTreeScreen />, { ...BACKEND_UP, 'GET /api/solve/run-nope': () => res(404, { error: { code: 'RUN_NOT_FOUND', message: 'nf', recoverable: true, retryable: false, details: {} } }) });
    await waitFor(() => expect(t('tree-error-msg')).toHaveTextContent('This run was not found on the backend.'));
    await a.unmount();
    await renderWithBackend(<SearchTreeScreen />, BACKEND_UP, { down: true });
    await waitFor(() => expect(t('tree-error-msg')).toHaveTextContent(rx('Could not reach the backend')));
  });
});

/* ------------------------------------------------------------------ live run over the WebSocket */
class FakeWS {
  static all: FakeWS[] = [];
  onopen?: () => void; onmessage?: (m: { data: string }) => void; onclose?: () => void; onerror?: () => void;
  constructor(public url: string) { FakeWS.all.push(this); }
  close() { /* noop */ }
  async send(m: unknown) { await act(async () => { this.onmessage?.({ data: JSON.stringify(m) }); }); }
}

describe('Search tree: live run', () => {
  beforeEach(() => { FakeWS.all = []; mockParams = { runId: tot.run.run_id }; });

  it('follows events from the WebSocket, survives a drop by fetching missed events, and ends on the terminal message', async () => {
    const evs = tot.trace.events;
    let phase: 'live' | 'done' = 'live';
    const liveRun = () => (phase === 'live' ? { ...tot.run, status: 'running', live: true, result: null } : tot.run);
    const traceAfter = (url: string) => {
      const after = Number(new URL(url).searchParams.get('after'));
      const upto = phase === 'live' ? 12 : evs.length;
      return res(200, { ...tot.trace, live: phase === 'live', terminal: phase === 'done', events: evs.slice(after + 1, upto) });
    };
    await renderWithBackend(<SearchTreeScreen WebSocketImpl={FakeWS as any} />, {
      ...BACKEND_UP, [`GET /api/solve/${tot.run.run_id}`]: () => res(200, liveRun()), [`GET /api/solve/${tot.run.run_id}/trace`]: (_b: any, url: string) => traceAfter(url),
    });
    await waitFor(() => expect(t('mode-live')).toBeTruthy());
    expect(FakeWS.all[0].url).toMatch(/\/ws\/solve\/run-[0-9a-f]+\?after=11$/);   // REST returned events 0..11, so the socket continues after 11
    await act(async () => { FakeWS.all[0].onopen?.(); });
    for (let i = 12; i < 20; i++) await FakeWS.all[0].send({ type: 'event', event: evs[i] });
    await waitFor(() => expect(t('frame-pos')).toHaveTextContent(rx('(following live)')));
    await act(async () => { FakeWS.all[0].onclose?.(); });                                   // the connection drops
    await waitFor(() => expect(t('tree-conn')).toHaveTextContent(rx('reconnecting (attempt 1)')));
    phase = 'done';
    await waitFor(() => expect(FakeWS.all.length).toBe(2), { timeout: 3000 });  // missed events fetched, then reconnected
    await FakeWS.all[1].send({ type: 'terminal', status: 'completed', outcome: 'solved', verified: true, last_sequence: evs.length - 1 });
    await waitFor(() => expect(t('mode-replay')).toBeTruthy());
    expect(t('frame-pos')).toHaveTextContent(`Step ${evs.length} of ${evs.length}`);  // every event exactly once
    expect(t('verified-solution')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ Play -> Solve with AI */
describe('Play: solve-mode selection', () => {
  beforeEach(() => { mockParams = {}; });
  const routes = (extra: Record<string, unknown> = {}) => ({ ...BACKEND_UP, 'POST /api/puzzles/validate': validateHandler, ...extra });

  it('is disabled on an empty board and opens the three modes with deterministic vs LLM labels', async () => {
    await renderWithBackend(<PlayScreen />, routes());
    expect(t('solve-ai').props.accessibilityState.disabled).toBe(true);
    await press('load-sample');
    expect(t('solve-ai').props.accessibilityState.disabled).toBe(false);
    await press('solve-ai');
    for (const m of ['cot', 'tot', 'multi-agent']) expect(t(`mode-card-${m}`)).toBeTruthy();
    expect(t('mode-card-cot')).toHaveTextContent(rx('NOT a correctness proof'));
    expect(t('mode-card-tot')).toHaveTextContent(rx('LLM: none.'));
    expect(t('mode-card-multi-agent')).toHaveTextContent(rx('not independent LLM agents'));
  });

  it('every mode receives the same puzzle (clues only), then the live search view opens', async () => {
    const bodies: Record<string, any> = {};
    const start = (m: string) => (b: any) => { bodies[m] = b; return res(202, { ...tot.run, run_id: `run-${m}`, status: 'queued' }); };
    await renderWithBackend(<PlayScreen />, routes({ 'POST /api/solve/cot': start('cot'), 'POST /api/solve/tot': start('tot'), 'POST /api/solve/multi-agent': start('multi-agent') }));
    await press('load-sample');
    await fireEvent.press(t('cell-0-0')); await press('pad-1');           // a user entry must NOT be sent as a clue
    for (const m of ['cot', 'tot', 'multi-agent']) { await press('solve-ai'); await press(`solve-${m}`); await waitFor(() => expect(bodies[m]).toBeTruthy()); }
    expect(bodies.cot.board).toEqual(SAMPLE);
    expect(bodies.tot.board).toEqual(SAMPLE);
    expect(bodies['multi-agent'].board).toEqual(SAMPLE);
    expect(bodies.tot.strategy).toBe('mrv');
    expect(router.push).toHaveBeenCalledWith({ pathname: '/trace/[runId]', params: { runId: 'run-tot' } });
  });

  it('first-empty strategy is sent when chosen (shows dead ends)', async () => {
    let body: any;
    await renderWithBackend(<PlayScreen />, routes({ 'POST /api/solve/tot': (b: any) => { body = b; return res(202, { ...tot.run, run_id: 'run-x' }); } }));
    await press('load-sample'); await press('solve-ai'); await press('strat-first'); await press('solve-tot');
    await waitFor(() => expect(body).toEqual({ board: SAMPLE, strategy: 'first_empty', order: 'desc' }));
  });

  it('a contradictory puzzle is refused with an explanation; Ollama-down CoT is explained', async () => {
    await renderWithBackend(<PlayScreen />, routes({
      'POST /api/solve/tot': () => res(422, { error: { code: 'PUZZLE_CONTRADICTORY', message: 'The puzzle breaks the Sudoku rules and cannot be solved.', recoverable: true, retryable: false, details: {} } }),
      'POST /api/solve/cot': () => res(503, { error: { code: 'OLLAMA_UNAVAILABLE', message: 'The local Ollama service could not be reached.', recoverable: true, retryable: true, details: {} } }),
    }));
    await press('load-sample'); await press('solve-ai'); await press('solve-tot');
    await waitFor(() => expect(t('solve-error')).toHaveTextContent(rx('breaks the Sudoku rules')));
    await press('solve-cot');
    await waitFor(() => expect(t('solve-error')).toHaveTextContent(rx('ToT and Multi-Agent do not need it')));
    expect(router.push).not.toHaveBeenCalled();
  });
});
