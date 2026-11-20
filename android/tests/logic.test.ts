import { ApiClient, ApiClientError } from '@/services/apiClient';
import { normalizeBaseUrl, resolveBaseUrl } from '@/services/config';
import { boardOf, initialPlayState, isBlank, playReducer, type PlayAction, type PlayState } from '@/state/playReducer';
import { res } from './helpers';

describe('base URL resolution (never hardcoded)', () => {
  it('prefers the saved override, then env, then the Expo dev host', () => {
    expect(resolveBaseUrl({ override: 'http://saved:9000/', env: 'http://env:8000', hostUri: 'h:8081', platform: 'android' })).toEqual({ url: 'http://saved:9000', source: 'settings' });
    expect(resolveBaseUrl({ env: 'http://env:8000', hostUri: 'h:8081', platform: 'android' })).toEqual({ url: 'http://env:8000', source: 'env' });
    expect(resolveBaseUrl({ hostUri: 'my-computer.local:8081', platform: 'android' })).toEqual({ url: 'http://my-computer.local:8000', source: 'expo-dev-host' });
  });
  it('uses the emulator alias when nothing else applies, and for loopback dev hosts on Android', () => {
    expect(resolveBaseUrl({ platform: 'android' })).toEqual({ url: 'http://10.0.2.2:8000', source: 'emulator-default' });
    expect(resolveBaseUrl({ hostUri: 'localhost:8081', platform: 'android' }).url).toBe('http://10.0.2.2:8000');
    expect(resolveBaseUrl({ platform: 'web' })).toEqual({ url: 'http://localhost:8000', source: 'local-default' });
  });
  it('honours a configured port and ignores invalid inputs', () => {
    expect(resolveBaseUrl({ hostUri: 'box:8081', envPort: '9100', platform: 'android' }).url).toBe('http://box:9100');
    expect(resolveBaseUrl({ override: 'not a url', env: 'ftp://x', platform: 'android' }).source).toBe('emulator-default');
    expect(normalizeBaseUrl('http://a:8000/')).toBe('http://a:8000');
    expect(normalizeBaseUrl('http://a:8000/path')).toBeNull();
    expect(normalizeBaseUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('ApiClient', () => {
  const client = (f: any, timeout = 50) => new ApiClient(() => 'http://t:8000', f, timeout);
  it('parses the backend error envelope', async () => {
    const f = jest.fn(async () => res(404, { error: { code: 'RUN_NOT_FOUND', message: 'nope', recoverable: true, retryable: false, details: {} } }));
    await expect(client(f).get('/x')).rejects.toMatchObject({ kind: 'http', status: 404, code: 'RUN_NOT_FOUND', message: 'nope', unreachable: false });
  });
  it('turns network failures into an unreachable error without leaking details', async () => {
    const e: any = await client(async () => { throw new TypeError('connect ECONNREFUSED 10.1.2.3:8000'); }).get('/x').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiClientError);
    expect(e).toMatchObject({ kind: 'network', unreachable: true });
    expect(e.message).not.toMatch(/ECONNREFUSED|10\.1\.2\.3/);
  });
  it('times out', async () => {
    const slow = (_u: string, init: any) => new Promise<Response>((_r, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    await expect(client(slow, 20).get('/x')).rejects.toMatchObject({ kind: 'timeout', unreachable: true });
  });
  it('handles non-JSON error bodies and sends JSON bodies', async () => {
    const f = jest.fn(async () => ({ ok: false, status: 502, text: async () => '<html>bad gateway</html>' }) as any);
    await expect(client(f).get('/x')).rejects.toMatchObject({ kind: 'http', status: 502, retryable: true });
    const g = jest.fn(async () => res(200, { ok: 1 }));
    await client(g).post('/p', { board: [[0]] });
    expect(g).toHaveBeenCalledWith('http://t:8000/p', expect.objectContaining({ method: 'POST', body: JSON.stringify({ board: [[0]] }) }));
  });
});

describe('play reducer (UI state only)', () => {
  const run = (actions: PlayAction[], from: PlayState = initialPlayState()) => actions.reduce(playReducer, from);
  const sel = (r: number, c: number): PlayAction => ({ type: 'select', cell: [r, c] });

  it('starts blank in setup mode and ignores input without a selection or with a bad digit', () => {
    const s = initialPlayState();
    expect(isBlank(s) && s.mode === 'setup').toBe(true);
    expect(playReducer(s, { type: 'input', digit: 3 })).toBe(s);
    const picked = run([sel(0, 0)]);
    expect(playReducer(picked, { type: 'input', digit: 5 })).toBe(picked);
    expect(playReducer(picked, { type: 'input', digit: 0 })).toBe(picked);
  });
  it('in setup mode typed numbers become clues; clear removes them', () => {
    const s = run([sel(0, 2), { type: 'input', digit: 3 }]);
    expect(s.values[0][2]).toBe(3);
    expect(s.fixed[0][2]).toBe(true);
    const c = run([{ type: 'clear' }], s);
    expect(c.values[0][2]).toBe(0);
    expect(c.fixed[0][2]).toBe(false);
  });
  it('loads a puzzle with clues locked in play mode; clues cannot be overwritten or cleared', () => {
    const s = run([{ type: 'load', board: [[0, 0, 3, 4], [3, 4, 0, 0], [0, 1, 4, 0], [4, 0, 0, 1]], meta: { source: 'sample' } }, sel(0, 2)]);
    expect(s.mode).toBe('play');
    expect(s.fixed[0][2]).toBe(true);
    expect(playReducer(s, { type: 'input', digit: 1 })).toBe(s);
    expect(playReducer(s, { type: 'clear' })).toBe(s);
    const u = run([sel(0, 0), { type: 'input', digit: 1 }], s);
    expect(u.values[0][0]).toBe(1);
    expect(u.fixed[0][0]).toBe(false);
  });
  it('undo and redo walk the history and redo is dropped by a new edit', () => {
    let s = run([sel(0, 0), { type: 'input', digit: 1 }, { type: 'input', digit: 2 }, { type: 'input', digit: 3 }]);
    expect(s.values[0][0]).toBe(3);
    s = run([{ type: 'undo' }, { type: 'undo' }], s);
    expect(s.values[0][0]).toBe(1);
    s = run([{ type: 'redo' }], s);
    expect(s.values[0][0]).toBe(2);
    s = run([{ type: 'input', digit: 4 }], s);
    expect(s.future).toHaveLength(0);
    expect(playReducer(initialPlayState(), { type: 'undo' }).past).toHaveLength(0);
  });
  it('reset in play mode removes user entries but keeps clues, and clears history', () => {
    let s = run([{ type: 'load', board: [[0, 2, 3, 4], [3, 4, 0, 0], [0, 1, 4, 0], [4, 0, 0, 1]], meta: {} }, sel(0, 0), { type: 'input', digit: 1 }]);
    expect(s.values[0][0]).toBe(1);
    s = run([{ type: 'reset' }], s);
    expect(s.values[0][0]).toBe(0);
    expect(s.values[0][1]).toBe(2);
    expect(s.past).toHaveLength(0);
  });
  it('startPlay locks what was entered; editClues unlocks to setup', () => {
    let s = run([sel(1, 1), { type: 'input', digit: 2 }, { type: 'startPlay' }]);
    expect(s.mode).toBe('play');
    expect(s.fixed[1][1]).toBe(true);
    s = run([{ type: 'editClues' }], s);
    expect(s.mode).toBe('setup');
  });
  it('boardOf returns a copy that never aliases state', () => {
    const s = run([sel(0, 0), { type: 'input', digit: 2 }]);
    const b = boardOf(s);
    b[0][0] = 4;
    expect(s.values[0][0]).toBe(2);
  });
});
