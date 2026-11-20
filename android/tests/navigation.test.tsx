import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { TABS } from '@/navigation/tabs';
import { BACKEND_UP, SESSION, SUMMARY, res } from './helpers';

/** The real app/ directory is rendered with the real root layout, tabs and screens against a fake backend. */
function installBackend(down: boolean) {
  (globalThis as any).fetch = jest.fn(async (url: string) => {
    if (down) throw new TypeError('Network request failed');
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const table: Record<string, unknown> = {
      '/api/health': BACKEND_UP['GET /api/health'], '/api/runtime/status': BACKEND_UP['GET /api/runtime/status'],
      '/api/analytics/summary': SUMMARY, '/api/history': { total: 1, limit: 10, offset: 0, sessions: [SESSION] },
    };
    return table[path] ? res(200, table[path]) : res(404, { error: { code: 'NOT_FOUND', message: 'nf', recoverable: true, retryable: false, details: {} } });
  });
}

describe('navigation', () => {
  it('defines exactly the five required tabs in order', () => {
    expect(TABS.map((t) => t.title)).toEqual(['Home', 'Play', 'AI Lab', 'Memory', 'Analytics']);
  });

  it('opens on Home and can reach every tab', async () => {
    installBackend(false);
    await renderRouter('./app', { initialUrl: '/' });
    expect(screen).toHavePathname('/');
    expect(screen.getByTestId('home-screen')).toBeTruthy();
    const expected: Record<string, [string, string]> = {
      play: ['/play', 'play-screen'], 'ai-lab': ['/ai-lab', 'ai-lab-screen'], memory: ['/memory', 'memory-screen'],
      analytics: ['/analytics', 'placeholder-analytics'], index: ['/', 'home-screen'],
    };
    for (const tab of ['play', 'ai-lab', 'memory', 'analytics', 'index']) {
      await fireEvent.press(screen.getByTestId(`tab-${tab}`));
      await waitFor(() => expect(screen).toHavePathname(expected[tab][0]));
      expect(screen.getByTestId(expected[tab][1])).toBeTruthy();
    }
  });

  it('reaches Settings from the header on any tab and shows the connection details', async () => {
    installBackend(false);
    await renderRouter('./app', { initialUrl: '/play' });
    await fireEvent.press(screen.getByTestId('open-settings'));
    await waitFor(() => expect(screen).toHavePathname('/settings'));
    expect(screen.getByTestId('settings-screen')).toBeTruthy();
    expect(screen.getByTestId('settings-url')).toHaveTextContent(/Address: http:\/\//);
    await waitFor(() => expect(screen.getByTestId('settings-backend')).toHaveTextContent(/connected/));
    await waitFor(() => expect(screen.getByText(/qwen2\.5:3b: installed/)).toBeTruthy());
  });

  it('shows separate API and LLM status in the header, and the app still renders with the backend down', async () => {
    installBackend(true);
    await renderRouter('./app', { initialUrl: '/' });
    expect(screen.getByTestId('home-screen')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('badge-backend').props.accessibilityLabel).toBe('API: unreachable'));
    expect(screen.getByTestId('badge-ollama').props.accessibilityLabel).toBe('LLM: unknown');
    await fireEvent.press(screen.getByTestId('tab-play'));
    await waitFor(() => expect(screen.getByTestId('play-screen')).toBeTruthy());
    expect(screen.getByTestId('offline-notice')).toBeTruthy();
  });

  it('placeholder screens are honest: they say they are not built and show no data', async () => {
    installBackend(false);
    await renderRouter('./app', { initialUrl: '/analytics' });
    expect(screen.getByText(/Analytics is coming in/)).toBeTruthy();
    expect(screen.getByText(/nothing is shown here/)).toBeTruthy();
  });
});
