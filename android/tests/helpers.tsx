import { render } from '@testing-library/react-native';
import React from 'react';
import { ConnectionProvider } from '@/state/ConnectionContext';
import type { RuntimeStatus } from '@/types/api';

export const SAMPLE = [[0, 0, 3, 4], [3, 4, 0, 0], [0, 1, 4, 0], [4, 0, 0, 1]];
export const SOLVED = [[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]];

export const res = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) }) as unknown as Response;

export const RUNTIME_OK: RuntimeStatus = {
  backend: { name: 'backend', status: 'up', detail: null },
  ollama: { name: 'ollama', status: 'up', detail: null },
  models: [{ name: 'qwen2.5:3b', status: 'up', detail: null }, { name: 'nomic-embed-text', status: 'up', detail: null }],
  vector_store: { name: 'chromadb', status: 'up', detail: '15 chunks indexed' },
  database: { name: 'sqlite', status: 'up', detail: null },
  ready_for_llm: true, ready_for_rag: true,
};

export const SUMMARY = {
  sessions_saved: 3, puzzles_total: 3, runs_total: 4, puzzles_solved: 2, verified_runs: 3, average_solve_seconds: 0.0123,
  search_nodes_explored: 53, dead_end_branches: 4, branches_pruned: 4, backtracks: 4, llm_calls: 1, tool_calls: 0,
};

export const SESSION = {
  session_id: 'session-aaa', puzzle_id: 'puzzle-aaa', title: 'sample', board: SAMPLE, created_at: '2026-11-20T10:00:00Z',
  updated_at: '2026-11-20T10:05:00Z', runs_count: 1,
  last_run: { run_id: 'run-1', mode: 'tot', status: 'completed', created_at: '', finished_at: '', outcome: 'solved', verified: true, nodes: 11, elapsed_seconds: 0.01 },
};

export type Handler = (body: any, url: string) => Response | Promise<Response>;

/** A fake backend. `routes` maps "METHOD /path" to a handler; `{ down: true }` simulates an unreachable backend. */
export function fakeBackend(routes: Record<string, Handler | unknown>, opts: { down?: boolean } = {}) {
  const state = { down: !!opts.down, calls: [] as string[] };
  const fetchImpl = jest.fn(async (url: string, init?: any) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const key = `${init?.method ?? 'GET'} ${path.split('?')[0]}`;
    state.calls.push(key);
    if (state.down) throw new TypeError('Network request failed');
    const h = routes[key];
    if (h === undefined) return res(404, { error: { code: 'NOT_FOUND', message: 'not found', recoverable: true, retryable: false, details: {} } });
    if (typeof h === 'function') return (h as Handler)(init?.body ? JSON.parse(init.body) : undefined, url);
    return res(200, h);
  });
  return { fetchImpl: fetchImpl as unknown as (u: string, i?: any) => Promise<Response>, state, mock: fetchImpl };
}

export async function renderWithBackend(ui: React.ReactElement, routes: Record<string, Handler | unknown>, opts: { down?: boolean } = {}) {
  const be = fakeBackend(routes, opts);
  const utils = await render(
    <ConnectionProvider pollMs={60000} fetchImpl={be.fetchImpl as any} initial={{ override: null, env: 'http://test-host:8000', hostUri: null, platform: 'android' }}>
      {ui}
    </ConnectionProvider>,
  );
  return { ...utils, be };
}

export const HEALTH = { status: 'ok', service: 'sudokumind-api', version: '1.0.0', time: 'now' };
export const BACKEND_UP = { 'GET /api/health': HEALTH, 'GET /api/runtime/status': RUNTIME_OK };

/** Backend validate handler that reports duplicates the way the real API does. */
export const validateHandler = (body: { board: number[][] }) => {
  const conflicts: any[] = [];
  const b = body.board;
  for (let r = 0; r < 4; r++) for (let v = 1; v <= 4; v++) {
    const cells = [0, 1, 2, 3].filter((c) => b[r][c] === v);
    if (cells.length > 1) conflicts.push({ kind: 'row', index: r, value: v, cells: cells.map((c) => [r, c]) });
  }
  const empties = b.flat().filter((x) => x === 0).length;
  const solved = !conflicts.length && empties === 0;
  return res(200, { valid: !conflicts.length, complete: empties === 0, solved, empties, conflicts,
    message: conflicts.length ? `${conflicts.length} duplicate(s) found; the board breaks the Sudoku rules.` : `No rule violations so far; ${empties} empty cell(s) remain.` });
};
