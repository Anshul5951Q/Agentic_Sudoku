import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { TraceStream, wsUrlFor, type ConnState } from '@/services/traceStream';
import { useConnection } from '@/state/ConnectionContext';
import type { SolveRun, TraceEvent } from '@/types/api';

const TERMINAL = ['completed', 'failed', 'cancelled'];

/** Loads a run and its stored trace; if the run is still live, follows it over the WebSocket (with catch-up). */
export function useTraceRun(runId: string, opts: { WebSocketImpl?: typeof WebSocket; baseDelayMs?: number } = {}) {
  const { api, baseUrl } = useConnection();
  const [run, setRun] = useState<SolveRun | null>(null);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [conn, setConn] = useState<ConnState>('idle');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null);
  const stream = useRef<TraceStream | null>(null);
  const alive = useRef(true);

  const append = useCallback((evs: TraceEvent[]) => setEvents((cur) => {
    const last = cur.length ? cur[cur.length - 1].sequence : -1;
    const fresh = evs.filter((e) => e.sequence > last);
    return fresh.length ? [...cur, ...fresh] : cur;
  }), []);

  const refreshRun = useCallback(async () => {
    try { const r = await api.getRun(runId); if (alive.current) setRun(r); return r; } catch { return null; }
  }, [api, runId]);

  const follow = useCallback((after: number) => {
    stream.current?.stop();
    const s = new TraceStream({
      url: wsUrlFor(baseUrl, runId),
      fetchMissed: async (a) => (await api.getTrace(runId, a)).events,
      onEvents: append,
      onStatus: () => { refreshRun(); },
      onTerminal: () => { refreshRun(); },
      onConnection: (st, n, detail) => { if (!alive.current) return; setConn(st); setAttempt(n); if (st === 'error' && detail) setError({ code: 'STREAM', message: detail }); },
      WebSocketImpl: opts.WebSocketImpl, baseDelayMs: opts.baseDelayMs,
    });
    stream.current = s;
    s.start(after);
  }, [api, append, baseUrl, opts.WebSocketImpl, opts.baseDelayMs, refreshRun, runId]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.getRun(runId);
      const t = await api.getTrace(runId, -1);
      if (!alive.current) return;
      setRun(r); setEvents(t.events);
      if (!TERMINAL.includes(r.status) && (r.status === 'running' || r.status === 'queued')) follow(t.events.length ? t.events[t.events.length - 1].sequence : -1);   // resume after what we actually received
      else setConn('closed');
    } catch (e) {
      if (!alive.current) return;
      setError({ code: (e as { code?: string }).code ?? null, message: (e as Error).message });
    }
  }, [api, follow, runId]);

  useEffect(() => {
    alive.current = true;
    load();
    // App background/foreground: drop the socket in the background; on return catch up over REST and reconnect.
    const sub = AppState.addEventListener('change', async (st) => {
      if (st === 'background') { stream.current?.stop(); setConn('idle'); }
      if (st === 'active' && stream.current && !stream.current.finished) {
        try { append((await api.getTrace(runId, stream.current.lastSeq)).events); } catch { /* reconnect will retry */ }
        follow(stream.current.lastSeq);
      }
    });
    return () => { alive.current = false; sub.remove(); stream.current?.stop(); };
  }, [load, api, append, follow, runId]);

  /** After resume/pause/cancel from this screen: refresh the run and (re)attach the live stream if it is running. */
  const reattach = useCallback(async () => {
    const r = await refreshRun();
    const last = stream.current?.lastSeq ?? (events.length ? events[events.length - 1].sequence : -1);
    if (r && (r.status === 'running' || r.status === 'queued')) {
      try { append((await api.getTrace(runId, last)).events); } catch { /* ignore */ }
      follow(Math.max(last, stream.current?.lastSeq ?? -1));
    }
  }, [api, append, events, follow, refreshRun, runId]);

  return { run, events, conn, attempt, error, reload: load, reattach, live: !!run && (run.status === 'running' || run.status === 'queued') };
}
