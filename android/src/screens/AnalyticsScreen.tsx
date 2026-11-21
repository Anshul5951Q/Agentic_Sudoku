import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BarChart, tableStyles as T } from '@/components/charts';
import { Chip, errCode, errText, StatusPill } from '@/components/lab';
import { Button, Card, EmptyState, Loading, Notice, Screen, SectionTitle } from '@/components/ui';
import { useConnection } from '@/state/ConnectionContext';
import { colors, fontSize, spacing } from '@/theme';
import type { AnalyticsComparisons, EvaluationCase, EvaluationListItem, EvaluationMetrics, EvaluationRun, ModeAggregate } from '@/types/api';

export const SYSTEMS: { key: string; label: string }[] = [
  { key: 'ta1_cot', label: 'TA1 CoT' },
  { key: 'ta1_tot', label: 'TA1 ToT' },
  { key: 'ta2_single_mrv', label: 'TA2 single (MRV)' },
  { key: 'ta2_single_first_empty_desc', label: 'TA2 single (TA1 order)' },
  { key: 'ta2_multi_agent_mrv', label: 'TA2 multi-agent (parallel)' },
  { key: 'ta2_multi_agent_sequential', label: 'TA2 multi-agent (sequential)' },
  { key: 'ta2_multi_agent_with_rag', label: 'TA2 multi-agent + RAG' },
];
const label = (k: string) => SYSTEMS.find((s) => s.key === k)?.label ?? k;
export const fmtS = (s: number | null | undefined) => (s == null ? '—' : s < 1 ? `${(s * 1000).toFixed(2)} ms` : `${s.toFixed(2)} s`);
const fmtN = (n: number | null | undefined, d = 1) => (n == null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(d));
const secs = (m?: EvaluationMetrics) => (m ? m.median_seconds ?? m.seconds ?? null : null);

/** Mean of one measured field over the cases where the system actually ran (null if it never ran). */
export function meanOf(cases: EvaluationCase[], sys: string, pick: (m: EvaluationMetrics) => number | null | undefined): number | null {
  const v = cases.map((c) => c.systems[sys]).filter((m) => m && !m.skipped && !m.error).map((m) => pick(m!)).filter((x): x is number => typeof x === 'number');
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
export function correctOf(cases: EvaluationCase[], sys: string): { ok: number; ran: number } {
  const ran = cases.filter((c) => c.systems[sys] && !c.systems[sys].skipped && !c.systems[sys].error);
  return { ok: ran.filter((c) => c.systems[sys].correct).length, ran: ran.length };
}
const ratio = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? a / b : null);

function openTrace(evaluationId: string, key: string | null | undefined) {
  if (key) router.push({ pathname: '/eval-trace', params: { e: evaluationId, k: key } });
}
function openRun(runId: string) {
  router.push({ pathname: '/trace/[runId]', params: { runId } });
}

function Link({ text, onPress, testID }: { text: string; onPress: () => void; testID?: string }) {
  return <Text testID={testID} accessibilityRole="link" onPress={onPress} style={[T.td, T.link]}>{text}</Text>;
}

function Table({ head, rows, widths, testID }: { head: string[]; rows: React.ReactNode[][]; widths: number[]; testID?: string }) {
  return (
    <ScrollView horizontal testID={testID} showsHorizontalScrollIndicator>
      <View>
        <View style={T.tr}>{head.map((h, i) => <Text key={h} style={[T.th, { width: widths[i] }]}>{h}</Text>)}</View>
        {rows.map((r, i) => (
          <View key={i} style={T.tr}>{r.map((cell, j) => <View key={j} style={{ width: widths[j] }}>{typeof cell === 'string' ? <Text style={T.td}>{cell}</Text> : cell}</View>)}</View>
        ))}
      </View>
    </ScrollView>
  );
}

function ModeTable({ rows, testID }: { rows: ModeAggregate[]; testID: string }) {
  return (
    <Table testID={testID} widths={[100, 54, 70, 84, 70, 60, 60, 120]}
      head={['Group', 'Runs', 'Verified', 'Median time', 'Mean nodes', 'LLM calls', 'Solver calls', 'Stored runs']}
      rows={rows.map((m) => [m.label, String(m.runs), m.runs ? `${m.verified}/${m.runs}` : '—', fmtS(m.median_seconds), fmtN(m.mean_nodes),
        String(m.llm_calls), String(m.solver_calls),
        m.run_ids.length ? <View style={{ gap: 2 }}>{m.run_ids.slice(0, 3).map((id) => <Link key={id} testID={`${testID}-run-${id}`} text={id} onPress={() => openRun(id)} />)}</View> : 'none'])} />
  );
}

