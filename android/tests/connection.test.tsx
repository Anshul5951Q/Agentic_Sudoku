import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text, TextInput, View } from 'react-native';
import SettingsScreen from '@/screens/SettingsScreen';
import { ConnectionProvider, useConnection } from '@/state/ConnectionContext';
import { BACKEND_UP, RUNTIME_OK, renderWithBackend, res } from './helpers';

function Probe() {
  const c = useConnection();
  return <View><Text testID="b">{c.backend}</Text><Text testID="o">{c.ollama}</Text><Text testID="u">{c.baseUrl}|{c.urlSource}</Text></View>;
}

describe('connection state', () => {
  it('backend up + Ollama up', async () => {
    await renderWithBackend(<Probe />, BACKEND_UP);
    await waitFor(() => expect(screen.getByTestId('b')).toHaveTextContent('up'));
    await waitFor(() => expect(screen.getByTestId('o')).toHaveTextContent('up'));
  });
  it('backend unreachable makes Ollama "unknown", never "down"', async () => {
    await renderWithBackend(<Probe />, BACKEND_UP, { down: true });
    await waitFor(() => expect(screen.getByTestId('b')).toHaveTextContent('down'));
    expect(screen.getByTestId('o')).toHaveTextContent('unknown');
  });
  it('a failing runtime endpoint leaves the backend up but Ollama unknown', async () => {
    await renderWithBackend(<Probe />, { 'GET /api/health': BACKEND_UP['GET /api/health'] });
    await waitFor(() => expect(screen.getByTestId('b')).toHaveTextContent('up'));
    await waitFor(() => expect(screen.getByTestId('o')).toHaveTextContent('unknown'));
  });
  it('uses the configured base URL and reports where it came from', async () => {
    await renderWithBackend(<Probe />, BACKEND_UP);
    expect(screen.getByTestId('u')).toHaveTextContent('http://test-host:8000|env');
  });
});

describe('Settings', () => {
  it('shows runtime and model status from the backend', async () => {
    await renderWithBackend(<SettingsScreen />, BACKEND_UP);
    await waitFor(() => expect(screen.getByText(/nomic-embed-text: installed/)).toBeTruthy());
    expect(screen.getByText(/Vector store: up/)).toBeTruthy();
  });
  it('lists a missing model with its remedy', async () => {
    const rt = { ...RUNTIME_OK, models: [RUNTIME_OK.models[0], { name: 'nomic-embed-text', status: 'down', detail: 'not installed (run: ollama pull nomic-embed-text)' }] };
    await renderWithBackend(<SettingsScreen />, { ...BACKEND_UP, 'GET /api/runtime/status': rt });
    await waitFor(() => expect(screen.getByText(/nomic-embed-text: missing \(not installed \(run: ollama pull/)).toBeTruthy());
  });
  it('rejects a malformed address and accepts a valid one', async () => {
    await renderWithBackend(<SettingsScreen />, BACKEND_UP);
    await fireEvent.changeText(screen.getByTestId('url-input'), 'not-a-url');
    await fireEvent.press(screen.getByTestId('url-save'));
    expect(screen.getByText(/Enter a full address/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('url-input'), 'http://my-computer:8000');
    await fireEvent.press(screen.getByTestId('url-save'));
    await waitFor(() => expect(screen.getByText('Backend address saved.')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('settings-url')).toHaveTextContent(/http:\/\/my-computer:8000/));
  });
  it('explains what is unavailable when the backend is down', async () => {
    await renderWithBackend(<SettingsScreen />, BACKEND_UP, { down: true });
    await waitFor(() => expect(screen.getByTestId('settings-backend')).toHaveTextContent(/unreachable/));
    expect(screen.getByText(/unavailable while it is unreachable/)).toBeTruthy();
  });
});

describe('emulator fallback', () => {
  const mk = (reachable: (url: string) => boolean) => jest.fn(async (url: string) => {
    if (!reachable(url)) throw new TypeError('Network request failed');
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    return path === '/api/health' ? res(200, BACKEND_UP['GET /api/health']) : res(200, RUNTIME_OK);
  });
  const view = async (f: any, hostUri: string | null, env: string | null = null) =>
    render(<ConnectionProvider pollMs={60000} fetchImpl={f} initial={{ override: null, env, hostUri, platform: 'android' }}><Probe /></ConnectionProvider>);

  it('switches to the emulator alias when the auto-derived Expo host is unreachable but the alias answers', async () => {
    const f = mk((u) => u.startsWith('http://10.0.2.2:8000'));
    await view(f, 'lan-host.local:8081');
    await waitFor(() => expect(screen.getByTestId('b')).toHaveTextContent('up'));
    expect(screen.getByTestId('u')).toHaveTextContent('http://10.0.2.2:8000|emulator-default');
  });
  it('keeps the derived host when it works', async () => {
    const f = mk((u) => u.startsWith('http://lan-host.local:8000'));
    await view(f, 'lan-host.local:8081');
    await waitFor(() => expect(screen.getByTestId('b')).toHaveTextContent('up'));
    expect(screen.getByTestId('u')).toHaveTextContent('http://lan-host.local:8000|expo-dev-host');
    expect(f.mock.calls.some(([u]) => String(u).includes('10.0.2.2'))).toBe(false);
  });
  it('reports unreachable (and keeps the derived address) when neither answers', async () => {
    await view(mk(() => false), 'lan-host.local:8081');
    await waitFor(() => expect(screen.getByTestId('b')).toHaveTextContent('down'));
    expect(screen.getByTestId('u')).toHaveTextContent('http://lan-host.local:8000|expo-dev-host');
  });
  it('never second-guesses an explicit env or saved address', async () => {
    const f = mk((u) => u.startsWith('http://10.0.2.2'));
    await view(f, 'lan-host.local:8081', 'http://configured:8000');
    await waitFor(() => expect(screen.getByTestId('b')).toHaveTextContent('down'));
    expect(f.mock.calls.some(([u]) => String(u).includes('10.0.2.2'))).toBe(false);
  });
});
