import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Chip, errText, KV, MiniBoard, Segmented, StatusPill } from '@/components/lab';
import { Button, Card, EmptyState, Loading, Notice, Screen, SectionTitle } from '@/components/ui';
import { useRunDetail } from '@/hooks/useRunDetail';
import { useConnection } from '@/state/ConnectionContext';
import { colors, fontSize, radius, spacing } from '@/theme';
import type { AgentContract, AgentStatus, TraceEvent } from '@/types/api';

type Section = 'agents' | 'routing' | 'votes' | 'events' | 'memory';

/** Maps a role-contract name (from /api/agents/contracts) to the agent name used in the trace (from /api/agents/{id}/status). */
const CONTRACT_TO_AGENT: Record<string, string> = {
  Proposer: 'Proposer', 'Evaluator / RuleChecker': 'RuleChecker', Verifier: 'Verifier', 'Verifier / Backtracker': 'Backtracker', Supervisor: 'Supervisor',
};

const decodeKey = (k: string): number[][] => k.split('/').map((r) => r.split('').map(Number));

function AgentCard({ contract, status }: { contract: AgentContract; status: AgentStatus | undefined }) {
  const [open, setOpen] = useState(false);
  const s = status;
  return (
    <Card testID={`agent-${contract.name}`}>
      <View style={styles.rowBetween}>
        <Text style={styles.h3}>{contract.name}</Text>
        <StatusPill testID={`agent-status-${contract.name}`} status={s?.status ?? 'idle'} />
      </View>
      <KV k="Current task" v={s?.current_task ?? '—'} />
      <KV k="Latest message" testID={`agent-msg-${contract.name}`}
        v={s?.latest_message ? `#${s.latest_message.sequence} ${s.latest_message.event}${s.latest_message.reason_code ? ` [${s.latest_message.reason_code}]` : ''}${s.latest_message.reason ? `: ${s.latest_message.reason}` : ''}` : 'no activity in this run'} />
      <KV k="Tool calls" v={String(s?.tool_calls ?? 0)} />
      <KV k="Retries" testID={`agent-retry-${contract.name}`} v={`${s?.retries ?? 0} retried · ${s?.recovered ?? 0} recovered`} />
      <KV k="Time" v={s?.active_seconds != null ? `${s.active_seconds.toFixed(3)} s active (${s.event_count} events)` : '—'} />
      <KV k="Error" testID={`agent-error-${contract.name}`} v={s?.error ?? 'none'} />
      <Pressable testID={`spec-toggle-${contract.name}`} accessibilityRole="button" onPress={() => setOpen(!open)} style={styles.toggle}>
        <Text style={styles.toggleText}>{open ? 'Hide' : 'Show'} role specification</Text>
      </Pressable>
      {open && (
        <View testID={`spec-${contract.name}`} style={{ gap: 4 }}>
          <KV k="Name" v={contract.name} />
          <KV k="Goal" v={contract.goal} />
          <KV k="Tools" v={contract.tools.join('; ')} />
          <KV k="Inputs / outputs" v={contract.inputs_outputs} />
          <KV k="Limits" v={contract.limits} />
        </View>
      )}
    </Card>
  );
}

const FILTERS: { value: string; label: string; test: (e: TraceEvent) => boolean }[] = [
  { value: 'all', label: 'All', test: () => true },
  { value: 'routing', label: 'Routing', test: (e) => e.event === 'route' },
  { value: 'tools', label: 'Tools', test: (e) => e.event.startsWith('tool_') },
  { value: 'memory', label: 'Memory', test: (e) => e.event.startsWith('memory_') },
  { value: 'failures', label: 'Failures', test: (e) => ['search_failed', 'tool_failure', 'rule_violation', 'dead_end', 'memory_hit_rejected'].includes(e.event) },
];

