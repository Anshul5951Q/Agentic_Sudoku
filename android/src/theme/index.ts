/** Dark AI-dashboard theme with a violet accent, plus a separate high-contrast palette for the Sudoku board. */
export const colors = {
  bg: '#0B0B14',
  surface: '#14141F',
  surfaceAlt: '#1C1C2B',
  border: '#2A2A3D',
  text: '#F2F2F7',
  textMuted: '#A0A0B8',
  accent: '#8B5CF6',
  accentStrong: '#7C3AED',
  accentSoft: '#2A2147',
  success: '#22C55E',
  verified: '#34D399',
  warning: '#F59E0B',
  danger: '#EF4444',
  dangerSoft: '#3A1620',
  info: '#38BDF8',
} as const;

/** The board stays light and high-contrast so digits are readable at a glance. */
export const board = {
  background: '#FFFFFF',
  cellLine: '#9CA3AF',
  boxLine: '#111827',
  selected: '#C4B5FD',
  peer: '#EDE9FE',
  conflictBg: '#FECACA',
  conflictText: '#B91C1C',
  clueText: '#0B0B14',
  userText: '#6D28D9',
  emptyHint: '#E5E7EB',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const fontSize = { xs: 12, sm: 14, md: 16, lg: 20, xl: 28 } as const;
export const MIN_TOUCH = 48;

export const theme = { colors, board, spacing, radius, fontSize };
export type Theme = typeof theme;
