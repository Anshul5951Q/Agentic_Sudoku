import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { NumberPad } from '@/components/NumberPad';
import { SolveModeModal } from '@/components/SolveModeModal';
import { SudokuBoard } from '@/components/SudokuBoard';
import { Button, Card, EmptyState, Loading, Notice, Screen, SectionTitle } from '@/components/ui';
import { SAMPLE_PUZZLE } from '@/constants/sample';
import { useValidation } from '@/hooks/useValidation';
import { ApiClientError } from '@/services/apiClient';
import { useConnection } from '@/state/ConnectionContext';
import { boardOf, initialPlayState, isBlank, playReducer } from '@/state/playReducer';
import { colors, fontSize, radius, spacing } from '@/theme';
import type { SessionSummary, SolutionCount } from '@/types/api';

const MAX_BOARD = 380;

type Notice_ = { kind: 'info' | 'success' | 'warning' | 'error'; text: string } | null;

const errText = (e: unknown): string => {
  const err = e as ApiClientError;
  return err instanceof ApiClientError && err.unreachable ? 'The backend is not reachable right now.' : (err?.message ?? 'Something went wrong.');
};

const uniquenessText = (c: SolutionCount): string =>
  c.classification === 'none' ? 'No solution exists for this board.'
    : c.classification === 'unique' ? 'Exactly one solution: the puzzle is unique.'
      : 'Two or more solutions: the puzzle is not unique.';

