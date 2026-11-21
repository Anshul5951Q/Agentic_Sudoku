# Regression and recovery testing (spec §12 and §11.3)

## Commands

```powershell
python -m pytest -q                      # engine + Unit 3/4 + API + recovery; live-Ollama tests auto-skip if Ollama is down
python -m pytest -q -m ollama            # only the tests that call the real local models
cd android ; npm test ; npm run typecheck
python scripts/record_app_fixtures.py    # re-record the real backend responses the Jest tests use
```

## Spec §12 → test files

| Spec | Items | Where |
|---|---|---|
| 12.1 Sudoku logic | valid/invalid row, column, box; contradictory; no / one / multiple solutions; candidates; zero-candidate dead end; backtrack restore; clues preserved | `tests/test_rules.py`, `tests/test_agents.py` |
| 12.2 Agents | proposer legal only; evaluator row/col/box; backtracker dead end + restore; verifier incomplete/invalid; `MAX_HOPS`; invalid results cannot vote; no valid vote → no winner | `tests/test_agents.py`, `tests/test_supervisor.py` |
| 12.3 Unit 3 | follow-up with/without thread; long-term restart; namespaces; checkpoint saved + mid-search resume; ≥8 chunks; k=1/k=3; "I don't know."; stale memory cannot prune; injected tool failure | `tests/test_oversight_and_chat.py`, `tests/test_memory.py`, `tests/test_checkpoint.py`, `tests/test_rag.py`, `backend/tests/test_phase5_api.py` |
| 12.4 Unit 4 | role contracts; routing trace; hop limit; approved / rejected; injection rejected; voting excludes invalid; vote reproducible from saved data | `tests/test_agents.py`, `tests/test_supervisor.py`, `tests/test_oversight_and_chat.py`, `backend/tests/test_phase5_api.py`, `backend/tests/test_misc_api.py` |
| 12.5 API | valid / invalid board; unknown run; model unavailable; timeout; WS reconnect + missed events; pause/resume; cancel; duplicate (idempotency); trace, history, export; compare; comparisons; evaluation traces | `backend/tests/test_puzzles_api.py`, `backend/tests/test_solve_api.py`, `backend/tests/test_misc_api.py`, `backend/tests/test_analytics_history.py` |
| 12.6 Android | all tabs; board entry/clear; invalid cell; backend down; each solve mode; live events; pause/resume/replay; background/foreground; session reopen; small screen (320 dp) | `android/tests/*.test.tsx` (`navigation`, `play`, `board`, `ailab`, `searchtree`, `history`, `analytics`, `resilience`, …) |
| 12.6 physical device | install APK on a phone, run the demo script | manual; see the README Definition of Done for the current status |

## Recovery matrix (§11.3)

| Failure | Expected behaviour | Test |
|---|---|---|
| Backend restart while a ToT run is running | run becomes `interrupted`, `resumable`; resume continues from the checkpoint (one `search_started`, a `search_resumed`) | `backend/tests/test_recovery.py::test_backend_restart_during_a_running_search_resumes_from_the_checkpoint`, `test_solve_api.py::test_paused_run_survives_backend_restart_and_resumes` |
| WebSocket disconnect | the run continues; reconnect with `?after=` gets only missed events | `test_recovery.py::test_ws_disconnect_mid_run_does_not_stop_the_run`, `test_solve_api.py::test_ws_reconnect_fetches_only_missed_events_without_duplicates`, `android/tests/searchtree.test.tsx` |
| App background → foreground | socket closed in background; REST catch-up from the last event; socket resumes after the caught-up event | `android/tests/resilience.test.tsx` |
| Checkpoint state corrupted | resumed run fails with `CHECKPOINT_INVALID`, `verified: false`, explicit terminal event | `test_recovery.py::test_corrupted_checkpoint_state_fails_the_resumed_run_explicitly`, `tests/test_checkpoint.py` |
| Checkpoint DB unreadable | not resumable; `409 CHECKPOINT_UNAVAILABLE` | `test_recovery.py::test_unreadable_checkpoint_database_makes_resume_unavailable_not_a_fake_success` |
| Ollama down / model missing | runtime status reports each part separately; CoT/RAG/chat/approval fail with `OLLAMA_UNAVAILABLE` (503), no leak | `test_puzzles_api.py`, `test_solve_api.py`, `test_misc_api.py`, `test_phase5_api.py` |
| Chroma unavailable | `503 VECTOR_STORE_UNAVAILABLE`; as a multi-agent context tool it is traced, retried and the run still gives the verified answer | `test_recovery.py::test_chroma_unavailable_is_a_503_vector_store_error`, `::test_rag_context_tool_failure_in_a_multi_agent_run_degrades_without_wrong_answers` |
| SQLite locked / unavailable | API `503 DATABASE_UNAVAILABLE`, retryable, no path in the message; a broken memory DB fails the run cleanly | `test_recovery.py::test_api_database_error_is_a_retryable_503_without_leaks`, `::test_broken_memory_database_fails_a_memory_run_cleanly` |
| Duplicate pause / resume (concurrent) | idempotent: exactly one `search_paused` and one `search_resumed`, contiguous sequences | `test_recovery.py::test_concurrent_duplicate_pause_and_resume_requests_are_idempotent`, `test_solve_api.py::test_duplicate_resume_does_not_start_a_second_worker` |
| Solver cancellation / timeout | explicit `search_cancelled` / `TIMEOUT`, never "solved" | `test_solve_api.py` |
