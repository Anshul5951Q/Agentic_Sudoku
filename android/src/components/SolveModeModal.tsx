import { router } from 'expo-router';
import React, { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Chip, errCode, errText, isUnreachable } from '@/components/lab';
import { Button, Notice } from '@/components/ui';
import { useConnection } from '@/state/ConnectionContext';
import { colors, fontSize, radius, spacing } from '@/theme';
import type { RunMode } from '@/types/api';

const MODES: { mode: RunMode; title: string; det: string; llm: string }[] = [
  { mode: 'cot', title: 'Chain-of-Thought (TA1)', det: 'Deterministic: final verification only.', llm: 'LLM: one local qwen2.5:3b single-path attempt. Its answer is NOT a correctness proof.' },
  { mode: 'tot', title: 'Tree-of-Thought', det: 'Deterministic: cell selection, candidates, rule checks, pruning, backtracking, verification.', llm: 'LLM: none.' },
  { mode: 'multi-agent', title: 'Multi-Agent', det: 'Deterministic: supervisor (MAX_HOPS), three candidate-order variants, verified-only voting.', llm: 'LLM: none (variants are not independent LLM agents).' },
];

/** Starts a solve on exactly the puzzle shown in Play (same input for every mode) and opens its live search view. */
export function SolveModeModal({ visible, onClose, board, puzzleId }: { visible: boolean; onClose: () => void; board: number[][]; puzzleId: string | null }) {
  const { api, backend } = useConnection();
  const [strategy, setStrategy] = useState<'mrv' | 'first_empty'>('mrv');
  const [busy, setBusy] = useState<RunMode | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const start = async (mode: RunMode) => {
    setBusy(mode); setErr(null);
    try {
      const body = { ...(puzzleId ? { puzzle_id: puzzleId } : { board }), ...(mode === 'cot' ? {} : { strategy, ...(strategy === 'first_empty' && mode === 'tot' ? { order: 'desc' as const } : {}) }) };
      const run = await api.startRun(mode, body);
      onClose();
      router.push({ pathname: '/trace/[runId]', params: { runId: run.run_id } });
    } catch (e) {
      const code = errCode(e);
      setErr(isUnreachable(e) ? 'The backend is not reachable.' : code === 'PUZZLE_CONTRADICTORY' ? 'This puzzle breaks the Sudoku rules, so it cannot be solved. Fix the highlighted duplicates first.'
        : code === 'OLLAMA_UNAVAILABLE' ? 'Ollama is unavailable, so the CoT mode cannot run. ToT and Multi-Agent do not need it.' : errText(e));
    } finally { setBusy(null); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <View style={styles.sheet} testID="solve-modal">
          <Text style={styles.title}>Solve this puzzle with…</Text>
          <Text style={styles.muted}>Every mode receives exactly this puzzle. Results differ in cost (model calls, solver runs), so compare them on the Analytics tab rather than assuming one is better.</Text>
          <View style={styles.chips}>
            <Text style={styles.muted}>Cell strategy:</Text>
            <Chip testID="strat-mrv" label="MRV" on={strategy === 'mrv'} onPress={() => setStrategy('mrv')} />
            <Chip testID="strat-first" label="First empty (TA1 order)" on={strategy === 'first_empty'} onPress={() => setStrategy('first_empty')} />
          </View>
          <Text style={styles.muted}>MRV rarely needs to backtrack on 4×4 puzzles; first-empty order shows dead ends and backtracking.</Text>
          {MODES.map((m) => (
            <View key={m.mode} style={styles.mode} testID={`mode-card-${m.mode}`}>
              <Text style={styles.h3}>{m.title}</Text>
              <Text style={styles.muted}>{m.det}</Text>
              <Text style={styles.muted}>{m.llm}</Text>
              <Button testID={`solve-${m.mode}`} label={busy === m.mode ? 'Starting…' : `Start ${m.title}`} disabled={!!busy || backend === 'down'} onPress={() => start(m.mode)} />
            </View>
          ))}
          {err && <Notice kind="error" testID="solve-error">{err}</Notice>}
          <Button testID="solve-close" label="Close" variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, maxHeight: '92%' },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  h3: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: fontSize.xs },
  chips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', alignItems: 'center' },
  mode: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md, gap: 4 },
});
