import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnection } from '@/state/ConnectionContext';
import type { AnalyticsSummary, SessionSummary } from '@/types/api';

export type HomeStatus = 'idle' | 'loading' | 'loaded' | 'error';

/** Dashboard numbers come only from the backend (computed from stored runs); nothing is cached as fake data. */
export function useHomeData() {
  const { api, backend } = useConnection();
  const [status, setStatus] = useState<HomeStatus>('idle');
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setStatus('loading');
    try {
      const [s, h] = await Promise.all([api.analyticsSummary(), api.history(10)]);
      if (mine !== seq.current) return;
      setSummary(s);
      setSessions(h.sessions);
      setError(null);
      setStatus('loaded');
    } catch (e) {
      if (mine !== seq.current) return;
      setSummary(null);
      setSessions([]);
      setError((e as Error).message);
      setStatus('error');
    }
  }, [api]);

  useEffect(() => {
    if (backend === 'up') reload();
    else if (backend === 'down') {
      seq.current++;
      setSummary(null);
      setSessions([]);
      setStatus('idle');
      setError(null);
    }
  }, [backend, reload]);

  return { status, summary, sessions, error, reload };
}

export const formatSeconds = (s: number | null | undefined): string =>
  s === null || s === undefined ? '—' : s < 1 ? `${(s * 1000).toFixed(1)} ms` : `${s.toFixed(2)} s`;
export const formatCount = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : n.toLocaleString('en-US'));