export default function PlayScreen() {
  const params = useLocalSearchParams<{ puzzleId?: string; new?: string; t?: string }>();
  const { api, backend } = useConnection();
  const [state, dispatch] = useReducer(playReducer, undefined, initialPlayState);
  const { width } = useWindowDimensions();
  const boardSize = Math.max(240, Math.min(MAX_BOARD, width - spacing.lg * 2));

  const board = useMemo(() => boardOf(state), [state]);
  const blank = isBlank(state);
  const validation = useValidation(board, blank);
  const [notice, setNotice] = useState<Notice_>(null);
  const [uniq, setUniq] = useState<SolutionCount | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadOpen, setLoadOpen] = useState(false);
  const [saved, setSaved] = useState<SessionSummary[] | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [solveOpen, setSolveOpen] = useState(false);

  // Conflicts are reported by the backend; the UI only draws them.
  const conflicts = useMemo(() => {
    const set = new Set<string>();
    validation.result?.conflicts.forEach((c) => c.cells.forEach(([r, cc]) => set.add(`${r},${cc}`)));
    return set;
  }, [validation.result]);

  useEffect(() => setUniq(null), [state.values, state.mode]);

  // Open a saved puzzle / start a new one when navigated here with parameters.
  const lastParams = useRef<string>('');
  useEffect(() => {
    const sig = `${params.puzzleId ?? ''}|${params.new ?? ''}|${params.t ?? ''}`;
    if (sig === '||' || sig === lastParams.current) return;
    lastParams.current = sig;
    if (params.new) {
      dispatch({ type: 'clearBoard' });
      setNotice({ kind: 'info', text: 'New puzzle: enter the clues, then press Start playing.' });
    } else if (params.puzzleId) {
      setBusy('Opening puzzle…');
      api.getPuzzle(params.puzzleId)
        .then((p) => {
          dispatch({ type: 'load', board: p.board, meta: { puzzleId: p.puzzle_id, sessionId: p.session_id, name: p.name, source: 'saved' } });
          setNotice({ kind: 'success', text: 'Puzzle opened from your saved sessions.' });
        })
        .catch((e) => setNotice({ kind: 'error', text: `Could not open the puzzle: ${errText(e)}` }))
        .finally(() => setBusy(null));
    }
  }, [params.puzzleId, params.new, params.t, api]);

  const selectedFixed = !!state.selected && state.mode === 'play' && state.fixed[state.selected[0]][state.selected[1]];
  const padDisabled = !state.selected || selectedFixed;

  const doValidate = useCallback(async () => {
    if (blank) return setNotice({ kind: 'info', text: 'The board is empty: enter some clues first.' });
    const r = await validation.validateNow();
    if (!r) return setNotice({ kind: 'warning', text: 'Validation is unavailable: the backend could not be reached.' });
    setNotice({ kind: r.valid ? (r.solved ? 'success' : 'info') : 'error', text: r.solved ? 'Verified solved (checked by the backend).' : r.message });
  }, [blank, validation]);

  const doUniqueness = useCallback(async () => {
    setBusy('Checking uniqueness…');
    try {
      setUniq(await api.countSolutions(board));
    } catch (e) {
      setNotice({ kind: 'warning', text: `Uniqueness check unavailable: ${errText(e)}` });
    } finally {
      setBusy(null);
    }
  }, [api, board]);

  const doSave = useCallback(async () => {
    if (blank) return setNotice({ kind: 'info', text: 'Nothing to save yet.' });
    setBusy('Saving…');
    try {
      // Saves the puzzle (clues), not in-progress entries.
      const clues = state.values.map((row, r) => row.map((v, c) => (state.fixed[r][c] ? v : 0)));
      const p = await api.createPuzzle(clues, state.meta.name ?? undefined, state.meta.source === 'sample' ? 'sample' : state.meta.source === 'generated' ? 'generated' : 'user');
      dispatch({ type: 'saved', puzzleId: p.puzzle_id, sessionId: p.session_id });
      setNotice({ kind: 'success', text: `Saved puzzle ${p.puzzle_id}. It now appears in your sessions.` });
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not save: ${errText(e)}` });
    } finally {
      setBusy(null);
    }
  }, [api, blank, state]);

  const openLoad = useCallback(async () => {
    setLoadOpen(true);
    setSaved(null);
    setSavedError(null);
    try {
      setSaved((await api.history(30)).sessions);
    } catch (e) {
      setSavedError(errText(e));
    }
  }, [api]);

  const doGenerate = useCallback(async () => {
    setBusy('Generating a verified puzzle…');
    try {
      const p = await api.generate(6);
      dispatch({ type: 'load', board: p.board, meta: { name: 'Generated puzzle', source: 'generated' } });
      setNotice({ kind: 'success', text: 'Generated a puzzle verified solvable with a unique solution.' });
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not generate: ${errText(e)}` });
    } finally {
      setBusy(null);
    }
  }, [api]);

  const confirmReset = () =>
    Alert.alert('Reset puzzle?', state.mode === 'play' ? 'Your entries will be removed; the clues stay.' : 'All entries will be cleared.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => { dispatch({ type: 'reset' }); setNotice(null); } },
    ]);
  const confirmClear = () =>
    blank ? dispatch({ type: 'clearBoard' }) : Alert.alert('Clear the board?', 'This removes every number, including clues.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear board', style: 'destructive', onPress: () => { dispatch({ type: 'clearBoard' }); setNotice(null); } },
    ]);

  const banner = (() => {
    if (validation.status === 'unavailable') return { kind: 'warning' as const, text: validation.message ?? 'Validation unavailable.' };
    if (validation.status === 'error') return { kind: 'error' as const, text: validation.message ?? 'Validation failed.' };
    const r = validation.result;
    if (!r) return null;
    if (r.solved) return { kind: 'success' as const, text: 'Verified solved: complete and rule-valid (checked by the backend).' };
    if (!r.valid) return { kind: 'error' as const, text: r.message };
    return { kind: 'info' as const, text: r.message };
  })();

  return (
    <Screen testID="play-screen">
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} accessibilityRole="header">{state.meta.name ?? (state.meta.source === 'sample' ? 'Assignment sample' : 'Puzzle')}</Text>
          <Text testID="mode-label" style={styles.sub}>{state.mode === 'setup' ? 'Setup: numbers you enter become clues' : 'Playing: clues are locked'}</Text>
        </View>
        <Button testID="toggle-mode" label={state.mode === 'setup' ? 'Start playing' : 'Edit clues'} variant="secondary"
          disabled={state.mode === 'setup' && blank} onPress={() => dispatch({ type: state.mode === 'setup' ? 'startPlay' : 'editClues' })} />
      </View>

      {backend === 'down' && <Notice kind="warning" testID="offline-notice">Backend offline: you can still enter numbers, but validation, saving and uniqueness checks are unavailable.</Notice>}
      {busy && <Loading label={busy} />}
      {banner && <View testID="validation-banner"><Notice kind={banner.kind}>{banner.text}</Notice></View>}

      <SudokuBoard values={state.values} fixed={state.fixed} selected={state.selected} conflicts={conflicts} size={boardSize}
        onSelect={(cell) => dispatch({ type: 'select', cell })} />
      <Text style={styles.hint} testID="selection-hint">
        {state.selected ? `Selected row ${state.selected[0] + 1}, column ${state.selected[1] + 1}${selectedFixed ? ' (clue, locked)' : ''}` : 'Tap a cell to select it'}
      </Text>

      <NumberPad disabled={padDisabled} onDigit={(d) => dispatch({ type: 'input', digit: d })} onClear={() => dispatch({ type: 'clear' })} />

      <View style={styles.row}>
        <Button testID="undo" label="Undo" variant="secondary" disabled={!state.past.length} onPress={() => dispatch({ type: 'undo' })} />
        <Button testID="redo" label="Redo" variant="secondary" disabled={!state.future.length} onPress={() => dispatch({ type: 'redo' })} />
        <Button testID="reset" label="Reset" variant="secondary" onPress={confirmReset} />
      </View>

      {notice && <Notice kind={notice.kind} testID="notice">{notice.text}</Notice>}
      {uniq && <Card testID="uniqueness"><Text style={styles.cardText}>{uniquenessText(uniq)}</Text></Card>}

      <SectionTitle>Puzzle</SectionTitle>
      <View style={styles.grid}>
        <Button testID="validate" label="Validate" onPress={doValidate} />
        <Button testID="check-unique" label="Check uniqueness" variant="secondary" disabled={blank} onPress={doUniqueness} />
        <Button testID="load-sample" label="Load sample" variant="secondary" onPress={() => { dispatch({ type: 'load', board: SAMPLE_PUZZLE, meta: { name: 'Assignment sample', source: 'sample' } }); setNotice({ kind: 'info', text: 'Sample puzzle loaded.' }); }} />
        <Button testID="generate" label="Generate" variant="secondary" onPress={doGenerate} />
        <Button testID="clear-board" label="Clear board" variant="secondary" onPress={confirmClear} />
        <Button testID="save" label="Save" variant="secondary" onPress={doSave} />
        <Button testID="load-saved" label="Load saved" variant="secondary" onPress={openLoad} />
        <Button testID="solve-ai" label="Solve with AI" disabled={blank || backend === 'down'} hint="Choose CoT, ToT or Multi-Agent" onPress={() => setSolveOpen(true)} />
      </View>
      <Text style={styles.sub}>Solving uses the puzzle's clues{state.meta.puzzleId && !state.dirty ? ' (the saved puzzle)' : ''}; your own entries are not sent.</Text>
      <SolveModeModal visible={solveOpen} onClose={() => setSolveOpen(false)} puzzleId={state.meta.puzzleId && !state.dirty ? state.meta.puzzleId : null}
        board={state.values.map((row, r) => row.map((v, c) => (state.fixed[r][c] ? v : 0)))} />

      <Modal visible={loadOpen} transparent animationType="slide" onRequestClose={() => setLoadOpen(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modal} testID="load-modal">
            <Text style={styles.title}>Saved puzzles</Text>
            {saved === null && !savedError && <Loading label="Loading…" />}
            {savedError && <Notice kind="error" testID="load-error">Could not load saved puzzles: {savedError}</Notice>}
            {saved?.length === 0 && <EmptyState title="Nothing saved yet" body="Save a puzzle and it will show up here." />}
            {saved?.map((s) => (
              <Pressable key={s.session_id} testID={`load-${s.session_id}`} accessibilityRole="button" style={styles.savedRow}
                onPress={() => { dispatch({ type: 'load', board: s.board, meta: { puzzleId: s.puzzle_id, sessionId: s.session_id, name: s.title, source: 'saved' } }); setLoadOpen(false); setNotice({ kind: 'success', text: 'Puzzle loaded.' }); }}>
                <Text style={styles.cardText}>{s.title ?? 'Untitled puzzle'} · {s.board.flat().filter((v) => v).length} clues</Text>
                <Text style={styles.sub}>{new Date(s.updated_at).toLocaleString()}</Text>
              </Pressable>
            ))}
            <Button testID="load-close" label="Close" variant="secondary" onPress={() => setLoadOpen(false)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: fontSize.xs },
  hint: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'center' },
  row: { flexDirection: 'row', gap: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cardText: { color: colors.text, fontSize: fontSize.md },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.md, maxHeight: '80%' },
  savedRow: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md, minHeight: 56, justifyContent: 'center' },
});
