import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert, Dimensions, StyleSheet } from 'react-native';
import PlayScreen from '@/screens/PlayScreen';
import { BACKEND_UP, SAMPLE, SESSION, SOLVED, renderWithBackend, res, validateHandler } from './helpers';

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
}));

const routes = (extra: Record<string, any> = {}) => ({ ...BACKEND_UP, 'POST /api/puzzles/validate': validateHandler, ...extra });
const press = async (id: string) => { await fireEvent.press(screen.getByTestId(id)); };
const pick = async (r: number, c: number) => { await press(`cell-${r}-${c}`); };
const text = (r: number, c: number) => screen.queryByTestId(`cell-text-${r}-${c}`)?.props.children;
const loadSample = async () => { await press('load-sample'); };

beforeEach(() => { mockParams = {}; jest.restoreAllMocks(); });

describe('Play: board entry and clearing', () => {
  it('enters numbers with the pad and clears them', async () => {
    await renderWithBackend(<PlayScreen />, routes());
    await pick(0, 0);
    await press('pad-3');
    expect(text(0, 0)).toBe(3);
    await press('pad-clear');
    expect(text(0, 0)).toBeUndefined();
  });

  it('disables the pad until a cell is selected and shows what is selected', async () => {
    await renderWithBackend(<PlayScreen />, routes());
    expect(screen.getByTestId('pad-1').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId('selection-hint').props.children).toMatch(/Tap a cell/);
    await pick(2, 1);
    expect(screen.getByTestId('pad-1').props.accessibilityState.disabled).toBe(false);
    expect(screen.getByTestId('selection-hint').props.children).toMatch(/row 3, column 2/);
  });

  it('accepts only digits 1-4 (the pad offers nothing else)', async () => {
    await renderWithBackend(<PlayScreen />, routes());
    expect(screen.queryByTestId('pad-5')).toBeNull();
    expect(screen.queryByTestId('pad-0')).toBeNull();
  });

  it('setup mode: entered numbers are clues; after Start playing they are locked and user entries differ', async () => {
    await renderWithBackend(<PlayScreen />, routes());
    expect(screen.getByTestId('toggle-mode').props.accessibilityState.disabled).toBe(true);   // blank board cannot start
    await pick(0, 0); await press('pad-1');
    expect(StyleSheet.flatten(screen.getByTestId('cell-text-0-0').props.style).fontWeight).toBe('800');
    await press('toggle-mode');
    expect(screen.getByTestId('mode-label').props.children).toMatch(/Playing/);
    await pick(0, 0);
    expect(screen.getByTestId('pad-2').props.accessibilityState.disabled).toBe(true);        // locked
    await pick(0, 1); await press('pad-2');
    expect(StyleSheet.flatten(screen.getByTestId('cell-text-0-1').props.style).fontWeight).toBe('500');   // user value
  });

  it('loading the sample locks its clues and allows editing only empty cells', async () => {
    await renderWithBackend(<PlayScreen />, routes());
    await loadSample();
    expect(text(0, 2)).toBe(3);
    await pick(0, 2);
    expect(screen.getByTestId('selection-hint').props.children).toMatch(/clue, locked/);
    expect(screen.getByTestId('pad-1').props.accessibilityState.disabled).toBe(true);
    await pick(0, 0); await press('pad-1');
    expect(text(0, 0)).toBe(1);
  });

  it('undo and redo', async () => {
    await renderWithBackend(<PlayScreen />, routes());
    await pick(0, 0); await press('pad-2'); await press('pad-4');
    expect(text(0, 0)).toBe(4);
    await press('undo');
    expect(text(0, 0)).toBe(2);
    await press('redo');
    expect(text(0, 0)).toBe(4);
    await press('undo'); await press('undo');
    expect(text(0, 0)).toBeUndefined();
    expect(screen.getByTestId('undo').props.accessibilityState.disabled).toBe(true);
  });
});

