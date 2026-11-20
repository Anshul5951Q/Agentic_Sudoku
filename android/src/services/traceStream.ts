import type { TraceEvent } from '@/types/api';

/**
 * WebSocket client for /ws/solve/{run_id} (docs/API.md section 5).
 * - Events are accepted only if their sequence is greater than the last one seen, so nothing is ever duplicated.
 * - If the socket drops before the terminal message, missed events are fetched over REST (trace?after=) and the
 *   socket reconnects with ?after=<last sequence>, using exponential backoff.
 * - The terminal message (success / failure / cancel) ends the stream; there is no reconnect after it.
 */
export type ConnState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

export interface Terminal { status: string; outcome: string | null; verified: boolean | null; last_sequence: number }

export interface TraceStreamOptions {
  url: (after: number) => string;
  fetchMissed: (after: number) => Promise<TraceEvent[]>;
  onEvents: (events: TraceEvent[]) => void;
  onStatus?: (status: string) => void;
  onTerminal?: (t: Terminal) => void;
  onConnection?: (state: ConnState, attempt: number, detail?: string) => void;
  WebSocketImpl?: typeof WebSocket;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
}

export const wsUrlFor = (baseUrl: string, runId: string) => (after: number) =>
  `${baseUrl.replace(/^http/i, 'ws')}/ws/solve/${encodeURIComponent(runId)}?after=${after}`;

export class TraceStream {
  lastSeq = -1;
  attempt = 0;
  private ws: WebSocket | null = null;
  private stopped = false;
  private terminal = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private o: TraceStreamOptions) {}

  /** Accept events in order, never twice. Returns the accepted ones. */
  accept(events: TraceEvent[]): TraceEvent[] {
    const fresh = [...events].sort((a, b) => a.sequence - b.sequence).filter((e) => {
      if (e.sequence <= this.lastSeq) return false;
      this.lastSeq = e.sequence;
      return true;
    });
    if (fresh.length) this.o.onEvents(fresh);
    return fresh;
  }

  start(after = -1): void {
    this.lastSeq = Math.max(this.lastSeq, after);
    this.stopped = false;
    this.terminal = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) { try { ws.close(); } catch { /* already closed */ } }
  }

  get finished(): boolean { return this.terminal; }

  private connect(): void {
    if (this.stopped) return;
    const Impl = this.o.WebSocketImpl ?? WebSocket;
    this.o.onConnection?.(this.attempt ? 'reconnecting' : 'connecting', this.attempt);
    let ws: WebSocket;
    try { ws = new Impl(this.o.url(this.lastSeq)); } catch { this.scheduleReconnect(); return; }
    this.ws = ws;
    ws.onopen = () => { this.attempt = 0; this.o.onConnection?.('open', 0); };
    ws.onmessage = (m: { data: unknown }) => {
      let msg: any;
      try { msg = JSON.parse(String(m.data)); } catch { return; }
      if (msg.type === 'event' && msg.event) this.accept([msg.event]);
      else if (msg.type === 'status') this.o.onStatus?.(msg.status);
      else if (msg.type === 'terminal') {
        this.terminal = true;
        this.o.onTerminal?.(msg as Terminal);
        this.o.onConnection?.('closed', 0);
        this.stop();
      } else if (msg.type === 'error') {
        this.terminal = true;                       // e.g. unknown run: reconnecting would not help
        this.o.onConnection?.('error', 0, msg.error?.message ?? 'stream error');
        this.stop();
      }
    };
    ws.onerror = () => { /* onclose follows and handles reconnect */ };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (!this.stopped && !this.terminal) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.attempt += 1;
    if (this.o.maxAttempts && this.attempt > this.o.maxAttempts) {
      this.o.onConnection?.('error', this.attempt, 'could not reconnect to the live stream');
      return;
    }
    const delay = Math.min((this.o.baseDelayMs ?? 500) * 2 ** (this.attempt - 1), this.o.maxDelayMs ?? 8000);
    this.o.onConnection?.('reconnecting', this.attempt);
    this.timer = setTimeout(async () => {
      try { this.accept(await this.o.fetchMissed(this.lastSeq)); } catch { /* backend may still be down; the socket retry decides */ }
      this.connect();
    }, delay);
  }
}
