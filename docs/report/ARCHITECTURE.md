# Architecture

```
 Android app (Expo Router, React Native, TypeScript)          runs on the phone / emulator
   Home · Play · AI Lab · Memory · Analytics · History · Search tree · Compare · Settings
   └─ apiClient (typed errors, timeouts) ── HTTP JSON ──┐   TraceStream ── WebSocket ──┐
                                                         ▼                              ▼
 FastAPI backend  (backend/app)                                          runs on the computer, local only
   api/      puzzles · solve · agents · memory · rag · chat · approvals · history · analytics · evaluation · ws
   services/ RunManager (threads, chunked checkpointed ToT, pause/resume/cancel, restart recovery)
             EvaluationService (background five-case job, stores every trace) · ApprovalService · ChatService
   persistence/db.py  SQLite: sessions, puzzles, runs, events, nodes, approvals, evaluations, evaluation_traces
   core/     settings from env, one error envelope (sqlite errors -> 503 DATABASE_UNAVAILABLE), ID validation
        │  imports (no Sudoku logic in the backend)
        ▼
 ta2/  (the engine, also runnable as a CLI: python -m ta2.main --mode …)
   sudoku_rules   pure 4×4 rules, candidates, count_solutions       ← authoritative
   search         iterative one-decision-per-step DFS (MRV / first-empty), exact parent restore
   agents         Proposer · RuleChecker/Evaluator · Verifier · Backtracker (five-field contracts)
   supervisor     routing with MAX_HOPS, parallel or sequential variants, verified-only vote
   checkpointer   LangGraph + SqliteSaver, one checkpoint per decision, stable thread_id
   memory         namespaced long-term SQLite memory, validated dead-end recall
   chat_memory    short-term thread memory (LangGraph checkpoint)
   rag            Chroma (persistent) + nomic-embed-text, relevance threshold, "I don't know."
   llm_proposer   qwen2.5:3b, structured output, advisory only
   oversight      injection guard → legality check → human approval (LangGraph interrupt)
   failure        tool runner: injected faults, retry, fallback, budgets; controlled demo faults
   evaluation     five-case TA1-vs-TA2 harness + challenge analysis + RAG k=1/k=3
        │  loads, never edits (hash-checked by tests/test_ta1_frozen.py)
        ▼
 ta1/  frozen baseline: cot_attempt.py, tot_solver.py, sudoku_tot.py

 Local services: Ollama (qwen2.5:3b, nomic-embed-text) · Chroma persistent dir · SQLite files
 Nothing leaves the machine; no API keys; no cloud model.
```

## Data flow of one ToT run
1. `POST /api/solve/tot` validates the board (4×4, ints 0–4, no duplicates) and creates a run plus a thread ID.
2. A worker thread runs the checkpointed search in chunks of N decisions. After each chunk the new events and nodes go
   to SQLite **first**; then pause, cancel and timeout flags are checked at that safe boundary.
3. The WebSocket reads events **from SQLite** (`?after=<seq>`), so a reconnect gets exactly the missed events.
4. The final board is re-verified by `VerifierAgent`; only then is `verified: true` stored.
5. After a backend restart, `running` runs become `interrupted`; **Resume** continues from the LangGraph checkpoint.

## Where the evidence lives
* Live: the backend database (History, Analytics, the evaluation-run interface in the app).
* Recorded: `traces/*.json` (CLI runs), `android/assets/recorded/*.json` (bundled offline replay),
  `android/tests/recorded/*.json` (fixtures recorded from the real backend for the Jest tests).
