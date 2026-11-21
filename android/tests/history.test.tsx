import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';
import { Share } from 'react-native';
import CompareScreen from '@/screens/CompareScreen';
import HistoryScreen from '@/screens/HistoryScreen';
import SessionScreen from '@/screens/SessionScreen';
import { BACKEND_UP, renderWithBackend, res } from './helpers';

/* Real responses recorded from the backend by scripts/record_app_fixtures.py */
const list = require('./recorded/history-list.json').data;
const session = require('./recorded/history-session.json').data;
const compare = require('./recorded/history-compare.json').data;
const tot = require('./recorded/tot-sample.json');

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => mockParams, useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]) }));
const t = (id: string) => screen.getByTestId(id);
const push = router.push as jest.Mock;
beforeEach(() => push.mockClear());
const sid = session.session.session_id;

describe('History list', () => {
  it('lists saved sessions with their stored latest-run metrics and opens one', async () => {
    await renderWithBackend(<HistoryScreen />, { ...BACKEND_UP, 'GET /api/history': list });
    const s = list.sessions[0];
    await waitFor(() => expect(t(`hist-${s.session_id}`)).toBeTruthy());
    expect(t(`hist-${s.session_id}`)).toHaveTextContent(new RegExp(`${s.runs_count} runs`));
    expect(t(`hist-${s.session_id}`)).toHaveTextContent(new RegExp(`${s.last_run.nodes} nodes`));
    await fireEvent.press(t(`hist-${s.session_id}`));
    expect(push).toHaveBeenCalledWith({ pathname: '/history/[sessionId]', params: { sessionId: s.session_id } });
  });

  it('shows an empty state', async () => {
    await renderWithBackend(<HistoryScreen />, { ...BACKEND_UP, 'GET /api/history': { total: 0, limit: 20, offset: 0, sessions: [] } });
    await waitFor(() => expect(t('history-empty')).toBeTruthy());
  });

  it('shows a database error with retry', async () => {
    await renderWithBackend(<HistoryScreen />, { ...BACKEND_UP, 'GET /api/history': () => res(503, { error: { code: 'DATABASE_UNAVAILABLE', message: 'The local database is busy or unavailable; try again.', recoverable: true, retryable: true, details: {} } }) });
    await waitFor(() => expect(t('history-error')).toHaveTextContent(/database is busy/));
    expect(t('history-retry')).toBeTruthy();
  });

  it('offers the bundled recorded replay when the backend is down', async () => {
    await renderWithBackend(<HistoryScreen />, {}, { down: true });
    await waitFor(() => expect(t('history-offline')).toBeTruthy());
    await fireEvent.press(t('open-bundled'));
    expect(push).toHaveBeenCalledWith('/replay');
  });
});

