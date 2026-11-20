import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';
import { Alert } from 'react-native';
import MemoryScreen from '@/screens/MemoryScreen';
import { ev, run, trace } from './fixtures';
import { BACKEND_UP, SAMPLE, renderWithBackend, res } from './helpers';

jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useLocalSearchParams: () => ({}), useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]) }));

const t = (id: string) => screen.getByTestId(id);
const rx = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const press = async (id: string) => { await fireEvent.press(t(id)); };
const type = async (id: string, v: string) => { await fireEvent.changeText(t(id), v); };
const err = (code: string, message: string, status = 500) => res(status, { error: { code, message, recoverable: true, retryable: false, details: {} } });
const chat = (over: Record<string, unknown> = {}) => ({ thread_id: 'chat-abc', memory: true, reply: 'ok', messages_seen_by_model: 1, history_len: 2, note: 'Memory ON', ...over });
beforeEach(() => (router.push as jest.Mock).mockClear());

/* ------------------------------------------------------------------ thread memory */
describe('Thread memory (U3-1)', () => {
  it('memory ON: the first turn creates a stable thread_id and the follow-up reuses it', async () => {
    const bodies: any[] = [];
    await renderWithBackend(<MemoryScreen />, { ...BACKEND_UP, 'POST /api/chat': (b: any) => { bodies.push(b); return res(200, chat(bodies.length === 1 ? { reply: 'noted', messages_seen_by_model: 1 } : { reply: 'You said row 1, column 2.', messages_seen_by_model: 3, history_len: 4 })); } });
    expect(t('thread-id')).toHaveTextContent(rx('none yet'));
    await type('chat-input', 'My start cell is row 1, column 2.'); await press('chat-send');
    await waitFor(() => expect(t('turn-0')).toBeTruthy());
    expect(t('thread-id')).toHaveTextContent(rx('chat-abc'));
    await type('chat-input', 'Which cell did I say?'); await press('chat-send');
    await waitFor(() => expect(t('turn-1')).toBeTruthy());
    expect(bodies[0]).toMatchObject({ memory: true, thread_id: null });
    expect(bodies[1]).toMatchObject({ memory: true, thread_id: 'chat-abc' });                // stable thread_id
    expect(t('turn-meta-1')).toHaveTextContent(rx('memory ON · the model received 3 message(s) · history 4'));
    expect(t('turn-1')).toHaveTextContent(rx('You said row 1, column 2.'));
  });

  it('memory OFF: no thread_id is sent and the model sees only the one message', async () => {
    const bodies: any[] = [];
    await renderWithBackend(<MemoryScreen />, { ...BACKEND_UP, 'POST /api/chat': (b: any) => { bodies.push(b); return res(200, chat({ thread_id: null, memory: false, reply: 'I do not know.', messages_seen_by_model: 1, history_len: 2 })); } });
    await press('mem-off');
    await type('chat-input', 'Which cell did I say?'); await press('chat-send');
    await waitFor(() => expect(t('turn-0')).toBeTruthy());
    expect(bodies[0]).toMatchObject({ memory: false, thread_id: null });
    expect(t('turn-meta-0')).toHaveTextContent(rx('memory OFF · the model received 1 message(s)'));
    expect(t('thread-id')).toHaveTextContent(rx('none yet'));
  });

  it('the amnesia demo shows the same follow-up with memory ON and OFF side by side', async () => {
    const calls: any[] = [];
    await renderWithBackend(<MemoryScreen />, { ...BACKEND_UP, 'POST /api/chat': (b: any) => {
      calls.push(b);
      if (!b.memory) return res(200, chat({ thread_id: null, memory: false, reply: b.message.startsWith('Which') ? 'You did not say.' : 'ok', messages_seen_by_model: 1 }));
      return res(200, chat(b.thread_id ? { reply: 'Row 1, column 2.', messages_seen_by_model: 3, history_len: 4 } : { reply: 'noted' }));
    } });
    await press('run-demo');
    await waitFor(() => expect(t('demo-result')).toBeTruthy());
    expect(calls.map((c) => c.memory)).toEqual([true, true, false, false]);
    expect(calls[1].thread_id).toBe('chat-abc');
    expect(calls[3].message).toBe(calls[1].message);                                           // identical follow-up
    expect(t('demo-on')).toHaveTextContent(rx('model received 3 message(s)'));
    expect(t('demo-on')).toHaveTextContent(rx('Row 1, column 2.'));
    expect(t('demo-off')).toHaveTextContent(rx('model received 1 message(s)'));
    expect(t('demo-off')).toHaveTextContent(rx('You did not say.'));
  });

  it('restores a thread from its checkpoint, and explains an unknown thread', async () => {
    await renderWithBackend(<MemoryScreen />, { ...BACKEND_UP, 'GET /api/chat/chat-abc': { thread_id: 'chat-abc', messages: [{ role: 'human', content: 'remember 3' }, { role: 'ai', content: 'ok' }], puzzle: SAMPLE, restored_from_checkpoint: true },
      'GET /api/chat/chat-nope': () => err('THREAD_NOT_FOUND', 'thread was not found', 404) });
    await type('restore-input', 'chat-abc'); await press('restore');
    await waitFor(() => expect(t('restored')).toBeTruthy());
    expect(t('restored')).toHaveTextContent(rx('Restored 2 message(s) from the checkpoint of chat-abc.'));
    expect(t('restored')).toHaveTextContent(rx('human: remember 3'));
    await type('restore-input', 'chat-nope'); await press('restore');
    await waitFor(() => expect(t('thread-error')).toHaveTextContent(rx('No checkpoint exists for that thread_id.')));
  });

  it('shows the empty state, and the Ollama-unavailable state when the model cannot be reached', async () => {
    await renderWithBackend(<MemoryScreen />, { ...BACKEND_UP, 'POST /api/chat': () => err('OLLAMA_UNAVAILABLE', 'The local Ollama service could not be reached.', 503) });
    expect(t('no-thread')).toBeTruthy();
    await type('chat-input', 'hi'); await press('chat-send');
    await waitFor(() => expect(t('thread-error')).toHaveTextContent(rx('Ollama is unavailable')));
    expect(screen.queryByTestId('turn-0')).toBeNull();
  });

  it('cannot send while the backend is down, and says so', async () => {
    await renderWithBackend(<MemoryScreen />, BACKEND_UP, { down: true });
    await waitFor(() => expect(t('mem-offline')).toBeTruthy());
    await type('chat-input', 'hi');
    expect(t('chat-send').props.accessibilityState.disabled).toBe(true);
  });
});

