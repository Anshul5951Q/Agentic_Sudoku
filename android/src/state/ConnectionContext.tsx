import Constants from 'expo-constants';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { createApi, type Api } from '@/services/api';
import { ApiClient, type FetchLike } from '@/services/apiClient';
import { normalizeBaseUrl, resolveBaseUrl, type UrlSource } from '@/services/config';
import { loadBaseUrlOverride, saveBaseUrlOverride } from '@/services/storage';
import type { RuntimeStatus } from '@/types/api';

/** 'unknown' = cannot be determined because the backend (which reports Ollama's status) is unreachable. */
export type Level = 'checking' | 'up' | 'degraded' | 'down' | 'unknown';

export interface ConnectionValue {
  backend: Level;
  ollama: Level;
  runtime: RuntimeStatus | null;
  baseUrl: string;
  urlSource: UrlSource;
  lastChecked: number | null;
  api: Api;
  refresh: () => Promise<void>;
  setBaseUrlOverride: (value: string | null) => Promise<boolean>;
}

const Ctx = createContext<ConnectionValue | null>(null);

export function ollamaLevel(rt: RuntimeStatus): Level {
  if (rt.ollama.status !== 'up') return 'down';
  return rt.ready_for_llm && rt.ready_for_rag ? 'up' : 'degraded';
}

interface ProviderProps {
  children: React.ReactNode;
  pollMs?: number;
  fetchImpl?: FetchLike;
  /** tests: fixed URL inputs instead of Expo Constants / storage */
  initial?: { override?: string | null; env?: string | null; hostUri?: string | null; platform?: string };
}

export function ConnectionProvider({ children, pollMs = 10000, fetchImpl, initial }: ProviderProps) {
  const [override, setOverride] = useState<string | null>(initial?.override ?? null);
  const [ready, setReady] = useState(initial !== undefined);
  const [backend, setBackend] = useState<Level>('checking');
  const [ollama, setOllama] = useState<Level>('checking');
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);

  const resolved = useMemo(
    () =>
      resolveBaseUrl({
        override,
        env: initial ? initial.env : process.env.EXPO_PUBLIC_API_BASE_URL,
        envPort: process.env.EXPO_PUBLIC_API_PORT,
        hostUri: initial ? initial.hostUri : (Constants.expoConfig as { hostUri?: string } | null)?.hostUri,
        platform: initial?.platform ?? Platform.OS,
      }),
    [override, initial],
  );
  const urlRef = useRef(resolved.url);
  urlRef.current = resolved.url;
  const api = useMemo(() => createApi(new ApiClient(() => urlRef.current, fetchImpl)), [fetchImpl]);

  useEffect(() => {
    if (initial !== undefined) return;
    loadBaseUrlOverride().then((v) => {
      setOverride(v);
      setReady(true);
    });
  }, [initial]);

  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      await api.health();
    } catch {
      if (mine !== seq.current) return;
      setBackend('down');
      setOllama('unknown');
      setRuntime(null);
      setLastChecked(Date.now());
      return;
    }
    if (mine !== seq.current) return;
    setBackend('up');
    try {
      const rt = await api.runtimeStatus();
      if (mine !== seq.current) return;
      setRuntime(rt);
      setOllama(ollamaLevel(rt));
    } catch {
      if (mine !== seq.current) return;
      setRuntime(null);
      setOllama('unknown');
    }
    setLastChecked(Date.now());
  }, [api]);

  useEffect(() => {
    if (!ready) return;
    refresh();
    const t = setInterval(refresh, pollMs);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [ready, refresh, pollMs, resolved.url]);

  const setBaseUrlOverride = useCallback(async (value: string | null) => {
    if (value !== null && value.trim() !== '' && normalizeBaseUrl(value) === null) return false;
    const clean = value && value.trim() ? normalizeBaseUrl(value) : null;
    await saveBaseUrlOverride(clean);
    setOverride(clean);
    setBackend('checking');
    setOllama('checking');
    return true;
  }, []);

  const value: ConnectionValue = {
    backend, ollama, runtime, baseUrl: resolved.url, urlSource: resolved.source, lastChecked, api, refresh, setBaseUrlOverride,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConnection(): ConnectionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useConnection must be used inside <ConnectionProvider>');
  return v;
}