describe('Session detail', () => {
  beforeEach(() => { mockParams = { sessionId: sid }; });
  const routes = (extra: Record<string, unknown> = {}) => ({ ...BACKEND_UP, [`GET /api/history/${sid}`]: session, ...extra });

  it('reopens the puzzle, offers recorded replay for finished runs and compares two picked runs', async () => {
    await renderWithBackend(<SessionScreen />, routes());
    await waitFor(() => expect(t('session-screen')).toBeTruthy());
    expect(t('session-unique')).toHaveTextContent(/unique solution/);
    for (const r of session.runs) expect(t(`replay-${r.run_id}`)).toBeTruthy();
    const r0 = session.runs[0];
    expect(t(`srun-metrics-${r0.run_id}`)).toHaveTextContent(new RegExp(`${r0.nodes} nodes · ${r0.backtracks} backtracks`));
    await fireEvent.press(t('reopen'));
    expect(push.mock.calls[0][0]).toMatchObject({ pathname: '/play', params: { puzzleId: session.puzzle.puzzle_id } });
    await fireEvent.press(t(`replay-${r0.run_id}`));
    expect(push).toHaveBeenLastCalledWith({ pathname: '/trace/[runId]', params: { runId: r0.run_id } });
    expect(t('compare').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(t(`pick-${session.runs[0].run_id}`));
    await fireEvent.press(t(`pick-${session.runs[1].run_id}`));
    await fireEvent.press(t('compare'));
    expect(push).toHaveBeenLastCalledWith({ pathname: '/compare', params: { a: session.runs[0].run_id, b: session.runs[1].run_id } });
  });

  it('exports a run trace as JSON through the share sheet', async () => {
    const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction } as any);
    const r0 = session.runs[0];
    await renderWithBackend(<SessionScreen />, routes({ [`GET /api/solve/${r0.run_id}/trace`]: (_b: unknown, url: string) => { expect(url).toMatch(/download=true/); return res(200, { ...tot.trace, run_id: r0.run_id }); } }));
    await waitFor(() => expect(t(`export-${r0.run_id}`)).toBeTruthy());
    await fireEvent.press(t(`export-${r0.run_id}`));
    await waitFor(() => expect(t('session-msg')).toHaveTextContent(new RegExp(`Exported ${tot.trace.events.length} recorded events`)));
    expect(JSON.parse(spy.mock.calls[0][0].message!).events).toHaveLength(tot.trace.events.length);
    spy.mockRestore();
  });

  it('resumes an eligible checkpointed run and opens it live; a failed resume is explained', async () => {
    const paused = { ...session, runs: [{ ...session.runs[0], status: 'paused', resumable: true }, ...session.runs.slice(1)] };
    const id = paused.runs[0].run_id;
    let ok = true;
    await renderWithBackend(<SessionScreen />, { ...BACKEND_UP, [`GET /api/history/${sid}`]: paused,
      [`POST /api/solve/${id}/resume`]: () => (ok ? res(200, { ...tot.run, run_id: id, status: 'running' })
        : res(409, { error: { code: 'CHECKPOINT_UNAVAILABLE', message: 'No checkpoint exists for this run; start a new run.', recoverable: true, retryable: false, details: {} } })) });
    await waitFor(() => expect(t(`resume-${id}`)).toBeTruthy());
    expect(screen.queryByTestId(`replay-${id}`)).toBeNull();                   // a paused run is not a recorded replay
    await fireEvent.press(t(`resume-${id}`));
    await waitFor(() => expect(push).toHaveBeenLastCalledWith({ pathname: '/trace/[runId]', params: { runId: id } }));
    ok = false;
    await fireEvent.press(t(`resume-${id}`));
    await waitFor(() => expect(t('session-msg')).toHaveTextContent(/Resume failed: No checkpoint/));
  });

  it('says so when the session no longer exists', async () => {
    await renderWithBackend(<SessionScreen />, { ...BACKEND_UP, [`GET /api/history/${sid}`]: () => res(404, { error: { code: 'SESSION_NOT_FOUND', message: 'x', recoverable: true, retryable: false, details: {} } }) });
    await waitFor(() => expect(screen.getByText(/no longer exists/)).toBeTruthy());
  });
});

describe('Compare two runs', () => {
  beforeEach(() => { mockParams = { a: compare.a.run_id, b: compare.b.run_id }; });

  it('shows every stored metric side by side and links to both traces', async () => {
    await renderWithBackend(<CompareScreen />, { ...BACKEND_UP, 'GET /api/history/compare': compare });
    await waitFor(() => expect(t('compare-table')).toBeTruthy());
    for (const d of compare.differences) expect(t(`cmp-${d.metric}`)).toBeTruthy();
    const nodes = compare.differences.find((d: any) => d.metric === 'nodes');
    expect(t('cmp-nodes')).toHaveTextContent(new RegExp(`${nodes.a}.*${nodes.b}`));
    await fireEvent.press(t('cmp-open-b'));
    expect(push).toHaveBeenLastCalledWith({ pathname: '/trace/[runId]', params: { runId: compare.b.run_id } });
  });

  it('shows the backend refusal for runs of different puzzles', async () => {
    await renderWithBackend(<CompareScreen />, { ...BACKEND_UP, 'GET /api/history/compare': () => res(422, { error: { code: 'RUNS_NOT_COMPARABLE', message: 'The two runs were made on different puzzles; compare runs of the same puzzle.', recoverable: true, retryable: false, details: {} } }) });
    await waitFor(() => expect(t('compare-error')).toHaveTextContent(/different puzzles/));
  });
});
