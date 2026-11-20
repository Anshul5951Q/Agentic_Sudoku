import { buildFrames, outline, solverEvents, variantsOf } from '@/state/timeline';
import { TraceStream } from '@/services/traceStream';

/* Real traces recorded from the backend (tests/recorded/*.json). */
const tot = require('./recorded/tot-sample.json');
const multi = require('./recorded/multi-sample.json');
const limit = require('./recorded/tot-limit.json');

describe('timeline replay of a REAL recorded ToT trace', () => {
  const frames = buildFrames(tot.trace.events);
  const final = frames[frames.length - 1];

  it('has one frame per event and starts from the original puzzle', () => {
    expect(frames).toHaveLength(tot.trace.events.length);
    expect(frames[0].board).toEqual(tot.run.board);
  });

  it('ends on the backend\'s verified solution', () => {
    expect(final.verified).toBe(true);
    expect(final.solution).toEqual(tot.run.result.solution);
    expect(final.board).toEqual(tot.run.result.solution);
    expect(final.terminal).toMatchObject({ event: 'search_completed', code: 'SOLVED' });
  });

  it('reproduces the backend\'s own counters exactly (nothing is estimated)', () => {
    const c = tot.run.result.counters;
    expect(final.counters.proposed).toBe(c.candidates_proposed);
    expect(final.counters.deadEnds).toBe(c.dead_ends);
    expect(final.counters.backtracks).toBe(c.backtracks);
    expect(final.counters.pruned).toBe(c.pruned);
    expect(final.counters.rejected).toBe(c.rule_violations);
  });

  it('builds the same tree as the backend: same nodes, same parents, same final statuses', () => {
    const backend = Object.fromEntries(tot.trace.nodes.map((n: any) => [n.node_id, n]));
    expect(Object.keys(final.nodes).sort()).toEqual(Object.keys(backend).sort());
    for (const n of Object.values(final.nodes)) {
      expect(n.parent).toBe(backend[n.id].parent_node_id);
      expect(n.status).toBe(backend[n.id].status);
    }
  });

  it('restores the exact recorded board on every backtrack', () => {
    tot.trace.events.forEach((e: any, i: number) => { if (e.event === 'backtrack_started') expect(frames[i].board).toEqual(e.board_snapshot); });
    expect(tot.trace.events.filter((e: any) => e.event === 'backtrack_started')).toHaveLength(2);
  });

  it('marks dead ends with the backend reason and shows them in the outline', () => {
    const dead = Object.values(final.nodes).filter((n) => n.status === 'dead_end');
    expect(dead.length).toBe(2);
    expect(dead[0].reasonCode).toBe('ZERO_CANDIDATES');
    const rows = outline(final.nodes, new Set());
    expect(rows).toHaveLength(Object.keys(final.nodes).length);
    expect(rows[0].node.parent).toBeNull();
    const collapsedRows = outline(final.nodes, new Set([rows[0].node.id]));
    expect(collapsedRows).toHaveLength(1);
  });

  it('frames are snapshots: earlier frames are not changed by later events', () => {
    const firstAccepted = frames.findIndex((f) => f.event.event === 'candidate_accepted');
    expect(frames[0].board).toEqual(tot.run.board);
    expect(frames[firstAccepted].board).not.toEqual(tot.run.board);
  });
});

describe('multi-agent and failed runs', () => {
  it('splits a multi-agent trace into its candidate-order variants, each ending verified', () => {
    const vs = variantsOf(multi.trace.events);
    expect(vs.sort()).toEqual(['variant-asc', 'variant-desc', 'variant-middle']);
    for (const v of vs) {
      const f = buildFrames(solverEvents(multi.trace.events, v));
      expect(f[f.length - 1].verified).toBe(true);
      expect(f[f.length - 1].solution).toEqual(multi.run.result.solution);
    }
  });

  it('a run that hit its node budget ends with the backend failure, not a solution', () => {
    const f = buildFrames(limit.trace.events);
    const last = f[f.length - 1];
    expect(last.verified).toBe(false);
    expect(last.terminal).toMatchObject({ event: 'search_failed', code: 'MAX_NODES' });
  });
});

/* ------------------------------------------------------------------ WebSocket client */
class FakeWS {
  static all: FakeWS[] = [];
  onopen?: () => void; onmessage?: (m: { data: string }) => void; onclose?: () => void; onerror?: () => void;
  closed = false;
  constructor(public url: string) { FakeWS.all.push(this); }
  close() { this.closed = true; }
  open() { this.onopen?.(); }
  send(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  drop() { this.onclose?.(); }
}
const evs = tot.trace.events;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };   // microtasks only (timers are faked)