/* ------------------------------------------------------------------ long-term memory */
const rec = (id: number, kind: string, over: Record<string, unknown> = {}) => ({ memory_id: id, user_id: 'demo-user', kind, memory_key: `k${id}`, payload: { value: `v${id}` }, created_at: `2026-11-20T10:0${id}:00Z`, last_used_at: null, use_count: 0, ...over });

describe('Long-term memory (U3-2)', () => {
  const open = async (routes: Record<string, unknown>, opts: { down?: boolean } = {}) => { await renderWithBackend(<MemoryScreen />, { ...BACKEND_UP, ...routes }, opts); await press('mtab-long'); };

  it('shows namespaces with created / last-used timestamps and use counts, verbatim', async () => {
    await open({ 'GET /api/memory': [rec(1, 'profile'), rec(2, 'dead_ends', { last_used_at: '2026-11-20T11:30:00Z', use_count: 4 }), rec(3, 'puzzle_history')] });
    await waitFor(() => expect(t('ns-profile')).toBeTruthy());
    expect(t('ns-profile')).toHaveTextContent(rx('Namespace (demo-user, "profile") · 1'));
    expect(t('ns-dead_ends')).toBeTruthy();
    expect(t('ns-puzzle_history')).toBeTruthy();
    expect(t('created-1')).toHaveTextContent(rx('2026-11-20T10:01:00Z'));
    expect(t('used-1')).toHaveTextContent(rx('never used'));
    expect(t('used-2')).toHaveTextContent(rx('2026-11-20T11:30:00Z'));
    expect(t('mem-2')).toHaveTextContent(rx('4'));
    expect(t('mem-1')).toHaveTextContent(rx('{"value":"v1"}'));
  });

  it('no-memory state', async () => {
    await open({ 'GET /api/memory': [] });
    await waitFor(() => expect(t('no-memories')).toBeTruthy());
    expect(t('no-memories')).toHaveTextContent(rx('Nothing is stored for "demo-user"'));
  });

  it('delete asks for confirmation, then calls the backend for that user only', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    let deleted: string | null = null;
    await open({ 'GET /api/memory': [rec(1, 'profile')], 'DELETE /api/memory/1': (_b: any, url: string) => { deleted = url; return res(204, undefined); } });
    await waitFor(() => expect(t('del-1')).toBeTruthy());
    await press('del-1');
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe('Delete this memory?');
    expect(deleted).toBeNull();                                       // nothing deleted before confirmation
    alert.mock.calls[0][2]!.find((b) => b.style === 'cancel')!.onPress?.();
    expect(deleted).toBeNull();
    alert.mock.calls[0][2]!.find((b) => b.text === 'Delete')!.onPress?.();
    await waitFor(() => expect(deleted).toMatch(/\/api\/memory\/1\?user_id=demo-user$/));
    await waitFor(() => expect(t('mem-msg')).toHaveTextContent(rx('Memory deleted.')));
    alert.mockRestore();
  });

  it('Clear demo data requires confirmation and then sends confirm=true', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    let cleared: string | null = null;
    await open({ 'GET /api/memory': [rec(1, 'profile')], 'DELETE /api/memory': (_b: any, url: string) => { cleared = url; return res(200, { deleted: 1 }); } });
    await waitFor(() => expect(t('clear-mem')).toBeTruthy());
    await press('clear-mem');
    expect(alert.mock.calls[0][0]).toBe('Clear all demo data?');
    expect(alert.mock.calls[0][1]).toMatch(/cannot be undone/);
    expect(cleared).toBeNull();
    alert.mock.calls[0][2]!.find((b) => b.text === 'Clear all')!.onPress?.();
    await waitFor(() => expect(cleared).toMatch(/user_id=demo-user&confirm=true$/));
    await waitFor(() => expect(t('mem-msg')).toHaveTextContent(rx('Cleared 1 memories.')));
    alert.mockRestore();
  });

  it('adds a profile memory in the (user, "profile") namespace', async () => {
    let body: any;
    await open({ 'GET /api/memory': [], 'POST /api/memory': (b: any) => { body = b; return res(201, rec(9, 'profile')); } });
    await type('mem-key', 'level'); await type('mem-val', 'beginner'); await press('mem-add');
    await waitFor(() => expect(body).toEqual({ user_id: 'demo-user', kind: 'profile', key: 'level', payload: { value: 'beginner' } }));
  });

  it('shows backend errors and the offline state', async () => {
    await open({ 'GET /api/memory': () => err('INTERNAL_ERROR', 'An internal error occurred.') });
    await waitFor(() => expect(t('mem-error')).toHaveTextContent(rx('An internal error occurred.')));
  });

  it('offline', async () => {
    await open({}, { down: true });
    await waitFor(() => expect(t('mem-offline')).toBeTruthy());
  });
});

