import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';
import AnalyticsScreen, { correctOf, fmtS, meanOf } from '@/screens/AnalyticsScreen';
import EvalTraceScreen from '@/screens/EvalTraceScreen';
import { BACKEND_UP, renderWithBackend, res } from './helpers';

/* Real responses recorded from the backend by scripts/record_app_fixtures.py: nothing here is hand-written. */
const ev = require('./recorded/evaluation.json').data;
const evList = require('./recorded/evaluation-list.json').data;
const cmp = require('./recorded/analytics-comparisons.json').data;
const evTrace = require('./recorded/evaluation-trace.json').data;

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useLocalSearchParams: () => mockParams, useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]) }));
const t = (id: string) => screen.getByTestId(id);
const push = router.push as jest.Mock;
const secs = (m: any) => m.median_seconds ?? m.seconds;
const NOT_FOUND = () => res(404, { error: { code: 'EVALUATION_NOT_FOUND', message: "evaluation 'latest' was not found", recoverable: true, retryable: false, details: {} } });
const routes = (extra: Record<string, unknown> = {}) => ({
  ...BACKEND_UP, 'GET /api/analytics/comparisons': cmp, 'GET /api/evaluation': evList, 'GET /api/evaluation/latest': ev, ...extra,
});
beforeEach(() => push.mockClear());

