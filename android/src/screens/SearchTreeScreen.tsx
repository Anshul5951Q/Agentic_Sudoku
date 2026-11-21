import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Chip, errText, KV, MiniBoard, StatusPill } from '@/components/lab';
import { SudokuBoard } from '@/components/SudokuBoard';
import { Button, Card, EmptyState, Loading, Notice, Screen, SectionTitle } from '@/components/ui';
import { useTraceRun, type RecordedTrace } from '@/hooks/useTraceRun';
import { useConnection } from '@/state/ConnectionContext';
import { buildFrames, outline, solverEvents, variantsOf, type TreeNode } from '@/state/timeline';
import { colors, fontSize, radius, spacing } from '@/theme';
import type { TraceEvent } from '@/types/api';

const SPEEDS = [{ label: '0.5×', ms: 1200 }, { label: '1×', ms: 600 }, { label: '2×', ms: 300 }, { label: '4×', ms: 150 }];
const STATUS_COLOR: Record<string, string> = {
  expanded: colors.info, pending: colors.textMuted, accepted: colors.success, rejected: colors.danger, dead_end: colors.danger, pruned: colors.warning, solution: colors.verified,
};
const FILTERS: { value: string; label: string; test: (e: TraceEvent) => boolean }[] = [
  { value: 'all', label: 'All', test: () => true },
  { value: 'decisions', label: 'Decisions', test: (e) => ['cell_selected', 'candidates_generated', 'candidate_proposed', 'candidate_accepted'].includes(e.event) },
  { value: 'failures', label: 'Dead ends & pruning', test: (e) => ['rule_violation', 'dead_end', 'branch_pruned', 'search_failed'].includes(e.event) },
  { value: 'backtracks', label: 'Backtracks', test: (e) => e.event === 'backtrack_started' },
  { value: 'memory', label: 'Memory', test: (e) => e.event.startsWith('memory_') },
  { value: 'lifecycle', label: 'Lifecycle', test: (e) => e.event.startsWith('search_') || e.event.startsWith('solution_') },
];
const NO_CONFLICTS: ReadonlySet<string> = new Set();
const fmtCell = (c: number[] | null) => (c ? `[${c[0]}, ${c[1]}]` : '—');