/* ------------------------------------------------------------------ dead-end library + stale pattern */
describe('Dead-end library and memory use (U3-2, spec 6.7)', () => {
  const pat = (id: number, over: Record<string, unknown> = {}) => rec(id, 'dead_ends', { memory_key: `p${id}`, payload: { givens: [[0, 2, 3]], cell: [0, 1], value: 2, reason_code: 'ZERO_CANDIDATES', ...over } });
  const done = (counters: Record<string, number>, over: Record<string, unknown> = {}) => run({ run_id: 'run-m', mode: 'tot', status: 'completed', config: { use_memory: true, user_id: 'demo-user' }, result: { ...run().result, counters, vote: null }, ...over });
  const open = async (routes: Record<string, unknown>) => { await renderWithBackend(<MemoryScreen />, { ...BACKEND_UP, ...routes }); await press('mtab-dead'); };

  it('lists remembered patterns with usage, and flags a deliberately wrong one', async () => {
    await open({ 'GET /api/memory': [pat(1), pat(2, { demo_stale: true })] });
    await waitFor(() => expect(t('dead-1')).toBeTruthy());
    expect(t('dead-1')).toHaveTextContent(rx('cell [0, 1] = 2 · ZERO_CANDIDATES'));
    expect(t('dead-1')).toHaveTextContent(rx('1 givens'));
    expect(t('dead-2')).toHaveTextContent(rx('DEMO STALE PATTERN (deliberately wrong)'));
  });

  it('empty library state', async () => {
    await open({ 'GET /api/memory': [] });
    await waitFor(() => expect(t('no-dead-ends')).toBeTruthy());
  });

  it('recall: shows which memory was retrieved and how it was used (confirmed after deterministic re-verification)', async () => {
    const bodies: any[] = [];
    await open({ 'GET /api/memory': [pat(1)], 'POST /api/solve/tot': (b: any) => { bodies.push(b); return res(202, done({}, { status: 'running' })); },
      'GET /api/solve/run-m': done({ memory_confirmed: 2, memory_rejected: 0, dead_ends: 0 }),
      'GET /api/solve/run-m/trace': trace([ev(4, 'memory_hit_confirmed', { reason_code: 'MEMORY_CONFIRMED', reason: 'remembered dead end re-confirmed deterministically', data: { pattern_id: 1 } })]) });
    await press('lab-recall');
    await waitFor(() => expect(t('lab-result')).toBeTruthy(), { timeout: 5000 });
    expect(bodies[0]).toEqual({ board: SAMPLE, strategy: 'first_empty', order: 'desc', use_memory: true, user_id: 'demo-user' });
    expect(t('lab-confirmed')).toHaveTextContent(rx('2 remembered dead end(s) re-verified and pruned'));
    expect(t('lab-event-4')).toHaveTextContent(rx('memory_hit_confirmed · pattern 1'));
    expect(t('lab-event-4')).toHaveTextContent(rx('[MEMORY_CONFIRMED] remembered dead end re-confirmed deterministically'));
    expect(t('lab-outcome')).toHaveTextContent(rx('solved (verified solution found)'));
  });

  it('a STALE pattern is added, ignored by the search, and the valid branch is still solved', async () => {
    const order: string[] = [];
    await open({ 'GET /api/memory': [], 'POST /api/memory/demo/stale-pattern': (b: any) => { order.push('stale'); expect(b).toEqual({ board: SAMPLE, user_id: 'demo-user' }); return res(201, pat(5, { demo_stale: true })); },
      'POST /api/solve/tot': () => { order.push('run'); return res(202, done({}, { status: 'running' })); },
      'GET /api/solve/run-m': done({ memory_confirmed: 0, memory_rejected: 1 }),
      'GET /api/solve/run-m/trace': trace([ev(6, 'memory_hit_rejected', { reason_code: 'MEMORY_STALE', reason: 'remembered pattern did not hold for the current board; ignored', data: { pattern_id: 5 } })]) });
    await press('lab-stale');
    await waitFor(() => expect(t('lab-result')).toBeTruthy(), { timeout: 5000 });
    expect(order).toEqual(['stale', 'run']);                                                    // pattern stored first, then the run
    expect(t('lab-rejected')).toHaveTextContent(rx('1 stale pattern(s) ignored'));
    expect(t('lab-confirmed')).toHaveTextContent(rx('0 remembered dead end(s)'));
    expect(t('lab-event-6')).toHaveTextContent(rx('[MEMORY_STALE]'));
    expect(t('lab-outcome')).toHaveTextContent(rx('solved (verified solution found)'));       // the correct branch was not pruned
    await press('lab-open');
    expect(router.push).toHaveBeenCalledWith({ pathname: '/run/[runId]', params: { runId: 'run-m' } });
  });

  it('says so when no memory was retrieved in the run', async () => {
    await open({ 'GET /api/memory': [], 'POST /api/solve/tot': () => res(202, done({}, { status: 'running' })), 'GET /api/solve/run-m': done({ memory_confirmed: 0, memory_rejected: 0 }), 'GET /api/solve/run-m/trace': trace([ev(0, 'search_started')]) });
    await press('lab-learn');
    await waitFor(() => expect(t('lab-no-events')).toBeTruthy(), { timeout: 5000 });
  });

  it('a failing run start is reported', async () => {
    await open({ 'GET /api/memory': [], 'POST /api/solve/tot': () => err('INTERNAL_ERROR', 'An internal error occurred.') });
    await press('lab-learn');
    await waitFor(() => expect(t('dead-error')).toHaveTextContent(rx('An internal error occurred.')));
  });
});