describe('TraceStream (WebSocket client)', () => {
  beforeEach(() => { FakeWS.all = []; jest.useFakeTimers(); });
  afterEach(() => jest.useRealTimers());

  const make = (fetchMissed = jest.fn(async (_a: number) => [] as any[])) => {
    const got: any[] = []; const conn: string[] = []; const terminal: any[] = [];
    const s = new TraceStream({ url: (a) => `ws://h/ws/solve/r?after=${a}`, fetchMissed, onEvents: (e) => got.push(...e), onConnection: (st) => conn.push(st), onTerminal: (t) => terminal.push(t), WebSocketImpl: FakeWS as any, baseDelayMs: 100 });
    return { s, got, conn, terminal, fetchMissed };
  };

  it('accepts events in order and never twice', () => {
    const { s, got } = make();
    s.start(-1); FakeWS.all[0].open();
    FakeWS.all[0].send({ type: 'event', event: evs[0] });
    FakeWS.all[0].send({ type: 'event', event: evs[1] });
    FakeWS.all[0].send({ type: 'event', event: evs[1] });          // duplicate
    FakeWS.all[0].send({ type: 'event', event: evs[0] });          // older
    expect(got.map((e) => e.sequence)).toEqual([0, 1]);
  });

  it('after a drop it fetches missed events over REST, then reconnects with ?after=<last sequence>, without duplicates', async () => {
    const fetchMissed = jest.fn(async (after: number) => evs.slice(after + 1, after + 4));
    const { s, got, conn } = make(fetchMissed);
    s.start(-1); FakeWS.all[0].open();
    for (let i = 0; i < 5; i++) FakeWS.all[0].send({ type: 'event', event: evs[i] });
    FakeWS.all[0].drop();
    expect(conn).toContain('reconnecting');
    jest.advanceTimersByTime(100); await flush();
    expect(fetchMissed).toHaveBeenCalledWith(4);
    expect(FakeWS.all[1].url).toBe('ws://h/ws/solve/r?after=7');       // 3 missed events were fetched first
    FakeWS.all[1].open();
    FakeWS.all[1].send({ type: 'event', event: evs[7] });               // the server repeats one we already had
    FakeWS.all[1].send({ type: 'event', event: evs[8] });
    expect(got.map((e) => e.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('backs off exponentially while the backend stays down', async () => {
    const { s } = make(jest.fn(async (_a: number): Promise<any[]> => { throw new Error('down'); }));
    s.start(-1); FakeWS.all[0].drop();
    jest.advanceTimersByTime(100); await flush(); expect(FakeWS.all).toHaveLength(2);
    FakeWS.all[1].drop();
    jest.advanceTimersByTime(150); await flush(); expect(FakeWS.all).toHaveLength(2);      // 200 ms now
    jest.advanceTimersByTime(60); await flush(); expect(FakeWS.all).toHaveLength(3);
    expect(s.attempt).toBe(2);
  });

  it('the terminal message ends the stream: no reconnect afterwards', async () => {
    const { s, terminal, conn } = make();
    s.start(-1); FakeWS.all[0].open();
    FakeWS.all[0].send({ type: 'terminal', status: 'completed', outcome: 'solved', verified: true, last_sequence: 49 });
    FakeWS.all[0].drop();
    jest.advanceTimersByTime(10000); await flush();
    expect(terminal).toHaveLength(1) ; expect(FakeWS.all).toHaveLength(1);
    expect(s.finished).toBe(true); expect(conn).toContain('closed');
  });

  it('an error message (unknown run) stops without retrying', async () => {
    const { s, conn } = make();
    s.start(-1); FakeWS.all[0].send({ type: 'error', error: { code: 'RUN_NOT_FOUND', message: 'run was not found' } });
    jest.advanceTimersByTime(10000); await flush();
    expect(conn).toContain('error'); expect(FakeWS.all).toHaveLength(1);
  });

  it('stop() closes the socket and cancels reconnects', async () => {
    const { s } = make();
    s.start(-1); FakeWS.all[0].drop(); s.stop();
    jest.advanceTimersByTime(10000); await flush();
    expect(FakeWS.all).toHaveLength(1);
  });

  it('ignores garbage frames', () => {
    const { s, got } = make();
    s.start(-1); FakeWS.all[0].onmessage?.({ data: 'not json' });
    expect(got).toHaveLength(0);
  });
});