export default function SearchTreeScreen({ WebSocketImpl, recorded }: { WebSocketImpl?: typeof WebSocket; recorded?: RecordedTrace } = {}) {
  const params = useLocalSearchParams<{ runId: string }>();
  const runId = recorded ? recorded.run.run_id : params.runId;
  const { api } = useConnection();
  const { run, events, conn, attempt, error, reload, reattach, live } = useTraceRun(String(runId), { WebSocketImpl, recorded });
  const variants = useMemo(() => variantsOf(events), [events]);
  const [variant, setVariant] = useState<string | null>(null);
  useEffect(() => { if (variants.length && (!variant || !variants.includes(variant))) setVariant(variants[0]); }, [variants, variant]);
  const solver = useMemo(() => solverEvents(events, variants.length ? variant : null), [events, variant, variants.length]);
  const frames = useMemo(() => buildFrames(solver), [solver]);

  const [cursor, setCursor] = useState(-1);          // -1 = follow the latest frame
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [filter, setFilter] = useState('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [inspect, setInspect] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { width } = useWindowDimensions();

  const last = frames.length - 1;
  const idx = cursor < 0 ? last : Math.min(cursor, last);
  const frame = idx >= 0 ? frames[idx] : null;

  useEffect(() => {
    if (!playing) return;
    if (idx >= last) { setPlaying(false); return; }
    const t = setTimeout(() => setCursor(idx + 1 >= last && live ? -1 : idx + 1), SPEEDS[speed].ms);
    return () => clearTimeout(t);
  }, [playing, idx, last, speed, live]);

  if (error && !run) {
    return (
      <Screen testID="tree-error">
        <Notice kind="error" testID="tree-error-msg">{error.code === 'RUN_NOT_FOUND' ? 'This run was not found on the backend.' : `Could not load the run: ${error.message}`}</Notice>
        <Button label="Retry" onPress={reload} />
      </Screen>
    );
  }
  if (!run) return <Screen><Loading label="Loading the search trace…" /></Screen>;

  const res = run.result;
  const failure = res?.failure;
  const rows = frame ? outline(frame.nodes, collapsed) : [];
  const shownEvents = solver.slice(0, idx + 1).filter((e) => (FILTERS.find((f) => f.value === filter) ?? FILTERS[0]).test(e));
  const inspected: TreeNode | undefined = inspect && frame ? frame.nodes[inspect] : undefined;
  const control = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); setMsg(ok); } catch (e) { setMsg(errText(e)); } await reattach(); };
  const at = (i: number) => { setPlaying(false); setCursor(Math.max(0, Math.min(i, last))); };
  const boardSize = Math.min(300, width - spacing.lg * 2);

  return (
    <Screen testID="tree-screen">
      <Card testID="tree-header">
        <View style={styles.rowBetween}>
          <Text style={styles.h2} accessibilityRole="header">{run.mode === 'multi-agent' ? 'Multi-agent search' : run.mode === 'tot' ? 'Tree-of-Thought search' : 'Chain-of-Thought attempt'}</Text>
          <StatusPill testID="tree-status" status={run.status} />
        </View>
        {recorded ? <Text style={styles.replay} testID="mode-bundled">RECORDED REPLAY bundled with the app (real backend run {recorded.run.run_id}, recorded {recorded.run.created_at.slice(0, 10)}). Offline fallback: this is NOT a live run.</Text>
          : live ? <Text style={styles.live} testID="mode-live">LIVE run: events stream from the backend as they happen</Text>
          : ['completed', 'failed', 'cancelled'].includes(run.status) ? <Text style={styles.replay} testID="mode-replay">RECORDED REPLAY of the stored trace (not a live run)</Text>
            : <Text style={styles.live} testID="mode-stopped">Not running ({run.status}){run.resumable ? ': resume to continue from the checkpoint' : ''}</Text>}
        <KV k="Deterministic" testID="tree-det" v={run.deterministic_components.join(', ')} />
        <KV k="LLM" testID="tree-llm" v={run.llm_components.length ? run.llm_components.join(', ') : 'none'} />
        {live && <KV k="Connection" testID="tree-conn" v={conn === 'reconnecting' ? `reconnecting (attempt ${attempt}); missed events will be fetched` : conn} />}
        {error && run && <Notice kind="error" testID="tree-stream-error">{error.message}</Notice>}
        {failure?.code === 'OLLAMA_UNAVAILABLE' && <Notice kind="warning" testID="tree-ollama">Ollama is unavailable: {failure.reason}</Notice>}
        {failure?.code === 'TIMEOUT' && <Notice kind="warning" testID="tree-timeout">Timed out: {failure.reason}</Notice>}
        {failure && failure.code !== 'OLLAMA_UNAVAILABLE' && failure.code !== 'TIMEOUT' && <Notice kind="error" testID="tree-failed">Solver failed: {failure.code}: {failure.reason}</Notice>}
        {frame?.resumed && <Notice kind="info" testID="tree-resumed">This run was resumed from a saved checkpoint.</Notice>}
        {frame?.paused && <Notice kind="warning" testID="tree-paused">Paused at a safe checkpoint.</Notice>}
        {msg && <Notice kind="info" testID="tree-msg">{msg}</Notice>}
        {run.mode === 'tot' && !recorded && (
          <View style={styles.row}>
            <Button testID="tree-pause" label="Pause run" variant="secondary" disabled={run.status !== 'running'} onPress={() => control(() => api.pause(run.run_id), 'Paused at a safe checkpoint.')} />
            <Button testID="tree-resume" label="Resume run" variant="secondary" disabled={!run.resumable} onPress={() => control(() => api.resume(run.run_id), 'Resumed from the saved checkpoint.')} />
          </View>
        )}
        {!recorded && <Button testID="open-agents" label="Agents, routing and votes" variant="ghost" onPress={() => router.push({ pathname: '/run/[runId]', params: { runId: run.run_id } })} />}
      </Card>

      {variants.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={styles.muted}>Candidate-order variant (same deterministic solver, different candidate order):</Text>
          <View style={styles.chips}>{variants.map((v) => <Chip key={v} testID={`variant-${v}`} label={v} on={variant === v} onPress={() => { setVariant(v); setCursor(-1); setInspect(null); }} />)}</View>
        </View>
      )}

      {frames.length === 0 ? (
        <EmptyState testID="tree-empty" title={live ? 'Waiting for the first event…' : 'No search events'} body={run.mode === 'cot' ? 'A chain-of-thought attempt makes no search tree; see the events below.' : 'The backend recorded no search events for this run.'} />
      ) : (
        <>
          <Card testID="frame-card">
            <View style={styles.rowBetween}>
              <Text style={styles.h3} testID="frame-pos">Step {idx + 1} of {frames.length}{cursor < 0 && live ? ' (following live)' : ''}</Text>
              <Text style={styles.muted}>depth {frame!.depth}</Text>
            </View>
            {frame!.board ? (
              <SudokuBoard values={frame!.board} fixed={run.board.map((r) => r.map((v) => v !== 0))} selected={frame!.selected as [number, number] | null}
                conflicts={NO_CONFLICTS} onSelect={() => undefined} size={boardSize} />
            ) : <Text style={styles.muted}>No board snapshot at this step.</Text>}
            <KV k="Selected cell" testID="frame-cell" v={fmtCell(frame!.selected)} />
            <View style={styles.chips} testID="frame-candidates">
              <Text style={styles.k}>Candidates</Text>
              {frame!.candidates?.length ? frame!.candidates.map((c) => <View key={c} style={styles.cand}><Text style={styles.candText}>{c}</Text></View>) : <Text style={styles.muted}>none</Text>}
            </View>
            <View style={styles.counters} testID="frame-counters">
              {[['explored', frame!.counters.proposed], ['accepted', frame!.counters.accepted], ['dead ends', frame!.counters.deadEnds], ['pruned', frame!.counters.pruned], ['backtracks', frame!.counters.backtracks]].map(([k, v]) => (
                <View key={k as string} style={styles.counter}><Text style={styles.cv} testID={`count-${(k as string).replace(' ', '-')}`}>{v}</Text><Text style={styles.ck}>{k}</Text></View>
              ))}
            </View>
            <View style={styles.eventBox} testID="frame-event">
              <Text style={styles.evHead}>#{frame!.event.sequence} {frame!.event.event} · {frame!.event.agent}{frame!.event.cell ? ` · cell ${fmtCell(frame!.event.cell)}` : ''}{frame!.event.candidate != null ? ` = ${frame!.event.candidate}` : ''}</Text>
              {(frame!.event.reason_code || frame!.event.reason) && <Text style={styles.evBody}>{frame!.event.reason_code ? `[${frame!.event.reason_code}] ` : ''}{frame!.event.reason}</Text>}
            </View>
          </Card>

          <View style={styles.controls} testID="playback">
            <Button testID="pb-restart" label="⏮" variant="secondary" hint="Restart replay" onPress={() => at(0)} />
            <Button testID="pb-back" label="◀" variant="secondary" hint="Step back" disabled={idx <= 0} onPress={() => at(idx - 1)} />
            <Button testID="pb-play" label={playing ? '⏸' : '▶'} hint={playing ? 'Pause playback' : 'Play'} onPress={() => { if (!playing && idx >= last) setCursor(0); setPlaying(!playing); }} />
            <Button testID="pb-forward" label="▶|" variant="secondary" hint="Step forward" disabled={idx >= last} onPress={() => at(idx + 1)} />
            <Button testID="pb-end" label="⏭" variant="secondary" hint={live ? 'Follow live' : 'Jump to end'} onPress={() => { setPlaying(false); setCursor(-1); }} />
          </View>
          <View style={styles.chips}>{SPEEDS.map((s, i) => <Chip key={s.label} testID={`speed-${i}`} label={s.label} on={speed === i} onPress={() => setSpeed(i)} />)}</View>

          {frame!.verified && frame!.solution && (
            <Card testID="verified-solution">
              <SectionTitle>Verified solution</SectionTitle>
              <View style={{ alignItems: 'center' }}><MiniBoard values={frame!.solution} size={160} /></View>
              <Text style={styles.muted}>The complete board passed deterministic verification (every row, column and 2×2 box, and all original clues).</Text>
            </Card>
          )}

          <Card testID="tree-card">
            <SectionTitle>Search tree (at this step)</SectionTitle>
            {rows.length === 0 && <Text style={styles.muted}>No nodes yet.</Text>}
            {rows.map(({ node, level, hasChildren }) => (
              <View key={node.id} style={[styles.nodeRow, { marginLeft: level * 14 }]}>
                {hasChildren ? (
                  <Pressable testID={`toggle-${node.id}`} accessibilityRole="button" accessibilityLabel={collapsed.has(node.id) ? 'Expand branch' : 'Collapse branch'}
                    onPress={() => setCollapsed((c) => { const n = new Set(c); n.has(node.id) ? n.delete(node.id) : n.add(node.id); return n; })} style={styles.toggle}>
                    <Text style={styles.toggleText}>{collapsed.has(node.id) ? '▸' : '▾'}</Text>
                  </Pressable>
                ) : <View style={styles.toggle} />}
                <Pressable testID={`node-${node.id}`} accessibilityRole="button" onPress={() => setInspect(node.id)} style={[styles.node, inspect === node.id && { borderColor: colors.accent }]}>
                  <Text style={styles.nodeText}>{node.cell ? `${fmtCell(node.cell)} = ${node.value}` : 'root'}</Text>
                  <Text style={[styles.nodeStatus, { color: STATUS_COLOR[node.status] }]} testID={`node-status-${node.id}`}>{node.status.replace('_', ' ')}</Text>
                </Pressable>
              </View>
            ))}
          </Card>

          {inspected && (
            <Card testID="inspector">
              <SectionTitle>Node {inspected.id}</SectionTitle>
              <KV k="Decision" v={inspected.cell ? `cell ${fmtCell(inspected.cell)} = ${inspected.value}` : 'root (the original puzzle)'} />
              <KV k="Depth" v={String(inspected.depth)} />
              <KV k="Status" testID="inspector-status" v={inspected.status.replace('_', ' ')} />
              <KV k="Reason" testID="inspector-reason" v={inspected.reason ? `[${inspected.reasonCode}] ${inspected.reason}` : '—'} />
              <KV k="Candidates" v={inspected.candidates?.join(', ') ?? '—'} />
              {inspected.board ? <View style={{ alignItems: 'center' }}><MiniBoard testID="inspector-board" values={inspected.board} highlight={inspected.cell as [number, number] | null} /></View>
                : <Text style={styles.muted}>No board snapshot was recorded for this node (it was never placed).</Text>}
            </Card>
          )}
        </>
      )}

      <Card testID="event-list">
        <SectionTitle>Events up to this step</SectionTitle>
        <View style={styles.chips}>{FILTERS.map((f) => <Chip key={f.value} testID={`ef-${f.value}`} label={f.label} on={filter === f.value} onPress={() => setFilter(f.value)} />)}</View>
        {shownEvents.length === 0 && <Text style={styles.muted} testID="ef-empty">No events of this type yet.</Text>}
        {shownEvents.slice(-80).map((e) => (
          <Pressable key={e.event_id} testID={`ev-${e.sequence}`} onPress={() => at(solver.indexOf(e))} style={styles.evRow}>
            <Text style={styles.evHead}>#{e.sequence} {e.event} · {e.agent}</Text>
            {(e.reason_code || e.reason) && <Text style={styles.evBody}>{e.reason_code ? `[${e.reason_code}] ` : ''}{e.reason}</Text>}
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  chips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', alignItems: 'center' },
  h2: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800', flexShrink: 1 },
  h3: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: fontSize.xs },
  k: { color: colors.textMuted, fontSize: fontSize.xs, width: 92 },
  live: { color: colors.info, fontSize: fontSize.xs, fontWeight: '800' },
  replay: { color: colors.warning, fontSize: fontSize.xs, fontWeight: '800' },
  cand: { minWidth: 32, minHeight: 32, borderRadius: radius.pill, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  candText: { color: colors.text, fontWeight: '800' },
  counters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  counter: { minWidth: 72, flexGrow: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' },
  cv: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  ck: { color: colors.textMuted, fontSize: fontSize.xs },
  eventBox: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm },
  controls: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', flexWrap: 'wrap' },
  nodeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  toggle: { width: 36, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  toggleText: { color: colors.accent, fontSize: fontSize.lg },
  node: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, minHeight: 40, alignItems: 'center', backgroundColor: colors.surfaceAlt },
  nodeText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  nodeStatus: { fontSize: fontSize.xs, fontWeight: '800' },
  evRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 6 },
  evHead: { color: colors.text, fontSize: fontSize.xs, fontWeight: '700' },
  evBody: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
});
