import type { TraceEvent } from '@/types/api';

/**
 * Turns the REAL stored trace into playback frames. Nothing is solved here: the board is replayed from the events the
 * backend recorded (accepted placements, restored snapshots on backtrack, the verified solution), and the tree is
 * built from candidate_proposed events (parent = the node whose cell was being expanded).
 */
export type NodeStatus = 'expanded' | 'pending' | 'accepted' | 'rejected' | 'dead_end' | 'pruned' | 'solution';

export interface TreeNode {
  id: string;
  parent: string | null;
  cell: number[] | null;
  value: number | null;
  depth: number;
  status: NodeStatus;
  reasonCode: string | null;
  reason: string | null;
  board: number[][] | null;
  seq: number;
  candidates: number[] | null;
}

export interface Counters { proposed: number; accepted: number; rejected: number; deadEnds: number; pruned: number; backtracks: number; memoryConfirmed: number; memoryRejected: number }

export interface Frame {
  index: number;
  event: TraceEvent;
  board: number[][] | null;
  depth: number;
  selected: number[] | null;
  candidates: number[] | null;
  counters: Counters;
  nodes: Record<string, TreeNode>;
  solution: number[][] | null;
  verified: boolean;
  terminal: { event: string; code: string | null; reason: string | null } | null;
  paused: boolean;
  resumed: boolean;
}

const copy = (b: number[][] | null) => (b ? b.map((r) => r.slice()) : null);
const ZERO: Counters = { proposed: 0, accepted: 0, rejected: 0, deadEnds: 0, pruned: 0, backtracks: 0, memoryConfirmed: 0, memoryRejected: 0 };

export function variantsOf(events: TraceEvent[]): string[] {
  return [...new Set(events.map((e) => e.data?.variant).filter((v): v is string => typeof v === 'string'))];
}

/** Events that belong to one solver: a multi-agent variant, or (single-solver runs) all of them. */
export function solverEvents(events: TraceEvent[], variant: string | null): TraceEvent[] {
  return variant ? events.filter((e) => e.data?.variant === variant) : events;
}

export function buildFrames(events: TraceEvent[]): Frame[] {
  const frames: Frame[] = [];
  let board: number[][] | null = null;
  let depth = 0;
  let selected: number[] | null = null;
  let candidates: number[] | null = null;
  let current: string | null = null;
  let counters: Counters = { ...ZERO };
  let nodes: Record<string, TreeNode> = {};
  let solution: number[][] | null = null;
  let verified = false;
  let terminal: Frame['terminal'] = null;
  let paused = false;
  let resumed = false;

  const set = (id: string | null, patch: Partial<TreeNode>) => {
    if (!id || !nodes[id]) return;
    nodes = { ...nodes, [id]: { ...nodes[id], ...patch } };
  };

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    counters = { ...counters };
    switch (e.event) {
      case 'search_started':
        if (e.board_snapshot) board = copy(e.board_snapshot);
        break;
      case 'cell_selected':
        selected = e.cell; depth = e.depth; current = e.node_id;
        if (e.node_id && !nodes[e.node_id]) nodes = { ...nodes, [e.node_id]: { id: e.node_id, parent: null, cell: null, value: null, depth: e.depth, status: 'expanded', reasonCode: null, reason: null, board: copy(board), seq: e.sequence, candidates: null } };
        else set(e.node_id, { status: 'expanded' });
        break;
      case 'candidates_generated':
        candidates = e.candidates; set(e.node_id, { candidates: e.candidates });
        break;
      case 'candidate_proposed':
        counters.proposed++; selected = e.cell;
        if (e.node_id) nodes = { ...nodes, [e.node_id]: { id: e.node_id, parent: current, cell: e.cell, value: e.candidate, depth: e.depth, status: 'pending', reasonCode: null, reason: null, board: null, seq: e.sequence, candidates: null } };
        break;
      case 'candidate_accepted':
        counters.accepted++;
        if (board && e.cell && e.candidate != null) { board = copy(board)!; board[e.cell[0]][e.cell[1]] = e.candidate; }
        set(e.node_id, { status: 'accepted', reasonCode: e.reason_code, reason: e.reason, board: copy(board) });
        break;
      case 'rule_violation':
        counters.rejected++; set(e.node_id, { status: 'rejected', reasonCode: e.reason_code, reason: e.reason });
        break;
      case 'dead_end':
        counters.deadEnds++; set(e.node_id, { status: 'dead_end', reasonCode: e.reason_code, reason: e.reason });
        break;
      case 'branch_pruned': {
        counters.pruned++;
        const n = e.node_id ? nodes[e.node_id] : undefined;
        if (n && n.status !== 'dead_end' && n.status !== 'rejected') set(e.node_id, { status: 'pruned', reasonCode: e.reason_code, reason: e.reason });
        break;
      }
      case 'backtrack_started':
        counters.backtracks++; selected = e.cell;
        if (e.board_snapshot) board = copy(e.board_snapshot);
        current = e.node_id;
        break;
      case 'memory_hit_confirmed':
        counters.memoryConfirmed++; set(e.node_id, { status: 'pruned', reasonCode: e.reason_code, reason: e.reason });
        break;
      case 'memory_hit_rejected':
        counters.memoryRejected++;
        break;
      case 'solution_found':
        if (e.board_snapshot) board = copy(e.board_snapshot);
        break;
      case 'solution_verified':
        verified = true; solution = copy(e.board_snapshot ?? board); set(e.node_id, { status: 'solution', reasonCode: e.reason_code, reason: e.reason });
        break;
      case 'search_paused':
        paused = true; resumed = false;
        break;
      case 'search_resumed':
        paused = false; resumed = true;
        break;
      case 'search_completed':
      case 'search_failed':
      case 'search_cancelled':
        terminal = { event: e.event, code: e.reason_code, reason: e.reason };
        break;
      default:
        break;
    }
    frames.push({ index: i, event: e, board: copy(board), depth, selected, candidates, counters, nodes, solution, verified, terminal, paused, resumed });
  }
  return frames;
}

export interface TreeRow { node: TreeNode; level: number; hasChildren: boolean }

/** Depth-first outline of the tree for display, honouring collapsed nodes. */
export function outline(nodes: Record<string, TreeNode>, collapsed: ReadonlySet<string>): TreeRow[] {
  const kids: Record<string, TreeNode[]> = {};
  const roots: TreeNode[] = [];
  for (const n of Object.values(nodes)) {
    if (n.parent && nodes[n.parent]) (kids[n.parent] ??= []).push(n);
    else roots.push(n);
  }
  const byseq = (a: TreeNode, b: TreeNode) => a.seq - b.seq;
  const rows: TreeRow[] = [];
  const walk = (n: TreeNode, level: number) => {
    const ch = (kids[n.id] ?? []).sort(byseq);
    rows.push({ node: n, level, hasChildren: ch.length > 0 });
    if (!collapsed.has(n.id)) ch.forEach((c) => walk(c, level + 1));
  };
  roots.sort(byseq).forEach((r) => walk(r, 0));
  return rows;
}
