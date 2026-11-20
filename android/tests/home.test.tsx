import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';
import HomeScreen from '@/screens/HomeScreen';
import { BACKEND_UP, HEALTH, RUNTIME_OK, SESSION, SUMMARY, renderWithBackend, res } from './helpers';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
}));

const full = { ...BACKEND_UP, 'GET /api/analytics/summary': SUMMARY, 'GET /api/history': { total: 1, limit: 10, offset: 0, sessions: [SESSION] } };
const text = (id: string) => screen.getByTestId(id);
const stat = (id: string): string => screen.getByTestId(id).props.accessibilityLabel;
beforeEach(() => (router.push as jest.Mock).mockClear());

describe('Home: backend down (must still load)', () => {
  it('renders status, actions and an explanation, with no invented numbers', async () => {
    await renderWithBackend(<HomeScreen />, full, { down: true });
    await waitFor(() => expect(text('status-backend')).toHaveTextContent(/unreachable/));
    expect(text('status-app')).toHaveTextContent(/running/);
    expect(text('status-ollama')).toHaveTextContent(/unknown/);
    expect(text('status-ollama')).toHaveTextContent(/reported by the backend, which is unreachable/);
    expect(screen.getByTestId('backend-down-notice')).toBeTruthy();
    for (const id of ['stat-solved', 'stat-time', 'stat-nodes', 'stat-deadends', 'stat-sessions']) {
      expect(stat(id)).toMatch(/: —$/);
      expect(text(id)).toHaveTextContent(/backend unavailable/);
    }
    expect(screen.getByTestId('sessions-unavailable')).toBeTruthy();
    expect(screen.getByTestId('retry')).toBeTruthy();
  });

  it('can still start a new puzzle and open the AI Lab; Continue is disabled', async () => {
    await renderWithBackend(<HomeScreen />, full, { down: true });
    await waitFor(() => expect(text('status-backend')).toHaveTextContent(/unreachable/));
    await fireEvent.press(text('start-new'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/play', params: expect.objectContaining({ new: '1' }) });
    await fireEvent.press(text('open-lab'));
    expect(router.push).toHaveBeenCalledWith('/ai-lab');
    expect(text('continue').props.accessibilityState.disabled).toBe(true);
  });

  it('recovers after Retry when the backend comes back', async () => {
    const { be } = await renderWithBackend(<HomeScreen />, full, { down: true });
    await waitFor(() => expect(text('status-backend')).toHaveTextContent(/unreachable/));
    be.state.down = false;
    await fireEvent.press(text('retry'));
    await waitFor(() => expect(text('status-backend')).toHaveTextContent(/connected/));
    await waitFor(() => expect(stat('stat-solved')).toBe('Puzzles solved: 2'));
    expect(screen.queryByTestId('backend-down-notice')).toBeNull();
  });
});

describe('Home: backend up', () => {
  it('shows dashboard numbers computed by the backend', async () => {
    await renderWithBackend(<HomeScreen />, full);
    await waitFor(() => expect(stat('stat-solved')).toBe('Puzzles solved: 2'));
    expect(stat('stat-time')).toBe('Avg solve time: 12.3 ms');
    expect(stat('stat-nodes')).toBe('Search nodes explored: 53');
    expect(stat('stat-deadends')).toBe('Dead-end branches: 4');
    expect(stat('stat-sessions')).toBe('Sessions saved: 3');
    expect(text('status-backend')).toHaveTextContent(/connected/);
    expect(text('status-ollama')).toHaveTextContent(/connected/);
  });

  it('says "no verified runs yet" instead of showing a made-up average', async () => {
    await renderWithBackend(<HomeScreen />, { ...full, 'GET /api/analytics/summary': { ...SUMMARY, average_solve_seconds: null, puzzles_solved: 0, sessions_saved: 0 } });
    await waitFor(() => expect(text('stat-time')).toHaveTextContent(/no verified runs yet/));
    expect(stat('stat-time')).toBe('Avg solve time: —');
  });

  it('reports backend and Ollama separately: backend up, Ollama down', async () => {
    const rt = { ...RUNTIME_OK, ollama: { name: 'ollama', status: 'down', detail: 'The local Ollama service could not be reached.' }, ready_for_llm: false, ready_for_rag: false };
    await renderWithBackend(<HomeScreen />, { ...full, 'GET /api/runtime/status': rt });
    await waitFor(() => expect(text('status-ollama')).toHaveTextContent(/unreachable/));
    expect(text('status-backend')).toHaveTextContent(/connected/);
    expect(text('status-ollama')).toHaveTextContent(/could not be reached/);
    expect(screen.queryByTestId('backend-down-notice')).toBeNull();
  });

  it('flags a missing model as limited, naming it', async () => {
    const rt = { ...RUNTIME_OK, models: [RUNTIME_OK.models[0], { name: 'nomic-embed-text', status: 'down', detail: 'not installed' }], ready_for_rag: false };
    await renderWithBackend(<HomeScreen />, { ...full, 'GET /api/runtime/status': rt });
    await waitFor(() => expect(text('status-ollama')).toHaveTextContent(/limited/));
    expect(text('status-ollama')).toHaveTextContent(/nomic-embed-text/);
  });

  it('lists recent sessions and reopens the right puzzle (session reopen)', async () => {
    await renderWithBackend(<HomeScreen />, full);
    await waitFor(() => expect(text(`session-${SESSION.session_id}`)).toBeTruthy());
    expect(text(`session-${SESSION.session_id}`)).toHaveTextContent(/sample · 8 clues/);
    expect(text(`session-${SESSION.session_id}`)).toHaveTextContent(/last: tot solved/);
    await fireEvent.press(text(`session-${SESSION.session_id}`));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/play', params: expect.objectContaining({ puzzleId: 'puzzle-aaa', sessionId: 'session-aaa' }) });
  });

  it('Continue Previous Puzzle opens the most recent session', async () => {
    await renderWithBackend(<HomeScreen />, full);
    await waitFor(() => expect(text('continue').props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(text('continue'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/play', params: expect.objectContaining({ puzzleId: 'puzzle-aaa' }) });
  });

  it('shows an empty state when nothing is saved', async () => {
    await renderWithBackend(<HomeScreen />, { ...full, 'GET /api/history': { total: 0, limit: 10, offset: 0, sessions: [] }, 'GET /api/analytics/summary': { ...SUMMARY, sessions_saved: 0 } });
    await waitFor(() => expect(screen.getByTestId('no-sessions')).toBeTruthy());
    expect(text('continue').props.accessibilityState.disabled).toBe(true);
  });

  it('shows the backend error (not blank numbers) when a data call fails', async () => {
    await renderWithBackend(<HomeScreen />, { ...full, 'GET /api/analytics/summary': () => res(500, { error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred.', recoverable: false, retryable: true, details: {} } }) });
    await waitFor(() => expect(screen.getByTestId('home-error')).toHaveTextContent(/An internal error occurred\./));
    expect(stat('stat-solved')).toBe('Puzzles solved: —');
    expect(text('status-backend')).toHaveTextContent(/connected/);
  });

  it('keeps health/runtime separate from data endpoints', async () => {
    const { be } = await renderWithBackend(<HomeScreen />, full);
    await waitFor(() => expect(be.state.calls).toEqual(expect.arrayContaining(['GET /api/health', 'GET /api/runtime/status', 'GET /api/analytics/summary', 'GET /api/history'])));
    expect(HEALTH.status).toBe('ok');
  });
});
