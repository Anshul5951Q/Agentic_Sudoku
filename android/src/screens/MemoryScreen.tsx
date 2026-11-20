import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { Chip, errCode, errText, isUnreachable, KV, Segmented, StatusPill } from '@/components/lab';
import { Button, Card, EmptyState, Loading, Notice, Screen, SectionTitle } from '@/components/ui';
import { SAMPLE_PUZZLE } from '@/constants/sample';
import { useConnection } from '@/state/ConnectionContext';
import { colors, fontSize, radius, spacing } from '@/theme';
import type { ChatResponse, MemoryRecord, RAGResponse, SolveRun, TraceEvent } from '@/types/api';

type Tab = 'thread' | 'long' | 'dead' | 'rag';
const DEFAULT_USER = 'demo-user';

const Offline = () => <Notice kind="warning" testID="mem-offline">The backend is not reachable, so this screen has no data to show.</Notice>;
const ollamaMsg = 'Ollama is unavailable: the local model could not be reached.';

/* ================================================================= thread (short-term) memory */
function ThreadPanel() {
  const { api, backend } = useConnection();
  const [memory, setMemory] = useState(true);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [log, setLog] = useState<{ you: string; res: ChatResponse }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; ollama: boolean } | null>(null);
  const [restoreId, setRestoreId] = useState('');
  const [restored, setRestored] = useState<{ thread_id: string; messages: { role: string; content: string }[] } | null>(null);
  const [demo, setDemo] = useState<{ on: ChatResponse; off: ChatResponse } | null>(null);

  const fail = (e: unknown) => setErr({ text: isUnreachable(e) ? 'The backend is not reachable.' : errCode(e) === 'OLLAMA_UNAVAILABLE' ? ollamaMsg : errText(e), ollama: errCode(e) === 'OLLAMA_UNAVAILABLE' });

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr(null);
    try {
      const res = await api.chat(text.trim(), memory, memory ? threadId : null, SAMPLE_PUZZLE);
      if (res.thread_id) setThreadId(res.thread_id);
      setLog((l) => [...l, { you: text.trim(), res }]);
      setText('');
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const runDemo = async () => {
    setBusy(true); setErr(null); setDemo(null);
    const t1 = 'I am working on the sample 4x4 puzzle. I plan to fill the cell in row 1, column 2 first.';
    const t2 = 'Which cell did I say I would fill first? Answer in one sentence.';
    try {
      const a1 = await api.chat(t1, true, null, SAMPLE_PUZZLE);
      const on = await api.chat(t2, true, a1.thread_id, undefined);
      await api.chat(t1, false);
      const off = await api.chat(t2, false);
      setThreadId(a1.thread_id);
      setDemo({ on, off });
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const restore = async () => {
    setErr(null); setRestored(null);
    try { setRestored(await api.chatHistory(restoreId.trim())); } catch (e) {
      setErr({ text: errCode(e) === 'THREAD_NOT_FOUND' ? 'No checkpoint exists for that thread_id.' : errText(e), ollama: false });
    }
  };

  return (
    <View style={{ gap: spacing.md }} testID="thread-panel">
      {backend === 'down' && <Offline />}
      <Card>
        <SectionTitle>Thread memory (short-term)</SectionTitle>
        <Text style={styles.note}>With memory ON the model receives the whole conversation stored in a LangGraph SQLite checkpoint under a stable thread_id. With memory OFF every turn is independent.</Text>
        <KV k="thread_id" testID="thread-id" v={threadId ?? 'none yet (memory ON creates one on the first turn)'} />
        <View style={styles.chips}>
          <Chip testID="mem-on" label="Memory ON" on={memory} onPress={() => setMemory(true)} />
          <Chip testID="mem-off" label="Memory OFF" on={!memory} onPress={() => setMemory(false)} />
          <Chip testID="new-thread" label="New thread" onPress={() => { setThreadId(null); setLog([]); }} />
        </View>
        <TextInput testID="chat-input" value={text} onChangeText={setText} placeholder="Say something, then ask a follow-up" placeholderTextColor={colors.textMuted} style={styles.input} />
        <Button testID="chat-send" label={busy ? 'Waiting for the model…' : 'Send'} disabled={busy || backend === 'down' || !text.trim()} onPress={send} />
        {err && <Notice kind={err.ollama ? 'warning' : 'error'} testID="thread-error">{err.text}</Notice>}
      </Card>

      {log.length === 0 && !err && <EmptyState testID="no-thread" title="No messages yet" body="Send a message, or run the amnesia demo below." />}
      {log.map((m, i) => (
        <Card key={i} testID={`turn-${i}`}>
          <Text style={styles.you}>You: {m.you}</Text>
          <Text style={styles.reply}>Model: {m.res.reply}</Text>
          <Text style={styles.note} testID={`turn-meta-${i}`}>memory {m.res.memory ? 'ON' : 'OFF'} · the model received {m.res.messages_seen_by_model} message(s) · history {m.res.history_len}</Text>
        </Card>
      ))}

      <Card>
        <SectionTitle>Amnesia demo: same follow-up, memory ON vs OFF</SectionTitle>
        <Button testID="run-demo" label="Run the demo" variant="secondary" disabled={busy || backend === 'down'} onPress={runDemo} />
        {demo && (
          <View style={{ gap: spacing.sm }} testID="demo-result">
            <View style={styles.compare}>
              <View style={[styles.col, { borderColor: colors.success }]} testID="demo-on">
                <Text style={styles.h3}>Memory ON</Text>
                <Text style={styles.note}>model received {demo.on.messages_seen_by_model} message(s)</Text>
                <Text style={styles.reply}>{demo.on.reply}</Text>
              </View>
              <View style={[styles.col, { borderColor: colors.danger }]} testID="demo-off">
                <Text style={styles.h3}>Memory OFF</Text>
                <Text style={styles.note}>model received {demo.off.messages_seen_by_model} message(s)</Text>
                <Text style={styles.reply}>{demo.off.reply}</Text>
              </View>
            </View>
          </View>
        )}
      </Card>

      <Card>
        <SectionTitle>Restore a thread from its checkpoint</SectionTitle>
        <TextInput testID="restore-input" value={restoreId} onChangeText={setRestoreId} placeholder="thread_id" autoCapitalize="none" placeholderTextColor={colors.textMuted} style={styles.input} />
        <View style={styles.chips}>
          <Button testID="restore" label="Restore" variant="secondary" disabled={!restoreId.trim()} onPress={restore} />
          {threadId && <Chip testID="use-current" label="Use current thread" onPress={() => setRestoreId(threadId)} />}
        </View>
        {restored && (
          <View testID="restored" style={{ gap: 4 }}>
            <Notice kind="success">Restored {restored.messages.length} message(s) from the checkpoint of {restored.thread_id}.</Notice>
            {restored.messages.map((m, i) => <Text key={i} style={styles.note}>{m.role}: {m.content}</Text>)}
          </View>
        )}
      </Card>
    </View>
  );
}

/* ================================================================= long-term memory */
const KINDS = ['profile', 'puzzle_history', 'dead_ends'] as const;

function LongTermPanel({ userId, setUserId }: { userId: string; setUserId: (u: string) => void }) {
  const { api, backend } = useConnection();
  const [records, setRecords] = useState<MemoryRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');

  const load = useCallback(async () => {
    try { setRecords(await api.listMemory(userId)); setError(null); } catch (e) { setError(isUnreachable(e) ? 'The backend is not reachable.' : errText(e)); }
  }, [api, userId]);
  useFocusEffect(useCallback(() => { if (backend !== 'down') load(); }, [backend, load]));

  const del = (m: MemoryRecord) => Alert.alert('Delete this memory?', `${m.kind} / ${m.memory_key}`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => { try { await api.deleteMemory(m.memory_id, userId); setMsg('Memory deleted.'); } catch (e) { setMsg(errText(e)); } load(); } },
  ]);
  const clear = () => Alert.alert('Clear all demo data?', `This deletes every memory of "${userId}". It cannot be undone.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Clear all', style: 'destructive', onPress: async () => { try { const r = await api.clearMemory(userId); setMsg(`Cleared ${r.deleted} memories.`); } catch (e) { setMsg(errText(e)); } load(); } },
  ]);
  const add = async () => {
    try { await api.createMemory(userId, 'profile', key.trim(), { value: val }); setKey(''); setVal(''); setMsg('Saved to (user, "profile").'); load(); } catch (e) { setMsg(errText(e)); }
  };

  return (
    <View style={{ gap: spacing.md }} testID="long-panel">
      {backend === 'down' && <Offline />}
      <Card>
        <SectionTitle>Long-term memory (SQLite, survives restarts)</SectionTitle>
        <Text style={styles.note}>Memories live in namespaces (user_id, kind). They are stored by the backend, not on this device.</Text>
        <Text style={styles.label}>user_id</Text>
        <TextInput testID="user-id" value={userId} onChangeText={setUserId} autoCapitalize="none" placeholderTextColor={colors.textMuted} style={styles.input} />
        <View style={styles.chips}>
          <Button testID="reload-mem" label="Load" variant="secondary" onPress={load} />
          <Button testID="clear-mem" label="Clear demo data" variant="danger" onPress={clear} />
        </View>
        {msg && <Notice kind="info" testID="mem-msg">{msg}</Notice>}
        {error && <Notice kind="error" testID="mem-error">{error}</Notice>}
      </Card>
      {records === null && !error && backend !== 'down' && <Loading label="Loading memories…" />}
      {records?.length === 0 && <EmptyState testID="no-memories" title="No memories yet" body={`Nothing is stored for "${userId}". Run a ToT run with memory, or add a profile memory below.`} />}
      {KINDS.map((k) => {
        const rs = records?.filter((r) => r.kind === k) ?? [];
        if (!rs.length) return null;
        return (
          <View key={k} style={{ gap: spacing.sm }} testID={`ns-${k}`}>
            <Text style={styles.h3}>Namespace ({userId}, "{k}") · {rs.length}</Text>
            {rs.map((m) => (
              <Card key={m.memory_id} testID={`mem-${m.memory_id}`}>
                <KV k="Key" v={m.memory_key} />
                <KV k="Created" testID={`created-${m.memory_id}`} v={m.created_at} />
                <KV k="Last used" testID={`used-${m.memory_id}`} v={m.last_used_at ?? 'never used'} />
                <KV k="Use count" v={String(m.use_count)} />
                <KV k="Content" v={JSON.stringify(m.payload)} />
                <Button testID={`del-${m.memory_id}`} label="Delete" variant="secondary" onPress={() => del(m)} />
              </Card>
            ))}
          </View>
        );
      })}
      <Card>
        <SectionTitle>Add a profile memory</SectionTitle>
        <TextInput testID="mem-key" value={key} onChangeText={setKey} placeholder="key" placeholderTextColor={colors.textMuted} style={styles.input} />
        <TextInput testID="mem-val" value={val} onChangeText={setVal} placeholder="value" placeholderTextColor={colors.textMuted} style={styles.input} />
        <Button testID="mem-add" label="Save memory" disabled={!key.trim()} onPress={add} />
      </Card>
    </View>
  );
}

/* ================================================================= dead-end library + memory lab */
interface LabResult { run: SolveRun; events: TraceEvent[]; title: string }

function DeadEndPanel({ userId }: { userId: string }) {
  const { api, backend } = useConnection();
  const [records, setRecords] = useState<MemoryRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lab, setLab] = useState<LabResult | null>(null);

  const load = useCallback(async () => {
    try { setRecords(await api.listMemory(userId, 'dead_ends')); setError(null); } catch (e) { setError(isUnreachable(e) ? 'The backend is not reachable.' : errText(e)); }
  }, [api, userId]);
  useFocusEffect(useCallback(() => { if (backend !== 'down') load(); }, [backend, load]));

  const runWithMemory = async (title: string, before?: () => Promise<unknown>) => {
    setBusy(title); setError(null); setLab(null);
    try {
      await before?.();
      const started = await api.startRun('tot', { board: SAMPLE_PUZZLE, strategy: 'first_empty', order: 'desc', use_memory: true, user_id: userId });
      let run = started;
      for (let i = 0; i < 60 && !['completed', 'failed', 'cancelled'].includes(run.status); i++) {
        await new Promise((r) => setTimeout(r, 300));
        run = await api.getRun(started.run_id);
      }
      const tr = await api.getTrace(run.run_id, -1);
      setLab({ run, events: tr.events.filter((e) => e.event.startsWith('memory_')), title });
      await load();
    } catch (e) { setError(isUnreachable(e) ? 'The backend is not reachable.' : errText(e)); } finally { setBusy(null); }
  };

  return (
    <View style={{ gap: spacing.md }} testID="dead-panel">
      {backend === 'down' && <Offline />}
      <Card>
        <SectionTitle>Dead-end library</SectionTitle>
        <Text style={styles.note}>Patterns remembered from failed branches. A pattern is only used if the current board contains all of its givens, and it is re-verified deterministically before it may prune anything.</Text>
        {error && <Notice kind="error" testID="dead-error">{error}</Notice>}
        {records === null && !error && backend !== 'down' && <Loading label="Loading…" />}
        {records?.length === 0 && <EmptyState testID="no-dead-ends" title="No dead-end patterns for this user" body="Run the lab below to learn some." />}
        {records?.map((m) => (
          <View key={m.memory_id} testID={`dead-${m.memory_id}`} style={styles.pattern}>
            <Text style={styles.h3}>cell [{m.payload.cell?.join(', ')}] = {m.payload.value} · {m.payload.reason_code}</Text>
            <Text style={styles.note}>{m.payload.givens?.length ?? 0} givens{m.payload.demo_stale ? ' · DEMO STALE PATTERN (deliberately wrong)' : ''} · used {m.use_count}× · last used {m.last_used_at ?? 'never'} · created {m.created_at}</Text>
          </View>
        ))}
      </Card>
      <Card>
        <SectionTitle>Memory lab (sample puzzle, TA1 cell order)</SectionTitle>
        <Button testID="lab-learn" label="1. Run ToT with memory (learns dead ends)" variant="secondary" disabled={!!busy || backend === 'down'} onPress={() => runWithMemory('Learn')} />
        <Button testID="lab-recall" label="2. Run again (uses what it remembered)" variant="secondary" disabled={!!busy || backend === 'down'} onPress={() => runWithMemory('Recall')} />
        <Button testID="lab-stale" label="3. Add a STALE pattern, then run" variant="secondary" disabled={!!busy || backend === 'down'}
          onPress={() => runWithMemory('Stale pattern', () => api.stalePattern(SAMPLE_PUZZLE, userId))} />
        {busy && <Loading label={`${busy}: running…`} />}
        {lab && (
          <View testID="lab-result" style={{ gap: spacing.sm }}>
            <View style={styles.rowBetween}><Text style={styles.h3}>{lab.title}</Text><StatusPill status={lab.run.status} /></View>
            <KV k="Outcome" testID="lab-outcome" v={`${lab.run.result?.outcome}${lab.run.result?.verified ? ' (verified solution found)' : ''}`} />
            <KV k="Confirmed" testID="lab-confirmed" v={`${lab.run.result?.counters.memory_confirmed ?? 0} remembered dead end(s) re-verified and pruned`} />
            <KV k="Rejected" testID="lab-rejected" v={`${lab.run.result?.counters.memory_rejected ?? 0} stale pattern(s) ignored`} />
            {lab.events.length === 0 && <Text style={styles.note} testID="lab-no-events">No memory was retrieved in this run.</Text>}
            {lab.events.map((e) => (
              <View key={e.event_id} testID={`lab-event-${e.sequence}`} style={styles.pattern}>
                <Text style={styles.h3}>{e.event}{e.data?.pattern_id ? ` · pattern ${e.data.pattern_id}` : ''}</Text>
                <Text style={styles.note}>[{e.reason_code}] {e.reason}</Text>
              </View>
            ))}
            <Button testID="lab-open" label="Open the full run" variant="ghost" onPress={() => router.push({ pathname: '/run/[runId]', params: { runId: lab.run.run_id } })} />
          </View>
        )}
      </Card>
    </View>
  );
}

/* ================================================================= RAG */
function RagCard({ r, testID }: { r: RAGResponse; testID: string }) {
  return (
    <View style={{ gap: spacing.sm }} testID={testID}>
      <Card testID={`${testID}-answer`}>
        <View style={styles.rowBetween}><Text style={styles.h3}>Answer (k={r.k})</Text>
          <StatusPill status={r.abstained ? 'blocked' : 'completed'} /></View>
        <Text style={styles.answer} testID={`${testID}-text`}>{r.answer}</Text>
        <Text style={styles.note}>{r.reason_code}{r.top_similarity != null ? ` · best similarity ${r.top_similarity} (threshold ${r.threshold})` : ''} · {r.llm_calls} model call(s)</Text>
        {r.abstained && <Notice kind="warning" testID={`${testID}-abstain`}>The evidence did not support an answer, so the system says it does not know instead of guessing.</Notice>}
      </Card>
      <Card testID={`${testID}-used`}>
        <Text style={styles.h3} testID={`${testID}-used-title`}>{r.abstained ? 'Retrieved, but NOT used (not enough support to answer)' : 'Evidence used'}</Text>
        {r.retrieved_chunk_ids.length ? <Text style={styles.note}>{r.retrieved_chunk_ids.join(', ')}</Text> : <Text style={styles.note}>No chunks were retrieved.</Text>}
      </Card>
      {r.evidence.length === 0 && <EmptyState testID={`${testID}-none`} title="No chunks retrieved" body="The knowledge store returned nothing for this query." />}
      {r.evidence.map((e) => (
        <Card key={e.chunk_id ?? e.text.slice(0, 10)} testID={`${testID}-chunk-${e.chunk_id}`}>
          <Text style={styles.h3}>{e.heading}</Text>
          <Text style={styles.note}>{e.chunk_id} · similarity {e.similarity}</Text>
          <Text style={styles.reply}>{e.text}</Text>
        </Card>
      ))}
    </View>
  );
}

function RagPanel() {
  const { api, backend } = useConnection();
  const [q, setQ] = useState('');
  const [k, setK] = useState<1 | 3>(3);
  const [res, setRes] = useState<RAGResponse | null>(null);
  const [cmp, setCmp] = useState<{ k1: RAGResponse; k3: RAGResponse } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; ollama: boolean } | null>(null);

  const run = async (compare: boolean) => {
    setBusy(true); setErr(null); setRes(null); setCmp(null);
    try {
      if (compare) { const [k1, k3] = await Promise.all([api.ragQuery(q.trim(), 1), api.ragQuery(q.trim(), 3)]); setCmp({ k1, k3 }); }
      else setRes(await api.ragQuery(q.trim(), k));
    } catch (e) {
      const code = errCode(e);
      setErr({ text: isUnreachable(e) ? 'The backend is not reachable.' : code === 'OLLAMA_UNAVAILABLE' ? ollamaMsg : code === 'VECTOR_STORE_UNAVAILABLE' ? 'The knowledge store is unavailable.' : errText(e), ollama: code === 'OLLAMA_UNAVAILABLE' });
    } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: spacing.md }} testID="rag-panel">
      {backend === 'down' && <Offline />}
      <Card>
        <SectionTitle>Ask the local knowledge base</SectionTitle>
        <Text style={styles.note}>Answers are generated by the local model only from retrieved evidence. If the evidence does not support an answer the result is "I don't know."</Text>
        <TextInput testID="rag-input" value={q} onChangeText={setQ} placeholder="Ask about 4x4 Sudoku solving" placeholderTextColor={colors.textMuted} style={styles.input} maxLength={500} />
        <View style={styles.chips}>
          <Chip testID="k-1" label="k = 1" on={k === 1} onPress={() => setK(1)} />
          <Chip testID="k-3" label="k = 3" on={k === 3} onPress={() => setK(3)} />
        </View>
        <View style={styles.chips}>
          <Chip testID="ex-answerable" label="Example: backtracking" onPress={() => setQ('What does backtracking restore?')} />
          <Chip testID="ex-unanswerable" label="Example: unanswerable" onPress={() => setQ('Who won the 2018 football world cup?')} />
        </View>
        <Button testID="rag-ask" label={busy ? 'Searching…' : 'Ask'} disabled={busy || !q.trim() || backend === 'down'} onPress={() => run(false)} />
        <Button testID="rag-compare" label="Compare k=1 and k=3" variant="secondary" disabled={busy || !q.trim() || backend === 'down'} onPress={() => run(true)} />
        {err && <Notice kind={err.ollama ? 'warning' : 'error'} testID="rag-error">{err.text}</Notice>}
        {err?.ollama && <Text style={styles.note} testID="rag-ollama">Start Ollama and check that qwen2.5:3b and nomic-embed-text are installed.</Text>}
      </Card>
      {busy && <Loading label="Retrieving evidence…" />}
      {res && <RagCard r={res} testID="rag" />}
      {cmp && <View style={{ gap: spacing.md }} testID="rag-compare-result"><RagCard r={cmp.k1} testID="rag-k1" /><RagCard r={cmp.k3} testID="rag-k3" /></View>}
      {!res && !cmp && !err && !busy && <EmptyState testID="rag-empty" title="No question asked yet" body="Ask a question to see the retrieved evidence and the grounded answer." />}
    </View>
  );
}

/* ================================================================= screen */
export default function MemoryScreen() {
  const [tab, setTab] = useState<Tab>('thread');
  const [userId, setUserId] = useState(DEFAULT_USER);
  return (
    <Screen testID="memory-screen">
      <Segmented options={[{ value: 'thread', label: 'Thread' }, { value: 'long', label: 'Long-term' }, { value: 'dead', label: 'Dead-ends' }, { value: 'rag', label: 'RAG' }]} value={tab} onChange={setTab} testIDPrefix="mtab" />
      {tab === 'thread' && <ThreadPanel />}
      {tab === 'long' && <LongTermPanel userId={userId} setUserId={setUserId} />}
      {tab === 'dead' && <DeadEndPanel userId={userId} />}
      {tab === 'rag' && <RagPanel />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', alignItems: 'center' },
  label: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: '700' },
  note: { color: colors.textMuted, fontSize: fontSize.xs },
  h3: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', flexShrink: 1 },
  you: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '600' },
  reply: { color: colors.text, fontSize: fontSize.sm },
  answer: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  compare: { flexDirection: 'row', gap: spacing.sm },
  col: { flex: 1, borderWidth: 2, borderRadius: radius.md, padding: spacing.sm, gap: 4 },
  pattern: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  input: { color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, minHeight: 48, backgroundColor: colors.surfaceAlt },
});
