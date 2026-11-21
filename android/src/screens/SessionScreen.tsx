import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Chip, errText, KV, MiniBoard, StatusPill } from '@/components/lab';
import { Button, Card, EmptyState, Loading, Notice, Screen, SectionTitle } from '@/components/ui';
import { formatSeconds } from '@/hooks/useHomeData';
import { shareJson } from '@/services/share';
import { useConnection } from '@/state/ConnectionContext';
import { colors, fontSize, spacing } from '@/theme';
import type { SessionDetail } from '@/types/api';
import { when } from './HistoryScreen';

const FINISHED = ['completed', 'failed', 'cancelled'];

/** One saved session: reopen the puzzle, resume an eligible run, replay a finished trace, export it, compare two runs. */
export default function SessionScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { api } = useConnection();
  const [data, setData] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await api.session(String(sessionId))); setError(null); }
    catch (e) { setError({ code: (e as { code?: string }).code ?? null, message: errText(e) }); }
  }, [api, sessionId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (error && !data) {
    return (
      <Screen testID="session-error">
        <Notice kind="error">{error.code === 'SESSION_NOT_FOUND' ? 'This session no longer exists on the backend.' : `Could not load the session: ${error.message}`}</Notice>
        <Button label="Retry" onPress={load} />
      </Screen>
    );
  }
  if (!data) return <Screen><Loading label="Loading the session…" /></Screen>;

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));
  const resume = async (id: string) => {
    setBusy(id);
    try { await api.resume(id); router.push({ pathname: '/trace/[runId]', params: { runId: id } }); }
    catch (e) { setMsg(`Resume failed: ${errText(e)}`); load(); }
    finally { setBusy(null); }
  };
  const exportRun = async (id: string) => {
    setBusy(id);
    try {
      const t = await api.exportTrace(id);
      const shared = await shareJson(`${id}-trace.json`, t);
      setMsg(shared ? `Exported ${t.events.length} recorded events of ${id} as JSON.` : 'Export cancelled.');
    } catch (e) { setMsg(`Export failed: ${errText(e)}`); }
    finally { setBusy(null); }
  };

  return (
    <Screen testID="session-screen">
      <Card testID="session-head">
        <SectionTitle>{data.session.title ?? 'Untitled puzzle'}</SectionTitle>
        <View style={{ alignItems: 'center' }}><MiniBoard values={data.puzzle.board} size={120} testID="session-board" /></View>
        <KV k="Saved" v={when(data.session.created_at)} />
        <KV k="Uniqueness" testID="session-unique" v={data.puzzle.solution_count == null ? 'not checked' : data.puzzle.solution_count === 0 ? 'no solution' : data.puzzle.unique ? 'unique solution' : 'two or more solutions'} />
        <Button testID="reopen" label="Reopen in Play" onPress={() => router.push({ pathname: '/play', params: { puzzleId: data.puzzle.puzzle_id, sessionId: data.session.session_id, t: String(Date.now()) } })} />
      </Card>
      {msg && <Notice kind="info" testID="session-msg">{msg}</Notice>}

      <SectionTitle>Runs ({data.runs.length})</SectionTitle>
      {data.runs.length === 0 && <EmptyState testID="session-no-runs" title="No runs yet" body="Reopen the puzzle and use Solve with AI, or start a run in the AI Lab." />}
      {data.runs.length >= 2 && (
        <View style={{ gap: spacing.sm }}>
          <Text style={styles.muted}>Tick two runs to compare them metric by metric ({picked.length}/2 selected).</Text>
          <Button testID="compare" label="Compare selected runs" variant="secondary" disabled={picked.length !== 2}
            onPress={() => router.push({ pathname: '/compare', params: { a: picked[0], b: picked[1] } })} />
        </View>
      )}
      {data.runs.map((r) => (
        <Card key={r.run_id} testID={`srun-${r.run_id}`}>
          <View style={styles.rowBetween}>
            <Text style={styles.h3}>{r.mode === 'multi-agent' ? 'Multi-agent' : r.mode === 'tot' ? 'Tree-of-Thought' : 'Chain-of-Thought'}</Text>
            <StatusPill status={r.status} />
          </View>
          <Text style={styles.muted}>{r.run_id} · {when(r.created_at)}</Text>
          <Text style={styles.metrics} testID={`srun-metrics-${r.run_id}`}>
            {r.outcome ?? '—'}{r.verified ? ' (verified)' : ''} · {r.nodes ?? '—'} nodes · {r.backtracks ?? '—'} backtracks · {formatSeconds(r.elapsed_seconds)} · {r.llm_calls ?? 0} LLM call{r.llm_calls === 1 ? '' : 's'}
          </Text>
          <View style={styles.actions}>
            {FINISHED.includes(r.status) && <Chip testID={`replay-${r.run_id}`} label="Recorded replay" onPress={() => router.push({ pathname: '/trace/[runId]', params: { runId: r.run_id } })} />}
            {!FINISHED.includes(r.status) && <Chip testID={`open-${r.run_id}`} label="Open" onPress={() => router.push({ pathname: '/trace/[runId]', params: { runId: r.run_id } })} />}
            {r.resumable && <Chip testID={`resume-${r.run_id}`} label={busy === r.run_id ? 'Resuming…' : 'Resume from checkpoint'} disabled={!!busy} onPress={() => resume(r.run_id)} />}
            <Chip testID={`details-${r.run_id}`} label="Agents & votes" onPress={() => router.push({ pathname: '/run/[runId]', params: { runId: r.run_id } })} />
            <Chip testID={`export-${r.run_id}`} label="Export JSON" disabled={!!busy} onPress={() => exportRun(r.run_id)} />
            {data.runs.length >= 2 && <Chip testID={`pick-${r.run_id}`} label={picked.includes(r.run_id) ? '☑ compare' : '☐ compare'} on={picked.includes(r.run_id)} onPress={() => toggle(r.run_id)} />}
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  h3: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', flexShrink: 1 },
  muted: { color: colors.textMuted, fontSize: fontSize.xs },
  metrics: { color: colors.text, fontSize: fontSize.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