export default function AnalyticsScreen({ pollMs = 1500 }: { pollMs?: number } = {}) {
  const { api, backend, ollama } = useConnection();
  const [cmp, setCmp] = useState<AnalyticsComparisons | null>(null);
  const [evals, setEvals] = useState<EvaluationListItem[]>([]);
  const [ev, setEv] = useState<EvaluationRun | null>(null);
  const [evMissing, setEvMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [withCot, setWithCot] = useState(false);
  const [withRag, setWithRag] = useState(true);
  const [running, setRunning] = useState<EvaluationRun | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, list] = await Promise.all([api.comparisons(), api.evaluations()]);
      if (!alive.current) return;
      setCmp(c); setEvals(list); setError(null);
      const active = list.find((e) => e.status === 'running');
      if (active) setRunning((r) => r ?? ({ evaluation_id: active.evaluation_id, status: 'running' } as EvaluationRun));
      try { setEv(await api.latestEvaluation()); setEvMissing(false); } catch (e) { if (errCode(e) === 'EVALUATION_NOT_FOUND') { setEv(null); setEvMissing(true); } else throw e; }
    } catch (e) { if (alive.current) setError(errText(e)); }
    finally { if (alive.current) setLoading(false); }
  }, [api]);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useFocusEffect(useCallback(() => { if (backend !== 'down') load(); }, [backend, load]));

  useEffect(() => {                       // poll a running evaluation until it is stored
    if (!running) return;
    const t = setTimeout(async () => {
      try {
        const r = await api.evaluation(running.evaluation_id);
        if (r.status === 'running') { setRunning({ ...r }); return; }
        setRunning(null);
        setMsg(r.status === 'completed' ? `Evaluation ${r.evaluation_id} finished and was stored.` : `Evaluation failed: ${r.error}`);
        if (r.status === 'completed') setEv(r);
        load();
      } catch (e) { setMsg(errText(e)); setRunning(null); }
    }, pollMs);
    return () => clearTimeout(t);
  }, [running, api, load, pollMs]);

  const start = async () => {
    setMsg(null);
    try { setRunning(await api.startEvaluation(withCot, withRag)); }
    catch (e) { setMsg(errCode(e) === 'EVALUATION_IN_PROGRESS' ? 'An evaluation is already running; its result will appear here.' : errText(e)); }
  };
  const pick = async (id: string) => { try { setEv(await api.evaluation(id)); } catch (e) { setMsg(errText(e)); } };

  if (backend === 'down') {
    return (
      <Screen testID="analytics-screen">
        <Notice kind="warning" testID="analytics-offline">Analytics are computed by the backend from stored runs. It is unreachable, so nothing is shown (no cached or estimated numbers).</Notice>
        <Button testID="open-bundled" label="Open bundled recorded replay" variant="secondary" onPress={() => router.push('/replay')} />
      </Screen>
    );
  }

  const cases = ev?.status === 'completed' ? ev.cases : [];
  const present = SYSTEMS.filter((s) => cases.some((c) => c.systems[s.key]));
  const t1 = meanOf(cases, 'ta2_single_mrv', secs), tm = meanOf(cases, 'ta2_multi_agent_mrv', secs), tsq = meanOf(cases, 'ta2_multi_agent_sequential', secs);
  const n1 = meanOf(cases, 'ta2_single_mrv', (m) => m.nodes), nm = meanOf(cases, 'ta2_multi_agent_mrv', (m) => m.nodes);
  const c1 = correctOf(cases, 'ta2_single_mrv'), cm = correctOf(cases, 'ta2_multi_agent_mrv');
  const chart = (title: string, unit: string, pickV: (m: EvaluationMetrics) => number | null | undefined, fmt: (n: number | null) => string, id: string) => (
    <BarChart testID={id} title={title} unit={unit}
      bars={present.map((s) => { const v = meanOf(cases, s.key, pickV); return { label: s.label, value: v, display: fmt(v), testID: `${id}-${s.key}` }; })} />
  );

  return (
    <Screen testID="analytics-screen">
      <Text style={styles.h1} accessibilityRole="header">Analytics</Text>
      <Text style={styles.muted} testID="analytics-source">Measured data only. Stored runs: {cmp?.source ?? '…'}. Evaluation numbers come from the stored evaluation job; tap any underlined value to open the recorded data behind it.</Text>
      {error && <Notice kind="error" testID="analytics-error">Could not load analytics: {error}</Notice>}
      {msg && <Notice kind="info" testID="analytics-msg">{msg}</Notice>}
      {loading && !cmp && <Loading label="Loading analytics…" />}
      <Button testID="open-history" label="Session history and replay" variant="secondary" onPress={() => router.push('/history')} />

      {/* ------------------------------------------------ evaluation-run interface */}
      <Card testID="eval-panel">
        <SectionTitle>Evaluation run (five cases, TA1 vs TA2)</SectionTitle>
        <Text style={styles.muted}>Runs the frozen TA1 code and the TA2 engine on the same five unique puzzles, then stores every value and trace.</Text>
        <View style={styles.chips}>
          <Chip testID="opt-cot" label={withCot ? '☑ TA1 CoT (real Qwen, slow)' : '☐ TA1 CoT (real Qwen, slow)'} on={withCot} onPress={() => setWithCot(!withCot)} />
          <Chip testID="opt-rag" label={withRag ? '☑ RAG k=1 vs k=3' : '☐ RAG k=1 vs k=3'} on={withRag} onPress={() => setWithRag(!withRag)} />
        </View>
        {(withCot || withRag) && ollama !== 'up' && <Notice kind="warning" testID="eval-ollama">Ollama is not fully available; CoT/RAG parts will be recorded as skipped or failed, not filled in.</Notice>}
        <Button testID="eval-start" label={running ? 'Evaluation running…' : 'Run evaluation now'} disabled={!!running} onPress={start} />
        {running && <View style={styles.rowC}><StatusPill testID="eval-running" status="running" /><Text style={styles.muted}>{running.evaluation_id}</Text></View>}
        {evals.length > 0 && <Text style={styles.k}>Stored evaluations (tap to view)</Text>}
        <View style={styles.chips}>
          {evals.map((e) => <Chip key={e.evaluation_id} testID={`eval-${e.evaluation_id}`} label={`${e.created_at.slice(5, 16).replace('T', ' ')} · ${e.status}`}
            on={ev?.evaluation_id === e.evaluation_id} disabled={e.status !== 'completed'} onPress={() => pick(e.evaluation_id)} />)}
        </View>
      </Card>

      {evMissing && !running && <EmptyState testID="eval-empty" title="No evaluation stored yet" body="Run the evaluation above. Nothing is shown until real values exist." />}

      {ev && cases.length > 0 && (
        <>
          <Card testID="five-case">
            <SectionTitle>TA1 vs TA2 on the same five cases</SectionTitle>
            <Text style={styles.muted}>Evaluation {ev.evaluation_id} · {ev.finished_at?.slice(0, 16).replace('T', ' ')} UTC · {ev.timing}</Text>
            <Table testID="five-case-table" widths={[120, ...present.map(() => 108)]}
              head={['Case', ...present.map((s) => s.label)]}
              rows={cases.map((c) => [
                <Text style={T.td}>{c.case}. {c.name}{'\n'}{c.empties} empty · {c.solution_count === 1 ? 'unique' : `${c.solution_count} sol.`}</Text>,
                ...present.map((s) => {
                  const m = c.systems[s.key];
                  if (!m) return '—';
                  if (m.skipped || m.error) return <Text style={T.td}>skipped ({m.skipped ?? m.error})</Text>;
                  const txt = `${m.correct ? '✓ correct' : '✗ wrong'}\n${m.nodes != null ? `${fmtN(m.nodes)} nodes · ` : ''}${fmtS(secs(m))}`;
                  return m.trace_key
                    ? <Text testID={`cell-${c.case}-${s.key}`} accessibilityRole="link" onPress={() => openTrace(ev.evaluation_id, m.trace_key)} style={[T.td, T.link, !m.correct && T.bad]}>{txt}</Text>
                    : <Text testID={`cell-${c.case}-${s.key}`} style={[T.td, !m.correct && T.bad]}>{txt}</Text>;
                }),
              ])} />
            <Text style={styles.muted} testID="five-case-correct">Correct: {present.map((s) => { const k = correctOf(cases, s.key); return `${s.label} ${k.ok}/${k.ran}`; }).join(' · ')}</Text>
            {ev.notes.map((n) => <Text key={n} style={styles.muted}>• {n}</Text>)}
          </Card>

          <Card testID="charts">
            <SectionTitle>Time, calls and nodes (mean over the five cases)</SectionTitle>
            <Text style={styles.muted}>One chart per measure, never a shared axis. Deterministic solvers: median of repeated runs per case. CoT: one real model call per case.</Text>
            {chart('Time per case', 'milliseconds / seconds; shorter is cheaper', secs, fmtS, 'chart-time')}
            {chart('Search nodes per case', 'nodes created (TA1 counts its "Try" lines)', (m) => m.nodes, (v) => fmtN(v), 'chart-nodes')}
            {chart('Solver calls per case', 'solver runs dispatched', (m) => m.solver_calls, (v) => fmtN(v), 'chart-solver')}
            {chart('LLM calls per case', 'local Qwen calls', (m) => m.llm_calls, (v) => fmtN(v), 'chart-llm')}
          </Card>

          <Card testID="single-vs-multi">
            <SectionTitle>Single solver vs multi-agent</SectionTitle>
            <Text style={styles.body} testID="tradeoff">
              {ratio(tm, t1) != null && ratio(nm, n1) != null
                ? `Measured: the multi-agent run took ${ratio(tm, t1)!.toFixed(1)}× the time and ${ratio(nm, n1)!.toFixed(1)}× the nodes of one MRV solver, with correctness ${cm.ok}/${cm.ran} vs ${c1.ok}/${c1.ran}. `
                : 'Not enough measured data for a ratio. '}
              {cm.ok <= c1.ok ? 'On these puzzles the extra cost bought a consistency check (three verified votes), not extra correctness.' : 'The multi-agent run was correct on more cases.'}
            </Text>
          </Card>

          <Card testID="seq-vs-par">
            <SectionTitle>Sequential vs parallel solver attempts</SectionTitle>
            <Table testID="seq-table" widths={[60, 110, 110, 90]} head={['Case', 'Parallel (thread pool)', 'Sequential', 'Same votes']}
              rows={cases.map((c) => {
                const p = c.systems.ta2_multi_agent_mrv, s = c.systems.ta2_multi_agent_sequential;
                return [String(c.case),
                  p ? <Link text={fmtS(secs(p))} onPress={() => openTrace(ev.evaluation_id, p.trace_key)} /> : '—',
                  s ? <Link testID={`seq-${c.case}`} text={fmtS(secs(s))} onPress={() => openTrace(ev.evaluation_id, s.trace_key)} /> : 'not measured',
                  p && s ? (JSON.stringify(p.votes) === JSON.stringify(s.votes) ? 'yes' : 'no') : '—'];
              })} />
            {tm != null && tsq != null && (
              <Text style={styles.body} testID="seq-summary">Mean: parallel {fmtS(tm)}, sequential {fmtS(tsq)}. {tsq < tm ? 'Sequential was faster here: each variant finishes in about a millisecond, so thread-pool overhead costs more than running them side by side saves.' : 'Parallel was faster here.'}</Text>
            )}
          </Card>

          <Card testID="cot-vs-tot">
            <SectionTitle>CoT vs ToT</SectionTitle>
            {correctOf(cases, 'ta1_cot').ran === 0
              ? <Text style={styles.muted} testID="cot-not-run">TA1 CoT was not part of this evaluation (it needs real Qwen calls). Tick "TA1 CoT" and run again; stored CoT runs from the AI Lab are below.</Text>
              : <Text style={styles.body} testID="cot-summary">TA1 CoT: {correctOf(cases, 'ta1_cot').ok}/{correctOf(cases, 'ta1_cot').ran} correct, mean {fmtS(meanOf(cases, 'ta1_cot', secs))}, {fmtN(meanOf(cases, 'ta1_cot', (m) => m.llm_calls))} LLM call per case. TA1 ToT: {correctOf(cases, 'ta1_tot').ok}/{correctOf(cases, 'ta1_tot').ran} correct, mean {fmtS(meanOf(cases, 'ta1_tot', secs))}, no LLM calls. CoT samples are single non-deterministic attempts.</Text>}
          </Card>

          <Card testID="memory-eval">
            <SectionTitle>Memory disabled vs enabled (repeated case)</SectionTitle>
            <Text style={styles.muted}>TA1 cell order, which hits real dead ends. The repeat run recalls validated dead ends from long-term memory.</Text>
            <Table testID="memory-table" widths={[50, 100, 100, 110, 100]} head={['Case', 'Off: dead ends', 'On, 1st run', 'On, repeat run', 'Memory prunes']}
              rows={ev.memory_comparison.map((m) => [String(m.case), `${m.disabled.dead_ends} (${m.disabled.nodes} nodes)`,
                `${m.enabled_first_run.dead_ends} (${m.enabled_first_run.nodes} nodes)`, `${m.enabled_repeat_run.dead_ends} (${m.enabled_repeat_run.nodes} nodes)`,
                String(m.enabled_repeat_run.memory_confirmed)])} />
          </Card>

          <Card testID="rag-eval">
            <SectionTitle>RAG k=1 vs k=3</SectionTitle>
            {ev.rag_comparison.length === 0
              ? <Text style={styles.muted} testID="rag-not-run">{ev.options?.with_rag === false ? 'RAG was switched off for this evaluation.' : 'RAG was unavailable during this evaluation (Ollama / Chroma), so no RAG values were recorded.'}</Text>
              : <Table testID="rag-table" widths={[150, 120, 120, 70]} head={['Query', 'k=1', 'k=3', 'Data']}
                rows={ev.rag_comparison.map((r, i) => {
                  const side = (s: typeof r.k1) => (s.error ? `error: ${s.error}` : `${s.abstained ? "I don't know." : 'answered'} · top ${s.top_similarity?.toFixed(3) ?? '—'} · ${s.evidence} chunk(s) · ${s.llm_calls} LLM · ${fmtS(s.seconds)}`);
                  return [`${r.group === 'unanswerable' ? '(unanswerable) ' : ''}${r.query}`, side(r.k1), side(r.k3),
                    <Link testID={`rag-trace-${i}`} text="open" onPress={() => openTrace(ev.evaluation_id, r.trace_key)} />];
                })} />}
          </Card>

          <Card testID="votes-eval">
            <SectionTitle>Voting table (evaluation)</SectionTitle>
            <Table testID="votes-table" widths={[50, 150, 90, 80]} head={['Case', 'Votes per verified board', 'Disagreement', 'Trace']}
              rows={cases.map((c) => { const m = c.systems.ta2_multi_agent_mrv; return [String(c.case), m?.votes ? Object.values(m.votes).join(' / ') + ` (of ${m.solver_calls})` : '—',
                m?.disagreement == null ? '—' : m.disagreement ? 'yes' : 'no', m?.trace_key ? <Link text="open" onPress={() => openTrace(ev.evaluation_id, m.trace_key)} /> : '—']; })} />
          </Card>

          {ev.challenge && (
            <Card testID="challenge">
              <SectionTitle>Challenge analysis</SectionTitle>
              <Text style={styles.k}>Error propagation: one faulty variant (controlled demo fault)</Text>
              <Table testID="fault-table" widths={[90, 70, 80, 150, 80, 70]} head={['Fault', 'Solved', 'Valid votes', 'Excluded', 'Time', 'Wrong answer?']}
                rows={ev.challenge.fault_propagation.map((f) => [f.fault, f.solved ? 'yes' : 'no', `${f.verified_votes}/${f.solver_calls}`,
                  f.excluded.length ? f.excluded.map((x) => `${x.attempt}: ${x.reason}`).join(', ') : 'none',
                  <Link testID={`fault-${f.fault}`} text={fmtS(f.seconds)} onPress={() => openTrace(ev.evaluation_id, f.trace_key)} />,
                  <Text style={[T.td, f.propagated_to_answer ? T.bad : T.good]}>{f.propagated_to_answer ? 'YES' : 'no'}</Text>])} />
              <Text style={styles.k}>Tool failure, retry and fallback</Text>
              <Table testID="tool-table" widths={[110, 70, 80, 80, 70, 170]} head={['Case', 'Calls', 'Failures', 'Recovered', 'Solved', 'Explanation']}
                rows={ev.challenge.tool_failure.map((t) => [<Link text={t.case} onPress={() => openTrace(ev.evaluation_id, t.trace_key)} />, String(t.tool_calls), String(t.tool_failures),
                  t.recovered ? 'yes' : 'no', t.solved ? 'yes' : 'no', t.explanation ?? '—'])} />
              <Text style={styles.k}>Prompt injection: deterministic pattern guard only</Text>
              <Table testID="guard-table" widths={[150, 70, 110, 120]} head={['Texts', 'Count', 'Blocked by guard', 'Passed to legality check']}
                rows={Object.entries(ev.challenge.injection_guard).map(([k, g]) => [k.replace(/_/g, ' '), String(g.attempts), String(g.blocked_by_pattern_guard), String(g.passed_to_legality_check)])} />
              {ev.challenge.notes.map((n) => <Text key={n} style={styles.muted}>• {n}</Text>)}
            </Card>
          )}
        </>
      )}

      {/* ------------------------------------------------ stored runs (AI Lab / Play) */}
      {cmp && (
        <>
          <Card testID="stored-modes">
            <SectionTitle>Stored runs: CoT vs ToT vs multi-agent</SectionTitle>
            <Text style={styles.muted}>{cmp.finished_runs} finished run(s) in the database. Different runs may be on different puzzles; see "same puzzle" below for like-for-like.</Text>
            {cmp.finished_runs === 0 ? <EmptyState testID="stored-empty" title="No finished runs yet" body="Start runs from Play or the AI Lab." /> : <ModeTable testID="mode-table" rows={cmp.modes} />}
          </Card>
          <Card testID="stored-memory">
            <SectionTitle>Stored ToT runs: memory off vs on</SectionTitle>
            <ModeTable testID="memory-mode-table" rows={cmp.memory} />
          </Card>
          <Card testID="same-puzzle">
            <SectionTitle>Same puzzle, different modes</SectionTitle>
            {cmp.same_puzzle.length === 0 && <Text style={styles.muted} testID="same-empty">No puzzle has two or more stored runs yet.</Text>}
            {cmp.same_puzzle.slice(0, 3).map((g, i) => (
              <View key={i} style={{ gap: 4 }} testID={`group-${i}`}>
                <Text style={styles.body}>{g.board.map((r) => r.join('')).join('/')} · modes: {g.modes.join(', ')}</Text>
                <Table widths={[110, 80, 80, 60, 60, 60]} head={['Run', 'Mode', 'Outcome', 'Nodes', 'Time', 'LLM']}
                  rows={g.runs.map((r) => [<Link text={r.run_id} onPress={() => openRun(r.run_id)} />, r.mode, `${r.outcome ?? '—'}${r.verified ? ' ✓' : ''}`, fmtN(r.nodes), fmtS(r.seconds), String(r.llm_calls ?? 0)])} />
                {g.runs.length >= 2 && <Chip testID={`group-compare-${i}`} label="Compare the two newest" onPress={() => router.push({ pathname: '/compare', params: { a: g.runs[0].run_id, b: g.runs[1].run_id } })} />}
              </View>
            ))}
          </Card>
          <Card testID="stored-votes">
            <SectionTitle>Voting table (stored multi-agent runs)</SectionTitle>
            {cmp.votes.length === 0 ? <Text style={styles.muted}>No multi-agent runs stored yet.</Text> : (
              <Table testID="stored-votes-table" widths={[110, 90, 160, 90, 90]} head={['Run', 'Votes', 'Excluded (never vote)', 'Winner', 'Faults']}
                rows={cmp.votes.map((v) => [<Link text={v.run_id} onPress={() => router.push({ pathname: '/run/[runId]', params: { runId: v.run_id } })} />,
                  Object.values(v.votes).join(' / ') || '0', v.excluded.length ? v.excluded.map((x) => `${x.attempt}: ${x.reason}`).join(', ') : 'none',
                  v.verified_winner ? 'verified' : v.outcome ?? 'none', v.faults.length ? v.faults.map((f) => `${f.variant}=${f.kind}`).join(', ') : v.inject_tool_failure ? `tool x${v.inject_tool_failure.times}` : '—'])} />
            )}
          </Card>
          <Card testID="stored-approvals">
            <SectionTitle>Human approvals (stored)</SectionTitle>
            {Object.keys(cmp.approvals).length === 0 ? <Text style={styles.muted}>No approval requests stored yet.</Text>
              : <Text style={styles.body}>{Object.entries(cmp.approvals).map(([k, v]) => `${k}: ${v.count}`).join(' · ')}</Text>}
          </Card>
        </>
      )}
      <Pressable onPress={load} testID="analytics-refresh" accessibilityRole="button" style={styles.refresh}><Text style={{ color: colors.accent }}>Refresh</Text></Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  h1: { color: colors.text, fontSize: fontSize.xl, fontWeight: '800' },
  muted: { color: colors.textMuted, fontSize: fontSize.xs },
  body: { color: colors.text, fontSize: fontSize.sm },
  k: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: '700', marginTop: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rowC: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  refresh: { alignItems: 'center', minHeight: 48, justifyContent: 'center' },
});