/* ------------------------------------------------------------------ RAG */
const chunk = (n: number, sim: number, heading: string) => ({ chunk_id: `sudoku-chunk-${n}`, heading, text: `text of chunk ${n}`, similarity: sim, distance: 1 - sim });
const answered = (k: number, over: Record<string, unknown> = {}) => ({ query: 'q', k, answer: 'The Backtracker restores the board after a contradiction.', abstained: false, reason_code: 'GROUNDED',
  evidence: [chunk(5, 0.84, 'CHUNK 5: BACKTRACKING'), chunk(3, 0.7, 'CHUNK 3: DEAD-END PATTERN A'), chunk(2, 0.6, 'CHUNK 2: CANDIDATES')].slice(0, k),
  retrieved_chunk_ids: ['sudoku-chunk-5', 'sudoku-chunk-3', 'sudoku-chunk-2'].slice(0, k), top_similarity: 0.84, threshold: 0.53, llm_calls: 1, ...over });

describe('RAG Knowledge (U3-3)', () => {
  const open = async (routes: Record<string, unknown>, opts: { down?: boolean } = {}) => { await renderWithBackend(<MemoryScreen />, { ...BACKEND_UP, ...routes }, opts); await press('mtab-rag'); };

  it('shows the grounded answer, "Evidence used" chunk IDs and a card per retrieved chunk, using the selected k', async () => {
    const bodies: any[] = [];
    await open({ 'POST /api/rag/query': (b: any) => { bodies.push(b); return res(200, answered(b.k)); } });
    expect(t('rag-empty')).toBeTruthy();
    await type('rag-input', 'What does backtracking restore?');
    await press('k-3'); await press('rag-ask');
    await waitFor(() => expect(t('rag-text')).toBeTruthy());
    expect(bodies[0]).toEqual({ query: 'What does backtracking restore?', k: 3 });
    expect(t('rag-text')).toHaveTextContent(rx('The Backtracker restores the board after a contradiction.'));
    expect(t('rag-used')).toHaveTextContent(rx('sudoku-chunk-5, sudoku-chunk-3, sudoku-chunk-2'));
    for (const n of [5, 3, 2]) expect(t(`rag-chunk-sudoku-chunk-${n}`)).toBeTruthy();
    expect(t('rag-chunk-sudoku-chunk-5')).toHaveTextContent(rx('CHUNK 5: BACKTRACKING'));
    expect(t('rag-chunk-sudoku-chunk-5')).toHaveTextContent(rx('similarity 0.84'));
    expect(t('rag-answer')).toHaveTextContent(rx('GROUNDED · best similarity 0.84 (threshold 0.53) · 1 model call(s)'));
    expect(screen.queryByTestId('rag-abstain')).toBeNull();
    expect(t('rag-used-title')).toHaveTextContent('Evidence used');
  });

  it('k=1 retrieves one chunk', async () => {
    const bodies: any[] = [];
    await open({ 'POST /api/rag/query': (b: any) => { bodies.push(b); return res(200, answered(b.k)); } });
    await type('rag-input', 'q'); await press('k-1'); await press('rag-ask');
    await waitFor(() => expect(t('rag-text')).toBeTruthy());
    expect(bodies[0].k).toBe(1);
    expect(screen.queryByTestId('rag-chunk-sudoku-chunk-3')).toBeNull();
  });

  it('compares k=1 and k=3 side by side with two backend calls', async () => {
    const ks: number[] = [];
    await open({ 'POST /api/rag/query': (b: any) => { ks.push(b.k); return res(200, answered(b.k)); } });
    await type('rag-input', 'What does backtracking restore?'); await press('rag-compare');
    await waitFor(() => expect(t('rag-compare-result')).toBeTruthy());
    expect(ks.sort()).toEqual([1, 3]);
    expect(t('rag-k1-used')).toHaveTextContent(rx('sudoku-chunk-5'));
    expect(t('rag-k3-used')).toHaveTextContent(rx('sudoku-chunk-5, sudoku-chunk-3, sudoku-chunk-2'));
  });

  it('an unanswerable question shows "I don\'t know." with the reason, and still shows what was retrieved', async () => {
    await open({ 'POST /api/rag/query': (b: any) => res(200, { query: b.query, k: 3, answer: "I don't know.", abstained: true, reason_code: 'LOW_RELEVANCE', evidence: [chunk(8, 0.41, 'CHUNK 8: VOTING')], retrieved_chunk_ids: ['sudoku-chunk-8'], top_similarity: 0.41, threshold: 0.53, llm_calls: 0 }) });
    await press('ex-unanswerable');
    expect((screen.getByTestId('rag-input').props.value as string)).toBe('Who won the 2018 football world cup?');
    await press('rag-ask');
    await waitFor(() => expect(t('rag-text')).toHaveTextContent(rx("I don't know.")));
    expect(t('rag-abstain')).toHaveTextContent(rx('says it does not know instead of guessing'));
    expect(t('rag-answer')).toHaveTextContent(rx('LOW_RELEVANCE · best similarity 0.41 (threshold 0.53) · 0 model call(s)'));
    expect(t('rag-used')).toHaveTextContent(rx('sudoku-chunk-8'));
    expect(t('rag-used-title')).toHaveTextContent(rx('Retrieved, but NOT used'));
  });

  it('no-RAG-result state when nothing was retrieved', async () => {
    await open({ 'POST /api/rag/query': answered(3, { answer: "I don't know.", abstained: true, reason_code: 'LOW_RELEVANCE', evidence: [], retrieved_chunk_ids: [], top_similarity: null }) });
    await type('rag-input', 'anything'); await press('rag-ask');
    await waitFor(() => expect(t('rag-none')).toBeTruthy());
    expect(t('rag-used')).toHaveTextContent(rx('No chunks were retrieved.'));
  });

  it('Ollama unavailable is explained with what to do; the vector-store failure is distinguished', async () => {
    await open({ 'POST /api/rag/query': () => err('OLLAMA_UNAVAILABLE', 'The local Ollama service could not be reached.', 503) });
    await type('rag-input', 'q'); await press('rag-ask');
    await waitFor(() => expect(t('rag-error')).toHaveTextContent(rx('Ollama is unavailable')));
    expect(t('rag-ollama')).toHaveTextContent(rx('qwen2.5:3b and nomic-embed-text'));
    expect(screen.queryByTestId('rag-text')).toBeNull();
  });

  it('vector store unavailable', async () => {
    await open({ 'POST /api/rag/query': () => err('VECTOR_STORE_UNAVAILABLE', 'The knowledge store is unavailable.', 503) });
    await type('rag-input', 'q'); await press('rag-ask');
    await waitFor(() => expect(t('rag-error')).toHaveTextContent(rx('The knowledge store is unavailable.')));
    expect(screen.queryByTestId('rag-ollama')).toBeNull();
  });

  it('an empty question cannot be sent, and a down backend disables asking', async () => {
    await open({ 'POST /api/rag/query': answered(3) });
    expect(t('rag-ask').props.accessibilityState.disabled).toBe(true);
    await type('rag-input', '   ');
    expect(t('rag-ask').props.accessibilityState.disabled).toBe(true);
  });

  it('backend unreachable', async () => {
    await open({}, { down: true });
    await waitFor(() => expect(t('mem-offline')).toBeTruthy());
    await type('rag-input', 'q');
    expect(t('rag-ask').props.accessibilityState.disabled).toBe(true);
  });
});
