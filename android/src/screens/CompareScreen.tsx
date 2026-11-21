import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { errText, MiniBoard } from '@/components/lab';
import { Button, Card, Loading, Notice, Screen, SectionTitle } from '@/components/ui';
import { useConnection } from '@/state/ConnectionContext';
import { colors, fontSize, radius, spacing } from '@/theme';
import type { RunComparison } from '@/types/api';

const LABEL: Record<string, string> = {
  outcome: 'Outcome', verified: 'Verified', seconds: 'Time (s)', nodes: 'Nodes', pruned: 'Pruned', backtracks: 'Backtracks',
  dead_ends: 'Dead ends', llm_calls: 'LLM calls', tool_calls: 'Tool calls', solver_calls: 'Solver calls', memory_confirmed: 'Memory prunes',
};
const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(4) : String(v));

/** Two stored runs of the same puzzle side by side; the backend refuses runs of different puzzles. */
export default function CompareScreen() {
  const { a, b } = useLocalSearchParams<{ a: string; b: string }>();
  const { api } = useConnection();
  const [data, setData] = useState<RunComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.compareRuns(String(a), String(b)).then(setData).catch((e) => setError(errText(e))); }, [api, a, b]);

  if (error) return <Screen testID="compare-error"><Notice kind="error">{error}</Notice><Button label="Back" onPress={() => router.back()} /></Screen>;
  if (!data) return <Screen><Loading label="Comparing runs…" /></Screen>;
  const head = (side: 'a' | 'b') => (
    <Pressable testID={`cmp-open-${side}`} accessibilityRole="link" onPress={() => router.push({ pathname: '/trace/[runId]', params: { runId: data[side].run_id } })} style={styles.cell}>
      <Text style={styles.hText}>{side.toUpperCase()}: {data[side].mode}</Text>
      <Text style={styles.link}>{data[side].run_id}</Text>
    </Pressable>
  );
  return (
    <Screen testID="compare-screen">
      <Card>
        <SectionTitle>Same puzzle, two runs</SectionTitle>
        <View style={{ alignItems: 'center' }}><MiniBoard values={data.board} size={100} /></View>
        <Text style={styles.muted}>{data.note}. Tap a run to open its recorded trace.</Text>
      </Card>
      <Card testID="compare-table">
        <View style={styles.tr}><Text style={[styles.cell, styles.k]}>Metric</Text>{head('a')}{head('b')}</View>
        {data.differences.map((d) => (
          <View key={d.metric} style={styles.tr} testID={`cmp-${d.metric}`}>
            <Text style={[styles.cell, styles.k]}>{LABEL[d.metric] ?? d.metric}</Text>
            <Text style={[styles.cell, styles.v, !d.equal && styles.diff]}>{show(d.a)}</Text>
            <Text style={[styles.cell, styles.v, !d.equal && styles.diff]}>{show(d.b)}</Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tr: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, minHeight: 40, alignItems: 'center' },
  cell: { flex: 1, paddingVertical: 6, paddingHorizontal: 4 },
  k: { color: colors.textMuted, fontSize: fontSize.xs },
  v: { color: colors.text, fontSize: fontSize.sm },
  diff: { fontWeight: '800', backgroundColor: colors.surfaceAlt, borderRadius: radius.sm },
  hText: { color: colors.text, fontSize: fontSize.xs, fontWeight: '800' },
  link: { color: colors.accent, fontSize: fontSize.xs },
  muted: { color: colors.textMuted, fontSize: fontSize.xs },
});
