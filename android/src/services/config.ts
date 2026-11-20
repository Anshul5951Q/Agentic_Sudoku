/**
 * Where the API lives. Resolution order (first match wins):
 *  1. a base URL saved in Settings
 *  2. EXPO_PUBLIC_API_BASE_URL (build/dev environment)
 *  3. the Expo dev-server host (so a physical phone on the same network finds the computer automatically)
 *  4. the Android emulator's alias for the host machine
 * No developer LAN address is ever written into source.
 */
export const EMULATOR_HOST_ALIAS = '10.0.2.2'; // standard Android-emulator alias for the host machine, not a LAN address
export const DEFAULT_PORT = '8000';

export type UrlSource = 'settings' | 'env' | 'expo-dev-host' | 'emulator-default' | 'local-default';

export interface ResolveInput {
  override?: string | null;
  env?: string | null;
  envPort?: string | null;
  hostUri?: string | null; // e.g. "192.168.1.20:8081" from the Expo dev server
  platform: string;
}

export interface ResolvedUrl {
  url: string;
  source: UrlSource;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function normalizeBaseUrl(input: string): string | null {
  const t = (input ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/:?#]+(:\d{1,5})?$/i.test(t)) return null;
  return t;
}

export function resolveBaseUrl({ override, env, envPort, hostUri, platform }: ResolveInput): ResolvedUrl {
  const port = (envPort && /^\d{1,5}$/.test(envPort) ? envPort : DEFAULT_PORT) as string;
  const o = override ? normalizeBaseUrl(override) : null;
  if (o) return { url: o, source: 'settings' };
  const e = env ? normalizeBaseUrl(env) : null;
  if (e) return { url: e, source: 'env' };
  if (hostUri) {
    const host = hostUri.replace(/^[a-z]+:\/\//i, '').split('/')[0].split(':')[0];
    if (host) {
      if (LOOPBACK.has(host)) {
        // "localhost" on an Android device/emulator is the device itself, not the computer.
        if (platform === 'android') return { url: `http://${EMULATOR_HOST_ALIAS}:${port}`, source: 'emulator-default' };
        return { url: `http://localhost:${port}`, source: 'local-default' };
      }
      return { url: `http://${host}:${port}`, source: 'expo-dev-host' };
    }
  }
  if (platform === 'android') return { url: `http://${EMULATOR_HOST_ALIAS}:${port}`, source: 'emulator-default' };
  return { url: `http://localhost:${port}`, source: 'local-default' };
}
