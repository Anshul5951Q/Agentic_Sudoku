import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text, TextInput, View } from 'react-native';
import SettingsScreen from '@/screens/SettingsScreen';
import { useConnection } from '@/state/ConnectionContext';
import { BACKEND_UP, RUNTIME_OK, renderWithBackend } from './helpers';

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
