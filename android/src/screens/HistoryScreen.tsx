import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { errText, MiniBoard, StatusPill } from '@/components/lab';
import { Button, EmptyState, Loading, Notice, Screen } from '@/components/ui';
import { formatSeconds } from '@/hooks/useHomeData';
import { useConnection } from '@/state/ConnectionContext';
import { colors, fontSize, radius, spacing } from '@/theme';
import type { SessionSummary } from '@/types/api';

const PAGE = 20;
export const when = (iso: string | null | undefined) => (iso ? iso.replace('T', ' ').slice(0, 16) + ' UTC' : '—');

/** Saved puzzle sessions, newest activity first, with each session's latest run and its stored metrics. */
export default function HistoryScreen() {
  const { api, backend } = useConnection();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (offset = 0) => {
    if (offset === 0) setState('loading');
    try {
      const r = await api.history(PAGE, offset);
      setSessions((cur) => (offset === 0 ? r.sessions : [...cur, ...r.sessions]));
      setTotal(r.total);
      setState('loaded');
      setError(null);
    } catch (e) {
      setError(errText(e));
      setState('error');
    }
  }, [api]);

  useFocusEffect(useCallback(() => { load(0); }, [load]));

  return (
    <Screen testID="history-screen">
      <Text style={styles.h1} accessibilityRole="header">History</Text>
      <Text style={styles.muted}>Every session and run below is read from the backend database. Finished runs open as recorded replays.</Text>
      {backend === 'down' && <Notice kind="warning" testID="history-offline">The backend is unavailable, so saved sessions cannot be listed. A bundled recorded replay is still available.</Notice>}
      {backend === 'down' && <Button testID="open-bundled" label="Open bundled recorded replay" variant="secondary" onPress={() => router.push('/replay')} />}
      {state === 'loading' && <Loading label="Loading sessions…" />}
      {state === 'error' && (
        <>
          <Notice kind="error" testID="history-error">Could not load history: {error}</Notice>
          <Button testID="history-retry" label="Retry" variant="secondary" onPress={() => load(0)} />
        </>
      )}
      {state === 'loaded' && sessions.length === 0 && (
        <EmptyState testID="history-empty" title="No saved sessions yet" body="Save a puzzle in Play or start a run in the AI Lab; it will appear here." />
      )}
      {sessions.map((s) => {
        const lr = s.last_run;
        return (
          <Pressable key={s.session_id} testID={`hist-${s.session_id}`} accessibilityRole="button" accessibilityLabel={`Open session ${s.title ?? s.session_id}`}
            onPress={() => router.push({ pathname: '/history/[sessionId]', params: { sessionId: s.session_id } })} style={styles.row}>
            <MiniBoard values={s.board} size={64} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.title} numberOfLines={1}>{s.title ?? 'Untitled puzzle'}</Text>
              <Text style={styles.muted}>{when(s.updated_at)} · {s.runs_count} run{s.runs_count === 1 ? '' : 's'}</Text>
              {lr ? (
                <View style={styles.meta}>
                  <StatusPill status={lr.status} />
                  <Text style={styles.muted}>{lr.mode} · {lr.outcome ?? '—'}{lr.verified ? ' · verified' : ''} · {lr.nodes ?? '—'} nodes · {formatSeconds(lr.elapsed_seconds)}</Text>
                </View>
              ) : <Text style={styles.muted}>not solved yet</Text>}
            </View>
          </Pressable>
        );
      })}
      {state === 'loaded' && sessions.length < total && (
        <Button testID="history-more" label={`Load more (${total - sessions.length} left)`} variant="secondary" onPress={() => load(sessions.length)} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  h1: { color: colors.text, fontSize: fontSize.xl, fontWeight: '800' },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: fontSize.xs, flexShrink: 1 },
  row: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', minHeight: 56 },
  meta: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' },
});
