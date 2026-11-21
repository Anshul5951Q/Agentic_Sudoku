import type {
  AgentContract, AgentStatusResponse, AnalyticsComparisons, AnalyticsSummary, EvaluationListItem, EvaluationRun, EvaluationTrace,
  RunComparison, SessionDetail, Approval, Board, ChatHistory, ChatResponse, CheckpointSummary, Health,
  MemoryRecord, Puzzle, PuzzleValidation, RAGResponse, RunListItem, RunMode, RuntimeStatus, SessionList, SolutionCount, SolveBody,
  SolveRun, TraceResponse,
} from '@/types/api';
import type { ApiClient } from './apiClient';

/** Thin typed wrappers over the backend endpoints used by the app. All Sudoku logic stays on the server. */
export function createApi(client: ApiClient) {
  return {
    health: () => client.get<Health>('/api/health', { timeoutMs: 4000 }),
    runtimeStatus: () => client.get<RuntimeStatus>('/api/runtime/status', { timeoutMs: 6000 }),
    analyticsSummary: () => client.get<AnalyticsSummary>('/api/analytics/summary'),
    history: (limit = 20, offset = 0) => client.get<SessionList>(`/api/history?limit=${limit}&offset=${offset}`),
    session: (id: string) => client.get<SessionDetail>(`/api/history/${encodeURIComponent(id)}`),
    compareRuns: (a: string, b: string) =>
      client.get<RunComparison>(`/api/history/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`),
    comparisons: () => client.get<AnalyticsComparisons>('/api/analytics/comparisons'),
    // evaluation
    startEvaluation: (withCot: boolean, withRag: boolean) =>
      client.post<EvaluationRun>('/api/evaluation/run', { with_cot: withCot, with_rag: withRag }),
    evaluations: () => client.get<EvaluationListItem[]>('/api/evaluation?limit=10'),
    evaluation: (id: string) => client.get<EvaluationRun>(`/api/evaluation/${encodeURIComponent(id)}`),
    latestEvaluation: () => client.get<EvaluationRun>('/api/evaluation/latest'),
    evaluationTrace: (id: string, key: string) =>
      client.get<EvaluationTrace>(`/api/evaluation/${encodeURIComponent(id)}/traces/${encodeURIComponent(key)}`, { timeoutMs: 15000 }),
    exportTrace: (id: string) => client.get<TraceResponse>(`/api/solve/${encodeURIComponent(id)}/trace?download=true`, { timeoutMs: 15000 }),
    getPuzzle: (id: string) => client.get<Puzzle>(`/api/puzzles/${encodeURIComponent(id)}`),
    createPuzzle: (board: Board, name?: string, source: 'user' | 'sample' | 'generated' = 'user') =>
      client.post<Puzzle>('/api/puzzles', { board, name: name ?? null, source }),
    validate: (board: Board, signal?: AbortSignal) => client.post<PuzzleValidation>('/api/puzzles/validate', { board }, { signal }),
    countSolutions: (board: Board) => client.post<SolutionCount>('/api/puzzles/count-solutions', { board }),
    generate: (clues: number) => client.post<Puzzle>('/api/puzzles/generate', { clues, save: false }),
    // runs
    startRun: (mode: RunMode, body: SolveBody) => client.post<SolveRun>(`/api/solve/${mode}`, body, { timeoutMs: 15000 }),
    getRun: (id: string) => client.get<SolveRun>(`/api/solve/${encodeURIComponent(id)}`),
    listRuns: (limit = 20) => client.get<RunListItem[]>(`/api/solve?limit=${limit}`),
    getTrace: (id: string, after = -1) => client.get<TraceResponse>(`/api/solve/${encodeURIComponent(id)}/trace?after=${after}`),
    checkpoint: (id: string) => client.get<CheckpointSummary>(`/api/solve/${encodeURIComponent(id)}/checkpoint`),
    pause: (id: string) => client.post<SolveRun>(`/api/solve/${encodeURIComponent(id)}/pause`, undefined, { timeoutMs: 20000 }),
    resume: (id: string) => client.post<SolveRun>(`/api/solve/${encodeURIComponent(id)}/resume`),
    cancel: (id: string) => client.post<SolveRun>(`/api/solve/${encodeURIComponent(id)}/cancel`, undefined, { timeoutMs: 20000 }),
    // agents
    contracts: () => client.get<AgentContract[]>('/api/agents/contracts'),
    agentStatus: (id: string) => client.get<AgentStatusResponse>(`/api/agents/${encodeURIComponent(id)}/status`),
    // memory, chat, rag
    listMemory: (userId: string, kind?: string) =>
      client.get<MemoryRecord[]>(`/api/memory?user_id=${encodeURIComponent(userId)}${kind ? `&kind=${kind}` : ''}`),
    createMemory: (userId: string, kind: string, key: string, payload: Record<string, unknown>) =>
      client.post<MemoryRecord>('/api/memory', { user_id: userId, kind, key, payload }),
    deleteMemory: (id: number, userId: string) =>
      client.request<void>('DELETE', `/api/memory/${id}?user_id=${encodeURIComponent(userId)}`),
    clearMemory: (userId: string) =>
      client.request<{ deleted: number }>('DELETE', `/api/memory?user_id=${encodeURIComponent(userId)}&confirm=true`),
    stalePattern: (board: Board, userId: string) => client.post<MemoryRecord>('/api/memory/demo/stale-pattern', { board, user_id: userId }),
    chat: (message: string, memory: boolean, threadId?: string | null, puzzle?: Board) =>
      client.post<ChatResponse>('/api/chat', { message, memory, thread_id: threadId ?? null, puzzle: puzzle ?? null }, { timeoutMs: 60000 }),
    chatHistory: (threadId: string) => client.get<ChatHistory>(`/api/chat/${encodeURIComponent(threadId)}`),
    ragQuery: (query: string, k: 1 | 3) => client.post<RAGResponse>('/api/rag/query', { query, k }, { timeoutMs: 60000 }),
    // oversight
    requestApproval: (board: Board, userText: string, proposer: 'qwen' | 'stand_in') =>
      client.post<Approval>('/api/approvals', { board, user_text: userText, proposer }, { timeoutMs: 60000 }),
    decideApproval: (id: string, approved: boolean) => client.post<Approval>(`/api/approvals/${encodeURIComponent(id)}/decision`, { approved }),
  };
}

export type Api = ReturnType<typeof createApi>;
