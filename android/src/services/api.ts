import type {
  AnalyticsSummary, Board, Health, Puzzle, PuzzleValidation, RuntimeStatus, SessionList, SolutionCount,
} from '@/types/api';
import type { ApiClient } from './apiClient';

/** Thin typed wrappers over the backend endpoints used by the app. All Sudoku logic stays on the server. */
export function createApi(client: ApiClient) {
  return {
    health: () => client.get<Health>('/api/health', { timeoutMs: 4000 }),
    runtimeStatus: () => client.get<RuntimeStatus>('/api/runtime/status', { timeoutMs: 6000 }),
    analyticsSummary: () => client.get<AnalyticsSummary>('/api/analytics/summary'),
    history: (limit = 20) => client.get<SessionList>(`/api/history?limit=${limit}`),
    getPuzzle: (id: string) => client.get<Puzzle>(`/api/puzzles/${encodeURIComponent(id)}`),
    createPuzzle: (board: Board, name?: string, source: 'user' | 'sample' | 'generated' = 'user') =>
      client.post<Puzzle>('/api/puzzles', { board, name: name ?? null, source }),
    validate: (board: Board, signal?: AbortSignal) => client.post<PuzzleValidation>('/api/puzzles/validate', { board }, { signal }),
    countSolutions: (board: Board) => client.post<SolutionCount>('/api/puzzles/count-solutions', { board }),
    generate: (clues: number) => client.post<Puzzle>('/api/puzzles/generate', { clues, save: false }),
  };
}

export type Api = ReturnType<typeof createApi>;
