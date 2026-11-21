# Component checklist: requirement → code → test → evidence

| Requirement | Code | Automated test | Recorded evidence |
|---|---|---|---|
| Deterministic 4×4 rules, uniqueness | `ta2/sudoku_rules.py` | `tests/test_rules.py` | — |
| Iterative ToT search, pruning, exact backtrack restore | `ta2/search.py`, `ta2/agents.py` | `tests/test_agents.py` | `traces/eval_case*_ta1_tot_search_tree.json`, `traces/checkpoint_resume.json` |
| CoT baseline (frozen TA1 prompt, real Qwen) | `ta1/cot_attempt.py` via `ta2/ta1_runner.py` | `tests/test_ta1_frozen.py`, `backend/tests/test_solve_api.py` | `traces/eval_case*_ta1_cot_raw_output.json` |
| TA1 preserved | `ta1/` | `tests/test_ta1_frozen.py` (SHA-256 hashes) | — |
| Five-field role specs (≥2 runtime roles) | `ta2/agents.py`, `ta2/supervisor.py` | `tests/test_agents.py`, `backend/tests/test_phase5_api.py` | `docs/report/ROLE_TABLE.md` |
| Supervisor routing + `MAX_HOPS` | `ta2/supervisor.py` | `tests/test_supervisor.py` | `traces/supervisor_routing.json` |
| Voting excludes invalid / crashed / timed-out results | `ta2/supervisor.py::tally_votes` | `tests/test_supervisor.py`, `backend/tests/test_phase5_api.py` | `traces/eval_challenge_fault_*.json` |
| Sequential vs parallel dispatch | `Supervisor(parallel=False)` | `tests/test_supervisor.py`, `backend/tests/test_analytics_history.py` | `traces/eval_case*_ta2_multi_agent_sequential.json` |
| Short-term memory with thread ID (and amnesia without) | `ta2/chat_memory.py` | `tests/test_oversight_and_chat.py`, `backend/tests/test_phase5_api.py` | `traces/short_term_memory.json` |
| Long-term SQLite memory, restart, namespaces | `ta2/memory.py` | `tests/test_memory.py`, `backend/tests/test_misc_api.py` | `traces/long_term_memory.json` |
| Stale memory cannot prune a valid branch | `ta2/search.py` memory hook | `backend/tests/test_phase5_api.py` | — |
| Search checkpoint + mid-search resume | `ta2/checkpointer.py`, `backend/app/services/runs.py` | `tests/test_checkpoint.py`, `backend/tests/test_solve_api.py`, `backend/tests/test_recovery.py` | `traces/checkpoint_resume.json` |
| Chroma persistent RAG, ≥8 chunks, nomic-embed-text | `ta2/rag.py`, `ta2/corpus/` | `tests/test_rag.py` (incl. live-Ollama tests) | `traces/rag_k1_k3.json`, `traces/rag_calibration.json` |
| k=1 vs k=3; "I don't know." | `ta2/rag.py`, `ta2/evaluation.py::rag_comparison` | `tests/test_rag.py` | `traces/eval_rag_*.json`, `docs/report/FIVE_CASE_TABLE.md` |
| Tool failure injection, retry, fallback | `ta2/failure.py` | `tests/test_supervisor.py`, `backend/tests/test_phase5_api.py`, `backend/tests/test_recovery.py` | `traces/failure_recovery.json`, `traces/eval_challenge_tool_*.json` |
| Human approval: approved / rejected / injection | `ta2/oversight.py`, `backend/app/services/approvals.py` | `tests/test_oversight_and_chat.py`, `backend/tests/test_misc_api.py` | `traces/oversight.json`, `traces/challenge_injection.json` |
| Measured challenge analysis | `ta2/evaluation.py::challenge_analysis`, `ta2/demos.py` | `backend/tests/test_analytics_history.py` | `traces/challenge_cost.json`, `traces/challenge_injection.json`, `traces/evaluation.json` |
| Five cases on TA1 and TA2 | `ta2/evaluation.py` | `tests/test_evaluation.py`, `backend/tests/test_misc_api.py` | `traces/evaluation.json`, `docs/report/FIVE_CASE_TABLE.md` |
| API: validation, errors, idempotency, WS reconnect, export | `backend/app/` | `backend/tests/*.py` | `docs/API.md` |
| Recovery: restart, corruption, SQLite/Chroma errors, duplicate pause/resume | `backend/app/services/runs.py`, `backend/app/core/errors.py` | `backend/tests/test_recovery.py` | — |
| History, replay, compare, export | `backend/app/api/history.py`, `android/src/screens/{History,Session,Compare}Screen.tsx` | `backend/tests/test_analytics_history.py`, `android/tests/history.test.tsx` | — |
| Analytics from stored data only; evaluation-run UI | `backend/app/api/analytics.py`, `android/src/screens/AnalyticsScreen.tsx` | `backend/tests/test_analytics_history.py`, `android/tests/analytics.test.tsx` | — |
| Android: tabs, board, states, live tree, background/foreground, small screen | `android/` | `android/tests/*.test.tsx` | `docs/screenshots/` (local only) |
| Recorded-replay fallback, clearly labelled | `android/src/screens/BundledReplayScreen.tsx` | `android/tests/resilience.test.tsx` | `android/assets/recorded/` |