describe('Analytics: measured data only', () => {
  it('shows the five-case TA1-vs-TA2 table from the stored evaluation and links each cell to its recorded trace', async () => {
    await renderWithBackend(<AnalyticsScreen />, routes());
    await waitFor(() => expect(t('five-case-table')).toBeTruthy());
    expect(ev.cases).toHaveLength(5);
    for (const c of ev.cases) {
      const m = c.systems.ta1_tot;
      expect(t(`cell-${c.case}-ta1_tot`)).toHaveTextContent(new RegExp(`${m.correct ? '✓ correct' : '✗ wrong'}[\\s\\S]*${m.nodes} nodes`));
    }
    const cm = correctOf(ev.cases, 'ta2_multi_agent_mrv');
    expect(t('five-case-correct')).toHaveTextContent(new RegExp(`TA2 multi-agent \\(parallel\\) ${cm.ok}/${cm.ran}`));
    await fireEvent.press(t('cell-2-ta2_multi_agent_mrv'));
    expect(push).toHaveBeenCalledWith({ pathname: '/eval-trace', params: { e: ev.evaluation_id, k: ev.cases[1].systems.ta2_multi_agent_mrv.trace_key } });
    expect(screen.queryByTestId('cell-1-ta1_cot')).toBeNull();                // CoT was not run: no column is invented
    expect(t('cot-not-run')).toBeTruthy();
    expect(t('rag-not-run')).toHaveTextContent(/switched off/);
  });

  it('states the multi-agent cost trade-off with ratios computed from the measured values', async () => {
    await renderWithBackend(<AnalyticsScreen />, routes());
    await waitFor(() => expect(t('tradeoff')).toBeTruthy());
    const r = meanOf(ev.cases, 'ta2_multi_agent_mrv', secs)! / meanOf(ev.cases, 'ta2_single_mrv', secs)!;
    const n = meanOf(ev.cases, 'ta2_multi_agent_mrv', (m) => m.nodes)! / meanOf(ev.cases, 'ta2_single_mrv', (m) => m.nodes)!;
    expect(t('tradeoff')).toHaveTextContent(new RegExp(`${r.toFixed(1)}× the time and ${n.toFixed(1)}× the nodes`));
    expect(t('chart-time-ta2_multi_agent_mrv')).toHaveProp('accessibilityLabel', `TA2 multi-agent (parallel): ${fmtS(meanOf(ev.cases, 'ta2_multi_agent_mrv', secs))}`);
    expect(t('chart-llm-ta1_tot').props.accessibilityLabel).toMatch(/: 0$/);
    const seq = ev.cases[0].systems.ta2_multi_agent_sequential;
    expect(t('seq-1')).toHaveTextContent(fmtS(secs(seq)));
    expect(t('seq-summary')).toHaveTextContent(new RegExp(`sequential ${fmtS(meanOf(ev.cases, 'ta2_multi_agent_sequential', secs)).replace('.', '\\.')}`));
  });

  it('shows the challenge analysis: faulty variants are excluded and never reach the answer', async () => {
    await renderWithBackend(<AnalyticsScreen />, routes());
    await waitFor(() => expect(t('fault-table')).toBeTruthy());
    for (const f of ev.challenge.fault_propagation) expect(t(`fault-${f.fault}`)).toHaveTextContent(fmtS(f.seconds));
    expect(ev.challenge.fault_propagation.some((f: any) => f.propagated_to_answer)).toBe(false);
    expect(screen.queryByText('YES')).toBeNull();
    await fireEvent.press(t('fault-crash'));
    expect(push).toHaveBeenLastCalledWith({ pathname: '/eval-trace', params: { e: ev.evaluation_id, k: 'challenge_fault_crash' } });
    expect(t('guard-table')).toHaveTextContent(new RegExp(`injection disguised${ev.challenge.injection_guard.injection_disguised.attempts}${ev.challenge.injection_guard.injection_disguised.blocked_by_pattern_guard}`));
  });

  it('shows stored-run comparisons with links back to every run', async () => {
    await renderWithBackend(<AnalyticsScreen />, routes());
    await waitFor(() => expect(t('mode-table')).toBeTruthy());
    const tot = cmp.modes.find((m: any) => m.label === 'tot');
    await fireEvent.press(t(`mode-table-run-${tot.run_ids[0]}`));
    expect(push).toHaveBeenLastCalledWith({ pathname: '/trace/[runId]', params: { runId: tot.run_ids[0] } });
    expect(t('stored-votes-table')).toHaveTextContent(/variant-desc: RULE_VIOLATION/);
    await fireEvent.press(t('group-compare-0'));
    expect(push).toHaveBeenLastCalledWith({ pathname: '/compare', params: { a: cmp.same_puzzle[0].runs[0].run_id, b: cmp.same_puzzle[0].runs[1].run_id } });
  });

  it('shows nothing estimated when no evaluation exists', async () => {
    await renderWithBackend(<AnalyticsScreen />, routes({ 'GET /api/evaluation/latest': NOT_FOUND, 'GET /api/evaluation': [] }));
    await waitFor(() => expect(t('eval-empty')).toBeTruthy());
    expect(screen.queryByTestId('five-case-table')).toBeNull();
    expect(screen.queryByTestId('tradeoff')).toBeNull();
  });

  it('shows nothing at all with the backend down', async () => {
    await renderWithBackend(<AnalyticsScreen />, {}, { down: true });
    await waitFor(() => expect(t('analytics-offline')).toBeTruthy());
    expect(screen.queryByTestId('mode-table')).toBeNull();
  });

  it('runs an evaluation from the app, polls it and shows the stored result', async () => {
    let polls = 0;
    const started = { ...ev, status: 'running', cases: [], finished_at: null };
    await renderWithBackend(<AnalyticsScreen pollMs={10} />, routes({
      'GET /api/evaluation/latest': () => (polls >= 2 ? res(200, ev) : NOT_FOUND()),
      'POST /api/evaluation/run': (body: any) => { expect(body).toEqual({ with_cot: false, with_rag: true }); return res(202, started); },
      [`GET /api/evaluation/${ev.evaluation_id}`]: () => res(200, ++polls < 2 ? started : ev),
    }));
    await waitFor(() => expect(t('eval-empty')).toBeTruthy());
    await fireEvent.press(t('eval-start'));
    await waitFor(() => expect(t('analytics-msg')).toHaveTextContent(/finished and was stored/));
    expect(t('five-case-table')).toBeTruthy();
  });

  it('explains a second evaluation request while one is running', async () => {
    await renderWithBackend(<AnalyticsScreen />, routes({ 'POST /api/evaluation/run': () => res(409, { error: { code: 'EVALUATION_IN_PROGRESS', message: 'x', recoverable: true, retryable: true, details: {} } }) }));
    await waitFor(() => expect(t('eval-start')).toBeTruthy());
    await fireEvent.press(t('eval-start'));
    await waitFor(() => expect(t('analytics-msg')).toHaveTextContent(/already running/));
  });
});

describe('Recorded evaluation data viewer', () => {
  it('labels the data as recorded and shows it', async () => {
    mockParams = { e: evTrace.evaluation_id, k: evTrace.trace_key };
    await renderWithBackend(<EvalTraceScreen />, { ...BACKEND_UP, [`GET /api/evaluation/${evTrace.evaluation_id}/traces/${evTrace.trace_key}`]: evTrace });
    await waitFor(() => expect(t('evtrace-label')).toHaveTextContent(/RECORDED evaluation data/));
    expect(t('evtrace-json')).toHaveTextContent(/routing_trace/);
  });
});
