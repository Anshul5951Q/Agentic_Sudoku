import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnection } from '@/state/ConnectionContext';
import type { AgentContract, AgentStatusResponse, CheckpointSummary, SolveRun, TraceEvent } from '@/types/api';

/**
 * Follows one run using ONLY backend data: run, per-agent status derived from the stored trace, the persisted trace and
 * (for tree-of-thought runs) the checkpoint summary. Polls while the run is live; one final load when it stops.
 */
export function useRunDetail(runId: string, pollMs = 1000) {
  const { api } = useConnection();
  const [run, setRun] = useState<SolveRun | null>(null);
  const [agents, setAgents] = useState<AgentStatusResponse | null>(null);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [checkpoint, setCheckpoint] = useState<CheckpointSummary | null>(null);
  const [contracts, setContracts] = useState<AgentContract[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.getRun(runId);
      const [a, t] = await Promise.all([api.agentStatus(runId), api.getTrace(runId, -1)]);
      let cp: CheckpointSummary | null = null;
      if (r.mode === 'tot') cp = await api.checkpoint(runId).catch(() => null);
      if (!alive.current) return null;
      setRun(r); setAgents(a); setEvents(t.events); setCheckpoint(cp); setError(null); setErrorCode(null); setLoading(false);
      return r;
    } catch (e) {
      if (!alive.current) return null;
      setError((e as Error).message); setErrorCode((e as { code?: string }).code ?? null); setLoading(false);
      return null;
    }
  }, [api, runId]);

  const schedule = useCallback(async () => {
    const r = await load();
    if (!alive.current) return;
    if (r && (r.status === 'running' || r.status === 'queued')) timer.current = setTimeout(schedule, pollMs);
  }, [load, pollMs]);

  useEffect(() => {
    alive.current = true;
    schedule();
    api.contracts().then((c) => alive.current && setContracts(c)).catch(() => undefined);
    return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); };
  }, [schedule, api]);

  const reload = useCallback(() => { if (timer.current) clearTimeout(timer.current); schedule(); }, [schedule]);
  return { run, agents, events, checkpoint, contracts, error, errorCode, loading, reload };
}