describe('Play: invalid cell feedback comes from the backend', () => {
  it('highlights duplicates reported by the validate endpoint and explains them', async () => {
    const be = await renderWithBackend(<PlayScreen />, routes());
    await pick(0, 0); await press('pad-1');
    await pick(0, 1); await press('pad-1');
    await waitFor(() => expect(screen.getByTestId('cell-0-0').props.accessibilityLabel).toContain('conflicts with another cell'));
    expect(screen.getByTestId('cell-0-1').props.accessibilityLabel).toContain('conflicts with another cell');
    expect(screen.getByTestId('cell-0-2').props.accessibilityLabel).not.toContain('conflicts');
    expect(screen.getByTestId('validation-banner')).toBeTruthy();
    expect(screen.getByText(/duplicate\(s\) found/)).toBeTruthy();
    expect(be.be.state.calls).toContain('POST /api/puzzles/validate');
    await press('undo');
    await waitFor(() => expect(screen.getByTestId('cell-0-0').props.accessibilityLabel).not.toContain('conflicts'));
  });

  it('sends the current board to the backend exactly as typed (0 = empty)', async () => {
    const seen: number[][][] = [];
    await renderWithBackend(<PlayScreen />, routes({ 'POST /api/puzzles/validate': (b: any) => { seen.push(b.board); return validateHandler(b); } }));
    await pick(3, 3); await press('pad-4');
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[seen.length - 1]).toEqual([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 4]]);
  });

  it('never calls a complete grid solved on its own: only the backend verdict does', async () => {
    await renderWithBackend(<PlayScreen />, routes({ 'POST /api/puzzles/validate': () => res(200, { valid: true, complete: true, solved: false, empties: 0, conflicts: [], message: 'complete but not verified' }) }));
    await loadSample();
    // fill the remaining cells with the true solution; the (stubbed) backend still says solved:false
    const fill: [number, number, number][] = [[0, 0, 1], [0, 1, 2], [1, 2, 1], [1, 3, 2], [2, 0, 2], [2, 3, 3], [3, 1, 3], [3, 2, 2]];
    for (const [r, c, v] of fill) { await pick(r, c); await press(`pad-${v}`); }
    await waitFor(() => expect(screen.getByText('complete but not verified')).toBeTruthy());
    expect(screen.queryByText(/Verified solved/i)).toBeNull();
  });

  it('shows "Verified solved" only when the backend confirms it', async () => {
    await renderWithBackend(<PlayScreen />, routes({ 'POST /api/puzzles/validate': () => res(200, { valid: true, complete: true, solved: true, empties: 0, conflicts: [], message: 'ok' }) }));
    await loadSample();
    await pick(0, 0); await press('pad-1');
    await waitFor(() => expect(screen.getByText(/Verified solved: complete and rule-valid/)).toBeTruthy());
  });
});