export default function RunDetailScreen() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const { api } = useConnection();
  const { run, agents, events, checkpoint, contracts, error, errorCode, loading, reload } = useRunDetail(String(runId));
  const [section, setSection] = useState<Section>('agents');
  const [filter, setFilter] = useState('all');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);

  if (loading) return <Screen><Loading label="Loading run…" /></Screen>;
  if (error || !run) {
    return (
      <Screen testID="run-error">
        <Notice kind="error" testID="run-error-msg">{errorCode === 'RUN_NOT_FOUND' ? 'This run was not found on the backend.' : `Could not load the run: ${error ?? 'unknown error'}`}</Notice>
        <Button label="Retry" onPress={reload} />
      </Screen>
    );
  }

  const res = run.result;
  const c = res?.counters ?? {};
  const maxHops = c.max_hops ?? run.config.max_hops ?? null;
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); setMsg({ kind: 'success', text: ok }); } catch (e) { setMsg({ kind: 'error', text: errText(e) }); }
    reload();
  };
  const demo: string[] = [];
  if (run.config.faults?.length) demo.push(`controlled faults: ${run.config.faults.map((f: any) => `${f.variant}=${f.kind}`).join(', ')}`);
  if (run.config.inject_tool_failure) demo.push(`injected tool failure: ${run.config.inject_tool_failure.tool} ×${run.config.inject_tool_failure.times}`);
  if (run.config.max_hops) demo.push(`MAX_HOPS limited to ${run.config.max_hops}`);
  const terminalFail = [...events].reverse().find((e) => e.event === 'search_failed');
  const shown = events.filter((e) => (FILTERS.find((f) => f.value === filter) ?? FILTERS[0]).test(e));
  const memEvents = events.filter((e) => e.event.startsWith('memory_'));
  const sections: { value: Section; label: string }[] = [
    { value: 'agents', label: 'Agents' }, { value: 'routing', label: 'Routing' }, { value: 'votes', label: 'Votes' }, { value: 'events', label: 'Events' },
    ...(run.config.use_memory ? [{ value: 'memory' as Section, label: 'Memory use' }] : []),
  ];

  return (
    <Screen testID="run-detail">
      <Card testID="run-summary">
        <View style={styles.rowBetween}>
          <Text style={styles.h3} accessibilityRole="header">{run.mode === 'multi-agent' ? 'Multi-agent run' : run.mode === 'tot' ? 'Tree-of-Thought run' : 'CoT run'}</Text>
          <StatusPill testID="run-status" status={run.status} />
        </View>
        <KV k="Run" v={run.run_id} />
        <KV k="Thread" testID="run-thread" v={run.thread_id} />
        <KV k="Outcome" testID="run-outcome" v={res ? `${res.outcome}${res.verified ? ' (verified)' : ' (not verified)'}` : run.live ? 'running…' : '—'} />
        {res?.failure && <KV k="Failure" testID="run-failure" v={`${res.failure.code}: ${res.failure.reason}`} />}
        <KV k="Deterministic" testID="run-det" v={run.deterministic_components.join(', ')} />
        <KV k="LLM" testID="run-llm" v={run.llm_components.length ? run.llm_components.join(', ') : 'none: this run uses no language model'} />
        {run.live ? <Text style={styles.live} testID="live-label">LIVE: updating from the backend</Text> : <Text style={styles.muted} testID="recorded-label">Recorded run (replay of the stored trace)</Text>}
        {demo.length > 0 && <Notice kind="warning" testID="demo-banner">CONTROLLED DEMO: {demo.join(' · ')}. This is not a normal run.</Notice>}
        {msg && <Notice kind={msg.kind} testID="run-msg">{msg.text}</Notice>}
        {run.mode === 'tot' && (
          <View style={styles.row}>
            <Button testID="pause" label="Pause" variant="secondary" disabled={run.status !== 'running'} onPress={() => act(() => api.pause(run.run_id), 'Paused at a safe checkpoint.')} />
            <Button testID="resume" label="Resume" variant="secondary" disabled={!run.resumable} onPress={() => act(() => api.resume(run.run_id), 'Resumed from the saved checkpoint.')} />
            <Button testID="cancel" label="Cancel" variant="danger" disabled={['completed', 'failed', 'cancelled'].includes(run.status)} onPress={() => act(() => api.cancel(run.run_id), 'Cancelled.')} />
          </View>
        )}
        {checkpoint && (
          <View testID="checkpoint-card" style={{ gap: 2 }}>
            <KV k="Checkpoint" v={checkpoint.detail ?? `step ${checkpoint.search_steps}, depth ${checkpoint.depth}, ${checkpoint.events} events, status ${checkpoint.status}`} />
            <KV k="Resumable" v={checkpoint.resumable ? 'yes: resume continues from this checkpoint, not from the root' : 'no'} />
          </View>
        )}
      </Card>

      <Segmented options={sections} value={section} onChange={setSection} testIDPrefix="section" />

      {section === 'agents' && (
        <View style={{ gap: spacing.md }} testID="agents-section">
          {!contracts && <Loading label="Loading role specifications…" />}
          {contracts?.map((ct) => (
            <AgentCard key={ct.name} contract={ct} status={agents?.agents.find((a) => a.agent === CONTRACT_TO_AGENT[ct.name])} />
          ))}
          {agents && <Text style={styles.muted} testID="agents-note">{agents.note}</Text>}
        </View>
      )}

      {section === 'routing' && (
        <View style={{ gap: spacing.md }} testID="routing-section">
          {run.mode !== 'multi-agent' ? (
            <EmptyState title="No supervisor routing in this run" body="Routing and MAX_HOPS apply to multi-agent runs." />
          ) : (
            <Card>
              <SectionTitle>Supervisor routing</SectionTitle>
              <Text style={styles.big} testID="hops-used">Hops used: {agents?.routing_trace.length ?? 0} of MAX_HOPS {maxHops ?? '?'}</Text>
              {agents?.routing_trace.map((h) => (
                <View key={h.hop} testID={`hop-${h.hop}`} style={styles.hop}>
                  <Text style={styles.hopNo}>{h.hop}/{maxHops ?? '?'}</Text>
                  <Text style={styles.hopText}>→ {h.to}: {h.reason}</Text>
                </View>
              ))}
              {res?.failure?.code === 'HOP_LIMIT_EXCEEDED' && (
                <Notice kind="error" testID="hop-limit-notice">Hop limit enforced: {terminalFail?.reason ?? res.failure.reason}</Notice>
              )}
              {!agents?.routing_trace.length && <Text style={styles.muted}>No routing recorded yet.</Text>}
            </Card>
          )}
        </View>
      )}

      {section === 'votes' && (
        <View style={{ gap: spacing.md }} testID="votes-section">
          {run.mode !== 'multi-agent' ? (
            <EmptyState title="No vote in this run" body="Voting applies to multi-agent runs." />
          ) : !res ? (
            <Loading label="Waiting for the vote…" />
          ) : (
            <>
              <Notice kind="info" testID="variant-label">Candidate-order variants: the same deterministic solver trying candidates in a different order. They are not independent LLM agents.</Notice>
              {res.vote ? <Text style={styles.muted} testID="vote-note">{res.vote.note}</Text> : <Notice kind="warning" testID="no-vote">No vote was taken: {res.failure?.reason ?? 'the run stopped before voting'}</Notice>}
              <Card>
                <SectionTitle>Attempts</SectionTitle>
                {(c.attempts ?? []).map((a) => {
                  const ex = res.vote?.excluded.find((x) => x.attempt === a.name);
                  const elig = res.vote?.eligible.includes(a.name);
                  return (
                    <View key={a.name} testID={`attempt-${a.name}`} style={styles.attempt}>
                      <View style={styles.rowBetween}>
                        <Text style={styles.h3}>{a.name}</Text>
                        <Text testID={`attempt-verdict-${a.name}`} style={[styles.verdict, { color: elig ? colors.success : colors.danger }]}>{elig ? 'VOTES' : ex ? `EXCLUDED: ${ex.reason}` : 'not counted'}</Text>
                      </View>
                      <KV k="Order" v={`${a.order} (${a.strategy})`} />
                      <KV k="Status" v={`${a.status}${a.error ? ` (${a.error})` : ''}`} />
                      <KV k="Nodes / time" v={`${a.nodes} nodes · ${a.seconds ?? '—'} s`} />
                      <KV k="Verified valid" v={a.valid ? 'yes' : 'no'} />
                    </View>
                  );
                })}
              </Card>
              {res.vote && Object.keys(res.vote.votes).length > 0 && (
                <Card testID="vote-tally">
                  <SectionTitle>Votes (verified solutions only)</SectionTitle>
                  {Object.entries(res.vote.votes).map(([k, n]) => (
                    <View key={k} style={styles.row}>
                      <MiniBoard values={decodeKey(k)} size={96} />
                      <Text style={styles.big}>{n} vote{n === 1 ? '' : 's'}</Text>
                    </View>
                  ))}
                </Card>
              )}
              {res.vote?.disagreement && (
                <Notice kind="warning" testID="disagreement">Verified solutions DISAGREE ({res.vote.solution_count} or more exist for this puzzle). The disagreement is reported, not hidden.</Notice>
              )}
              {res.vote?.winner ? (
                <Card testID="winner"><SectionTitle>Winner</SectionTitle><MiniBoard values={res.vote.winner} /></Card>
              ) : (
                <Notice kind="error" testID="no-winner">No winner{res.failure ? `: ${res.failure.code}: ${res.failure.reason}` : ''}</Notice>
              )}
            </>
          )}
        </View>
      )}

      {section === 'events' && (
        <View style={{ gap: spacing.sm }} testID="events-section">
          <View style={styles.chips}>
            {FILTERS.map((f) => <Chip key={f.value} testID={`filter-${f.value}`} label={f.label} on={filter === f.value} onPress={() => setFilter(f.value)} />)}
          </View>
          {shown.length === 0 && <EmptyState title="No events match this filter" body="The backend recorded none of this kind for the run." />}
          {shown.slice(-150).map((e) => (
            <View key={e.event_id} testID={`event-${e.sequence}`} style={styles.event}>
              <Text style={styles.evHead}>#{e.sequence} {e.event} · {e.agent}</Text>
              {(e.reason_code || e.reason) && <Text style={styles.evBody}>{e.reason_code ? `[${e.reason_code}] ` : ''}{e.reason}</Text>}
            </View>
          ))}
        </View>
      )}

      {section === 'memory' && (
        <View style={{ gap: spacing.md }} testID="memory-section">
          <Card>
            <SectionTitle>Which memory was used, and how</SectionTitle>
            <KV k="Namespace" v={`(${run.config.user_id}, "dead_ends")`} />
            <KV k="Confirmed" testID="mem-confirmed" v={`${c.memory_confirmed ?? 0} remembered dead end(s) re-verified deterministically, then pruned`} />
            <KV k="Rejected" testID="mem-rejected" v={`${c.memory_rejected ?? 0} stale pattern(s) ignored; the branch was explored normally`} />
            <KV k="Outcome" v={res ? `${res.outcome}${res.verified ? ': a verified solution was still found' : ''}` : 'running…'} />
          </Card>
          {memEvents.length === 0 && <EmptyState testID="no-memory-events" title="No memory was retrieved in this run" body="Nothing matching the board was found in this user's dead-end memory." />}
          {memEvents.map((e) => (
            <View key={e.event_id} testID={`mem-event-${e.sequence}`} style={styles.event}>
              <Text style={styles.evHead}>#{e.sequence} {e.event}{e.data?.pattern_id ? ` · pattern ${e.data.pattern_id}` : ''}</Text>
              <Text style={styles.evBody}>[{e.reason_code}] {e.reason}</Text>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' },
  chips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  h3: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', flexShrink: 1 },
  big: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: fontSize.xs },
  live: { color: colors.info, fontSize: fontSize.xs, fontWeight: '700' },
  toggle: { minHeight: 40, justifyContent: 'center' },
  toggleText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '600' },
  hop: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, padding: spacing.sm },
  hopNo: { color: colors.accent, fontWeight: '800', fontSize: fontSize.sm, minWidth: 38 },
  hopText: { color: colors.text, fontSize: fontSize.xs, flex: 1 },
  attempt: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md, gap: 3 },
  verdict: { fontSize: fontSize.xs, fontWeight: '800' },
  event: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm },
  evHead: { color: colors.text, fontSize: fontSize.xs, fontWeight: '700' },
  evBody: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
});
