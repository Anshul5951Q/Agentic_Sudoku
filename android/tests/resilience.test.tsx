import { act, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AppState, Dimensions } from 'react-native';
import BundledReplayScreen from '@/screens/BundledReplayScreen';
import PlayScreen from '@/screens/PlayScreen';
import SearchTreeScreen from '@/screens/SearchTreeScreen';
import { BACKEND_UP, renderWithBackend, res } from './helpers';

const tot = require('./recorded/tot-sample.json');

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useLocalSearchParams: () => mockParams, useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]) }));
const t = (id: string) => screen.getByTestId(id);

class FakeWS {
  static all: FakeWS[] = [];
  onopen?: () => void; onmessage?: (m: { data: string }) => void; onclose?: () => void; onerror?: () => void;
  closed = false;
  constructor(public url: string) { FakeWS.all.push(this); }
  close() { this.closed = true; }
  async send(msg: unknown) { await act(async () => { this.onmessage?.({ data: JSON.stringify(msg) }); }); }
}

describe('App background / foreground during a live run', () => {
  it('drops the socket in the background, then catches up over REST and reconnects after the last event', async () => {
    FakeWS.all = [];
    mockParams = { runId: tot.run.run_id };
    const evs = tot.trace.events;
    let upto = 10;
    const afters: number[] = [];
    const handlers: ((s: string) => void)[] = [];
    const handler = (st: string) => handlers.forEach((h) => h(st));
    const original = AppState.addEventListener;
    (AppState as any).addEventListener = (_t: any, h: any) => { handlers.push(h); return { remove: () => undefined }; };
    await renderWithBackend(<SearchTreeScreen WebSocketImpl={FakeWS as any} />, {
      ...BACKEND_UP,
      [`GET /api/solve/${tot.run.run_id}`]: () => res(200, { ...tot.run, status: 'running', live: true, result: null }),
      [`GET /api/solve/${tot.run.run_id}/trace`]: (_b: unknown, url: string) => {
        const after = Number(new URL(url).searchParams.get('after'));
        afters.push(after);
        return res(200, { ...tot.trace, live: true, terminal: false, events: evs.slice(after + 1, upto) });
      },
    });
    await waitFor(() => expect(t('mode-live')).toBeTruthy());
    await act(async () => { FakeWS.all[0].onopen?.(); });
    await FakeWS.all[0].send({ type: 'event', event: evs[10] });
    await act(async () => { handler('background'); });
    expect(FakeWS.all[0].closed).toBe(true);                                // no socket kept open in the background
    upto = 20;                                                               // the run kept going on the backend
    await act(async () => { handler('active'); });
    await waitFor(() => expect(FakeWS.all.length).toBe(2));
    expect(afters[afters.length - 1]).toBe(10);                             // REST catch-up from the last event seen
    expect(FakeWS.all[1].url).toMatch(/after=19$/);                          // then the socket continues with no gap
    await waitFor(() => expect(t('frame-pos')).toHaveTextContent(/Step 20 of 20/));
    (AppState as any).addEventListener = original;
  });
});

describe('Bundled recorded replay (offline demo fallback)', () => {
  it('replays a real recorded trace with no backend and labels it as not live', async () => {
    await renderWithBackend(<BundledReplayScreen />, {}, { down: true });
    await waitFor(() => expect(t('mode-bundled')).toHaveTextContent(/RECORDED REPLAY bundled with the app.*NOT a live run/));
    expect(screen.queryByTestId('mode-live')).toBeNull();
    expect(screen.queryByTestId('tree-pause')).toBeNull();                  // no controls that would pretend to act on a run
    expect(t('frame-pos')).toHaveTextContent(`Step ${tot.trace.events.length} of ${tot.trace.events.length}`);
    expect(t('count-backtracks')).toHaveTextContent(String(tot.run.result.counters.backtracks));
  });
});

describe('Small-screen layout (320 x 568 dp)', () => {
  const orig = Dimensions.get('window');
  beforeAll(() => {
    jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 320, height: 568, scale: 2, fontScale: 1 });
  });
  afterAll(() => { (Dimensions.get as jest.Mock).mockRestore?.(); void orig; });

  it('fits the Play board inside the screen width with 48 dp touch targets', async () => {
    mockParams = {};
    await renderWithBackend(<PlayScreen />, BACKEND_UP);
    const board = screen.getAllByTestId('sudoku-board')[0];
    const w = [board.props.style].flat().reduce((a: any, s: any) => ({ ...a, ...(s || {}) }), {}).width;
    expect(w).toBeLessThanOrEqual(320 - 32);
    const cell = [t('cell-0-0').props.style].flat().reduce((a: any, s: any) => ({ ...a, ...(s || {}) }), {});
    expect(cell.width).toBeGreaterThanOrEqual(48);
  });

  it('fits the search-tree board inside the screen width', async () => {
    await renderWithBackend(<BundledReplayScreen />, {}, { down: true });
    await waitFor(() => expect(t('frame-card')).toBeTruthy());
    const boards = screen.getAllByTestId('sudoku-board');
    const w = [boards[0].props.style].flat().reduce((a: any, s: any) => ({ ...a, ...(s || {}) }), {}).width;
    expect(w).toBeLessThanOrEqual(320 - 32);
  });
});