describe('Play: backend disconnected', () => {
  it('still lets the user enter numbers, says validation is unavailable and never invents conflicts', async () => {
    await renderWithBackend(<PlayScreen />, routes(), { down: true });
    await waitFor(() => expect(screen.getByTestId('offline-notice')).toBeTruthy());
    await pick(0, 0); await press('pad-1'); await pick(0, 1); await press('pad-1');
    expect(text(0, 0)).toBe(1);
    expect(text(0, 1)).toBe(1);
    await waitFor(() => expect(screen.getByText(/Validation needs the backend/)).toBeTruthy());
    expect(screen.getByTestId('cell-0-0').props.accessibilityLabel).not.toContain('conflicts');   // no client-side rules
  });

  it('save, uniqueness and generate explain the failure instead of crashing', async () => {
    await renderWithBackend(<PlayScreen />, routes(), { down: true });
    await loadSample();
    await press('save');
    await waitFor(() => expect(screen.getByTestId('notice')).toHaveTextContent(/Could not save: The backend is not reachable/));
    await press('check-unique');
    await waitFor(() => expect(screen.getByText(/Uniqueness check unavailable/)).toBeTruthy());
    await press('generate');
    await waitFor(() => expect(screen.getByText(/Could not generate/)).toBeTruthy());
    expect(screen.getByTestId('play-screen')).toBeTruthy();
  });

  it('shows the server error (not a stack trace) when the backend rejects a request', async () => {
    await renderWithBackend(<PlayScreen />, routes({ 'POST /api/puzzles': () => res(500, { error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred.', recoverable: false, retryable: true, details: {} } }) }));
    await loadSample();
    await press('save');
    await waitFor(() => expect(screen.getByText(/Could not save: An internal error occurred\./)).toBeTruthy());
  });
});

describe('Play: validate, uniqueness, reset, save, load', () => {
  it('Validate reports the backend message', async () => {
    await renderWithBackend(<PlayScreen />, routes());
    await loadSample();
    await press('validate');
    await waitFor(() => expect(screen.getByTestId('notice')).toHaveTextContent(/No rule violations so far; 8 empty/));
  });

  it('Check uniqueness shows none / unique / multiple from count-solutions', async () => {
    for (const [cls, expected] of [['unique', /one solution: the puzzle is unique/], ['multiple', /not unique/], ['none', /No solution exists/]] as const) {
      const { unmount } = await renderWithBackend(<PlayScreen />, routes({ 'POST /api/puzzles/count-solutions': () => res(200, { count: cls === 'none' ? 0 : cls === 'unique' ? 1 : 2, limit: 2, classification: cls, solvable: cls !== 'none', unique: cls === 'unique' }) }));
      await loadSample();
      await press('check-unique');
      await waitFor(() => expect(screen.getByTestId('uniqueness')).toBeTruthy());
      expect(screen.getByText(expected)).toBeTruthy();
      await unmount();
    }
  });

  it('Reset asks for confirmation; Cancel keeps entries, Reset removes only user entries', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithBackend(<PlayScreen />, routes());
    await loadSample();
    await pick(0, 0); await press('pad-1');
    await press('reset');
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe('Reset puzzle?');
    expect(text(0, 0)).toBe(1);                                    // nothing changed yet
    const buttons = alert.mock.calls[0][2]!;
    buttons.find((b) => b.style === 'cancel')!.onPress?.();
    expect(text(0, 0)).toBe(1);
    await act(async () => { buttons.find((b) => b.text === 'Reset')!.onPress?.(); });
    expect(text(0, 0)).toBeUndefined();
    expect(text(0, 2)).toBe(3);                                    // clues remain
  });

  it('Clear board also confirms when there is something to lose', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithBackend(<PlayScreen />, routes());
    await loadSample();
    await press('clear-board');
    expect(alert.mock.calls[0][0]).toBe('Clear the board?');
    await act(async () => { alert.mock.calls[0][2]!.find((b) => b.text === 'Clear board')!.onPress?.(); });
    expect(text(0, 2)).toBeUndefined();
  });

  it('Save sends the puzzle clues (not in-progress entries) and reports the new ID', async () => {
    let sent: any;
    await renderWithBackend(<PlayScreen />, routes({ 'POST /api/puzzles': (b: any) => { sent = b; return res(201, { puzzle_id: 'puzzle-new', session_id: 'session-new', name: null, board: b.board, source: b.source, created_at: 'x', solution_count: 1, unique: true, solvable: true, generation: null }); } }));
    await loadSample();
    await pick(0, 0); await press('pad-1');
    await press('save');
    await waitFor(() => expect(screen.getByText(/Saved puzzle puzzle-new/)).toBeTruthy());
    expect(sent.board).toEqual(SAMPLE);                           // the user's "1" is not saved as a clue
    expect(sent.source).toBe('sample');
  });

  it('Save refuses an empty board', async () => {
    await renderWithBackend(<PlayScreen />, routes());
    await press('save');
    expect(screen.getByText('Nothing to save yet.')).toBeTruthy();
  });

  it('Load saved lists backend sessions and loads one as locked clues', async () => {
    await renderWithBackend(<PlayScreen />, routes({ 'GET /api/history': { total: 1, limit: 30, offset: 0, sessions: [SESSION] } }));
    await press('load-saved');
    await waitFor(() => expect(screen.getByTestId(`load-${SESSION.session_id}`)).toBeTruthy());
    await press(`load-${SESSION.session_id}`);
    expect(text(0, 2)).toBe(3);
    await pick(0, 2);
    expect(screen.getByTestId('selection-hint').props.children).toMatch(/clue, locked/);
  });

  it('Load saved shows an empty state and an error state', async () => {
    const a = await renderWithBackend(<PlayScreen />, routes({ 'GET /api/history': { total: 0, limit: 30, offset: 0, sessions: [] } }));
    await press('load-saved');
    await waitFor(() => expect(screen.getByText('Nothing saved yet')).toBeTruthy());
    await a.unmount();
    await renderWithBackend(<PlayScreen />, routes(), { down: true });
    await press('load-saved');
    await waitFor(() => expect(screen.getByTestId('load-error')).toBeTruthy());
  });

  it('Generate loads a backend-verified puzzle', async () => {
    const gen = { puzzle_id: 'p', session_id: 's', name: null, board: [[3, 0, 1, 0], [0, 0, 2, 0], [0, 3, 0, 0], [1, 0, 0, 0]], source: 'generated', created_at: 'x', solution_count: 1, unique: true, solvable: true, generation: {} };
    await renderWithBackend(<PlayScreen />, routes({ 'POST /api/puzzles/generate': gen }));
    await press('generate');
    await waitFor(() => expect(text(0, 0)).toBe(3));
    expect(screen.getByText(/verified solvable with a unique solution/)).toBeTruthy();
  });

  it('opens a saved session passed as a route parameter (session reopen)', async () => {
    mockParams = { puzzleId: 'puzzle-aaa', t: '1' };
    await renderWithBackend(<PlayScreen />, routes({ 'GET /api/puzzles/puzzle-aaa': { puzzle_id: 'puzzle-aaa', session_id: 'session-aaa', name: 'sample', board: SAMPLE, source: 'user', created_at: 'x', solution_count: 1, unique: true, solvable: true, generation: null } }));
    await waitFor(() => expect(text(0, 2)).toBe(3));
    expect(screen.getByText(/opened from your saved sessions/)).toBeTruthy();
    expect(screen.getByText('sample')).toBeTruthy();
  });

  it('start-new parameter clears the board', async () => {
    mockParams = { new: '1', t: '1' };
    await renderWithBackend(<PlayScreen />, routes());
    await waitFor(() => expect(screen.getByText(/New puzzle: enter the clues/)).toBeTruthy());
  });

  it('the AI solve button is visibly disabled until the solver phase', async () => {
    await renderWithBackend(<PlayScreen />, routes());
    expect(screen.getByTestId('solve-ai').props.accessibilityState.disabled).toBe(true);
  });
});

describe('Play: small screens', () => {
  it('keeps the board inside a 320 dp wide screen', async () => {
    Dimensions.set({ window: { width: 320, height: 640, scale: 2, fontScale: 1 }, screen: { width: 320, height: 640, scale: 2, fontScale: 1 } });
    await renderWithBackend(<PlayScreen />, routes());
    const w = StyleSheet.flatten(screen.getByTestId('sudoku-board').props.style).width as number;
    expect(w).toBeLessThanOrEqual(320 - 32);
    expect(w).toBeGreaterThanOrEqual(240);
    Dimensions.set({ window: { width: 400, height: 800, scale: 2, fontScale: 1 }, screen: { width: 400, height: 800, scale: 2, fontScale: 1 } });
  });
});
