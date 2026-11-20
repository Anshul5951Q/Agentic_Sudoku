import type { Board, Cell } from '@/types/api';

/**
 * Pure UI state for the Play screen: what the user has typed, which cells are fixed clues, selection and
 * undo/redo. It contains NO Sudoku rules: duplicate detection, validity and uniqueness come from the backend.
 */
export type Mode = 'setup' | 'play';
export type Source = 'blank' | 'sample' | 'saved' | 'generated';

export interface Snapshot {
  values: number[][];
  fixed: boolean[][];
}

export interface PuzzleMeta {
  puzzleId: string | null;
  sessionId: string | null;
  name: string | null;
  source: Source;
}

export interface PlayState extends Snapshot {
  selected: Cell | null;
  mode: Mode;
  past: Snapshot[];
  future: Snapshot[];
  initial: Snapshot;
  meta: PuzzleMeta;
  /** changes since the last save/load */
  dirty: boolean;
}

export type PlayAction =
  | { type: 'select'; cell: Cell | null }
  | { type: 'input'; digit: number }
  | { type: 'clear' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' }
  | { type: 'clearBoard' }
  | { type: 'startPlay' }
  | { type: 'editClues' }
  | { type: 'load'; board: Board; meta: Partial<PuzzleMeta>; mode?: Mode }
  | { type: 'saved'; puzzleId: string; sessionId: string };

const emptyGrid = <T,>(v: T): T[][] => Array.from({ length: 4 }, () => Array<T>(4).fill(v));
const copy = <T,>(g: T[][]): T[][] => g.map((r) => r.slice());
const snap = (s: Snapshot): Snapshot => ({ values: copy(s.values), fixed: copy(s.fixed) });
const BLANK_META: PuzzleMeta = { puzzleId: null, sessionId: null, name: null, source: 'blank' };
const MAX_HISTORY = 200;

export function initialPlayState(): PlayState {
  const blank = { values: emptyGrid(0), fixed: emptyGrid(false) };
  return { ...snap(blank), selected: null, mode: 'setup', past: [], future: [], initial: snap(blank), meta: { ...BLANK_META }, dirty: false };
}

function push(s: PlayState, next: Snapshot, extra: Partial<PlayState> = {}): PlayState {
  return { ...s, ...next, past: [...s.past, snap(s)].slice(-MAX_HISTORY), future: [], dirty: true, ...extra };
}

export function playReducer(s: PlayState, a: PlayAction): PlayState {
  switch (a.type) {
    case 'select':
      return { ...s, selected: a.cell };
    case 'input': {
      if (!s.selected || !Number.isInteger(a.digit) || a.digit < 1 || a.digit > 4) return s;
      const [r, c] = s.selected;
      if (s.mode === 'play' && s.fixed[r][c]) return s; // clues cannot be overwritten while playing
      if (s.values[r][c] === a.digit && (s.mode === 'play' || s.fixed[r][c])) return s;
      const next = snap(s);
      next.values[r][c] = a.digit;
      if (s.mode === 'setup') next.fixed[r][c] = true; // in setup mode everything typed is a clue
      return push(s, next);
    }
    case 'clear': {
      if (!s.selected) return s;
      const [r, c] = s.selected;
      if (s.values[r][c] === 0) return s;
      if (s.mode === 'play' && s.fixed[r][c]) return s;
      const next = snap(s);
      next.values[r][c] = 0;
      next.fixed[r][c] = false;
      return push(s, next);
    }
    case 'undo': {
      if (!s.past.length) return s;
      const prev = s.past[s.past.length - 1];
      return { ...s, ...snap(prev), past: s.past.slice(0, -1), future: [snap(s), ...s.future], dirty: true };
    }
    case 'redo': {
      if (!s.future.length) return s;
      const nxt = s.future[0];
      return { ...s, ...snap(nxt), past: [...s.past, snap(s)], future: s.future.slice(1), dirty: true };
    }
    case 'reset': {
      if (s.mode === 'setup') return { ...initialPlayState(), selected: s.selected, meta: { ...BLANK_META } };
      return { ...s, ...snap(s.initial), past: [], future: [], dirty: false };
    }
    case 'clearBoard':
      return { ...initialPlayState(), selected: s.selected };
    case 'startPlay': {
      const fixed = s.values.map((row) => row.map((v) => v !== 0));
      const start = { values: copy(s.values), fixed };
      return { ...s, ...start, mode: 'play', past: [], future: [], initial: snap(start) };
    }
    case 'editClues':
      return { ...s, mode: 'setup', fixed: s.values.map((row) => row.map((v) => v !== 0)), past: [], future: [] };
    case 'load': {
      const values = copy(a.board);
      const fixed = values.map((row) => row.map((v) => v !== 0));
      const mode = a.mode ?? 'play';
      const base = { values, fixed };
      return {
        ...snap(base), selected: null, mode, past: [], future: [], initial: snap(base), dirty: false,
        meta: { ...BLANK_META, ...a.meta },
      };
    }
    case 'saved':
      return { ...s, dirty: false, meta: { ...s.meta, puzzleId: a.puzzleId, sessionId: a.sessionId } };
    default:
      return s;
  }
}

/** The puzzle as plain numbers for the API. */
export const boardOf = (s: Snapshot): Board => copy(s.values);
export const isBlank = (s: Snapshot): boolean => s.values.every((r) => r.every((v) => v === 0));
