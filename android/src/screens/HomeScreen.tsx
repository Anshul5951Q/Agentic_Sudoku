import { router, useFocusEffect } from 'expo-router';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LEVEL_COLOR, LEVEL_LABEL } from '@/components/ConnectionBadge';
import { Button, Card, EmptyState, Loading, Notice, Screen, SectionTitle, StatCard } from '@/components/ui';
import { formatCount, formatSeconds, useHomeData } from '@/hooks/useHomeData';
import { useConnection, type Level } from '@/state/ConnectionContext';
import { colors, fontSize, radius, spacing } from '@/theme';
import type { SessionSummary } from '@/types/api';

function StatusRow({ name, level, detail, testID }: { name: string; level: Level | 'running'; detail?: string; testID: string }) {
  const color = level === 'running' ? colors.success : LEVEL_COLOR[level];
  const label = level === 'running' ? 'running' : LEVEL_LABEL[level];
  return (
    <View style={styles.statusRow} testID={testID} accessible accessibilityLabel={`${name}: ${label}${detail ? '. ' + detail : ''}`}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.statusName}>{name} <Text style={{ color }}>{label}</Text></Text>
        {detail ? <Text style={styles.statusDetail}>{detail}</Text> : null}
      </View>
    </View>
  );
}

function ollamaDetail(level: Level, rt: ReturnType<typeof useConnection>['runtime']): string | undefined {
  if (level === 'unknown') return 'Unknown: Ollama status is reported by the backend, which is unreachable.';
  if (level === 'down') return rt?.ollama.detail ?? 'The local Ollama service could not be reached.';
  if (level === 'degraded') {
    const missing = rt?.models.filter((m) => m.status !== 'up').map((m) => m.name) ?? [];
    return missing.length ? `Missing models: ${missing.join(', ')}` : 'Some AI features are limited.';
  }
  return undefined;
}

export function sessionLabel(s: SessionSummary): string {
  const clues = s.board.flat().filter((v) => v !== 0).length;
  return `${s.title ?? 'Untitled puzzle'} · ${clues} clues`;
}

export default function HomeScreen() {
  const { backend, ollama, runtime, baseUrl, refresh } = useConnection();
  const { status, summary, sessions, error, reload } = useHomeData();

  useFocusEffect(
    useCallback(() => {
      if (backend === 'up') reload();
    }, [backend, reload]),
  );

  const down = backend === 'down';
  const latest = sessions[0];
  const openPuzzle = (s: SessionSummary) =>
    router.push({ pathname: '/play', params: { puzzleId: s.puzzle_id, sessionId: s.session_id, t: String(Date.now()) } });
  const stat = (v: string, hintLoaded = 'from stored runs') => ({ value: down || !summary ? '—' : v, hint: down ? 'backend unavailable' : status === 'loading' ? 'loading…' : summary ? hintLoaded : undefined });

  return (
    <Screen testID="home-screen">
      <View>
        <Text style={styles.title} accessibilityRole="header">SudokuMind AI</Text>
        <Text style={styles.tagline}>Watch a 4×4 Sudoku solver reason, search and backtrack.</Text>
      </View>

      <Card testID="status-card">
        <SectionTitle>Status</SectionTitle>
        <StatusRow testID="status-app" name="App" level="running" />
        <StatusRow testID="status-backend" name="Backend" level={backend} detail={backend === 'up' ? undefined : down ? `Cannot reach ${baseUrl}` : undefined} />
        <StatusRow testID="status-ollama" name="Ollama" level={ollama} detail={ollamaDetail(ollama, runtime)} />
        {(down || backend === 'checking') && <Button testID="retry" label="Retry connection" variant="secondary" onPress={refresh} />}
      </Card>

      {down && (
        <Notice kind="warning" testID="backend-down-notice">
          The local backend is unavailable. You can still open Play and enter puzzles; solving, validation, saving and statistics need the backend.
        </Notice>
      )}

      <View style={styles.actions}>
        <Button testID="start-new" label="Start New Puzzle" onPress={() => router.push({ pathname: '/play', params: { new: '1', t: String(Date.now()) } })} />
        <Button testID="continue" label="Continue Previous Puzzle" variant="secondary" disabled={!latest}
          hint={latest ? undefined : 'No saved puzzle available'} onPress={() => latest && openPuzzle(latest)} />
        <Button testID="open-lab" label="Open AI Lab" variant="secondary" onPress={() => router.push('/ai-lab')} />
        <Button testID="open-history" label="History and replay" variant="secondary" onPress={() => router.push('/history')} />
        {down && <Button testID="open-bundled" label="Open bundled recorded replay (offline)" variant="ghost" onPress={() => router.push('/replay')} />}
      </View>

      <SectionTitle>Overview</SectionTitle>
      <View style={styles.grid}>
        <StatCard testID="stat-solved" label="Puzzles solved" {...stat(formatCount(summary?.puzzles_solved))} />
        <StatCard testID="stat-time" label="Avg solve time" {...stat(formatSeconds(summary?.average_solve_seconds), summary?.average_solve_seconds == null ? 'no verified runs yet' : 'measured')} />
        <StatCard testID="stat-nodes" label="Search nodes explored" {...stat(formatCount(summary?.search_nodes_explored))} />
        <StatCard testID="stat-deadends" label="Dead-end branches" {...stat(formatCount(summary?.dead_end_branches))} />
        <StatCard testID="stat-sessions" label="Sessions saved" {...stat(formatCount(summary?.sessions_saved))} />
      </View>

      <SectionTitle>Recent sessions</SectionTitle>
      {status === 'loading' && sessions.length === 0 && <Loading label="Loading sessions…" />}
      {status === 'error' && <Notice kind="error" testID="home-error">Could not load data from the backend: {error}</Notice>}
      {!down && status === 'loaded' && sessions.length === 0 && (
        <EmptyState testID="no-sessions" title="No saved puzzles yet" body="Start a new puzzle, or load the sample in Play, then save it to see it here." />
      )}
      {down && <EmptyState testID="sessions-unavailable" title="Sessions unavailable" body="Recent sessions are stored by the backend. They will appear once it is reachable." />}
      {sessions.map((s) => (
        <Pressable key={s.session_id} testID={`session-${s.session_id}`} accessibilityRole="button" accessibilityLabel={`Open ${sessionLabel(s)}`}
          onPress={() => openPuzzle(s)} style={styles.session}>
          <Text style={styles.sessionTitle}>{sessionLabel(s)}</Text>
          <Text style={styles.sessionMeta}>
            {s.runs_count} run{s.runs_count === 1 ? '' : 's'}
            {s.last_run ? ` · last: ${s.last_run.mode} ${s.last_run.outcome ?? s.last_run.status}` : ' · not solved yet'}
          </Text>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: fontSize.xl, fontWeight: '800' },
  tagline: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: 2 },
  statusRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  statusName: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  statusDetail: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
  actions: { gap: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  session: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, minHeight: 56, justifyContent: 'center' },
  sessionTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  sessionMeta: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
});
