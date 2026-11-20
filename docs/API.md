# SudokuMind AI — Backend API

FastAPI backend under `backend/`. It **orchestrates and persists**; all Sudoku logic stays in `ta2/`
(`sudoku_rules`, `search`, `agents`, `supervisor`, `checkpointer`, `rag`, `memory`, `oversight`) and the frozen
`ta1/` scripts. The LLM (local `qwen2.5:3b`) is advisory: nothing it says is applied without deterministic
validation, and AI-suggested moves additionally need explicit human approval.

Live, always-current reference: `GET /docs` (Swagger UI) and `GET /openapi.json` — 29 paths / 32 operations, 41 schemas.
The WebSocket is not representable in OpenAPI; it is specified in §5 below.

## 1. Run it

```powershell
pip install -r requirements.txt -r requirements-dev.txt -r backend/requirements.txt   # adds fastapi
python -m backend                       # http://127.0.0.1:8000  (docs at /docs)
python -m pytest -q backend             # 81 API tests, no Ollama needed (it is faked / simulated down)
```

Configuration is by environment variable (optionally a git-ignored `.env`; see `.env.example`). **No host or IP is
hardcoded.**

| Variable | Default | Meaning |
|---|---|---|
| `SUDOKU_API_HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` so a phone on your network can reach it. |
| `SUDOKU_API_PORT` | `8000` | Port |
| `SUDOKU_API_DB` | `<SUDOKU_DATA_DIR>/api.sqlite3` | API database |
| `SUDOKU_DATA_DIR` | project root | Where checkpoint/memory/Chroma/API databases live |
| `SUDOKU_CORS_ORIGINS` | *(empty)* | Extra comma-separated origins (browser / Expo-web only) |
| `OLLAMA_HOST` | `http://localhost:11434` | Local Ollama URL used for the status probe |
| `SUDOKU_STEP_DELAY` | `0` | Seconds to pause between search chunks (pacing for demos/tests) |

**Reaching the API from Android** (spec §5.1): the emulator reaches the host at `10.0.2.2`, so the app's base URL is
`http://10.0.2.2:8000`. A physical phone needs the computer's LAN address in the *app's* environment config (never in
source), `SUDOKU_API_HOST=0.0.0.0`, and a Windows firewall rule for the port. Native apps do not use CORS; CORS exists
for Expo web/dev tooling only (default: `localhost`/`127.0.0.1` on any port, plus anything in `SUDOKU_CORS_ORIGINS`).

## 2. Conventions

* **Boards**: 4×4 list of integers, `0` = empty — **never `null`**. Out-of-range, non-integer (including `true`, `"1"`,
  `1.5`, `null`), or wrongly-shaped boards → `422 INVALID_BOARD`.
* **Coordinates**: zero-based `[row, col]` everywhere (events, nodes, conflicts). The frontend must use the same convention.
* **IDs** are stable, URL-safe strings: `puzzle-…`, `session-…`, `run-…`, `thread-…`, `approval-…`, `eval-…`; events are
  `<run_id>-event-00042`, nodes `<run_id>-node-0007`. Path IDs must match `[A-Za-z0-9_-]{1,64}`.
* **Errors** always use one envelope (spec 8.5) and never contain paths, secrets or stack traces:
  ```json
  {"error": {"code": "RUN_NOT_FOUND", "message": "run 'run-x' was not found", "recoverable": true, "retryable": false, "details": {}}}
  ```
* **Request size** is capped at 64 KB (`413 PAYLOAD_TOO_LARGE`).
* A *session* is a saved puzzle plus all runs on it. Creating a puzzle creates its session.

## 3. Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Backend liveness (independent of Ollama) |
| GET | `/api/runtime/status` | Backend / Ollama / required models / Chroma / SQLite, reported **separately**; `ready_for_llm`, `ready_for_rag` |
| POST | `/api/puzzles` | Save a puzzle (+session); records solution count / uniqueness |
| GET | `/api/puzzles/{puzzle_id}` | Get a saved puzzle |
| POST | `/api/puzzles/validate` | Row/column/box conflicts; `solved` is true only for a complete, rule-valid grid |
| POST | `/api/puzzles/count-solutions` | 0 / 1 / 2 (= "two or more"); stops after two |
| POST | `/api/puzzles/generate` | `{clues 4..12, seed?}` → a puzzle **verified solvable and unique** (re-checked by the same counter); reproducible by `seed` |
| POST | `/api/solve/cot` | Frozen TA1 CoT prompt on local Qwen; answer verified deterministically |
| POST | `/api/solve/tot` | Checkpointed Tree-of-Thought search (pausable) |
| POST | `/api/solve/multi-agent` | Supervisor + candidate-order variants + verified-only vote |
| GET | `/api/solve/{run_id}` | Status, result, progress, `live`, `resumable`, deterministic-vs-LLM component labels |
| GET | `/api/solve/{run_id}/trace` | Persisted events + search nodes; `?after=<seq>` catch-up; `?download=true` export |
| GET | `/api/solve/{run_id}/checkpoint` | `CheckpointSummary` — what a resume would continue from |
| POST | `/api/solve/{run_id}/pause` | Pause at a safe decision boundary (ToT only) |
| POST | `/api/solve/{run_id}/resume` | Resume from the checkpoint (`paused` or `interrupted` runs) |
| POST | `/api/solve/{run_id}/cancel` | Cancel (ToT: also when paused) |
| GET | `/api/agents/{run_id}/status` | Per-agent status derived from the stored trace + routing trace |
| GET / POST | `/api/memory` | List (`?user_id&kind`) / store a memory in a `(user_id, kind)` namespace |
| DELETE | `/api/memory/{memory_id}` | Delete one memory (scoped to `user_id`) |
| DELETE | `/api/memory?user_id=…&confirm=true` | Demo reset; refuses without `confirm=true` |
| POST | `/api/rag/query` | `{query ≤500, k ∈ {1,3}}` → grounded answer or `"I don't know."`, with evidence + chunk IDs |
| GET | `/api/history` / `/api/history/{session_id}` | Sessions (newest activity first, paginated) / one session with its runs |
| GET | `/api/analytics/summary` | Aggregates **computed from stored runs** |
| POST | `/api/evaluation/run` | Start the five-case TA1-vs-TA2 evaluation as a background job → `202` |
| GET | `/api/evaluation/{id}` · `/latest` | Poll / fetch the persisted result |
| POST | `/api/approvals` | *(extension)* Ask for an AI move; guarded, then held for human approval |
| GET | `/api/approvals` · `/{id}` | *(extension)* Approval records |
| POST | `/api/approvals/{id}/decision` | *(extension)* `{approved: bool}` |
| WS | `/ws/solve/{run_id}?after=<seq>` | Live trace stream (§5) |

Solve-start endpoints accept `{puzzle_id | board, strategy: mrv|first_empty, order: asc|desc|middle, max_nodes, timeout_s}`
(exactly one of `puzzle_id`/`board`) and an optional `Idempotency-Key` header. They return **202** with a `SolveRun`; a
repeated identical request with the same key returns **200** with the existing run and `duplicate: true`.

Boards that break the rules (duplicates) are refused with `422 PUZZLE_CONTRADICTORY`; consistent-but-unsolvable boards are
accepted and end as `exhausted` (never as "solved").

## 4. Run lifecycle

```
queued → running → completed | failed | cancelled
              ↘ paused ⇄ running      (ToT only)
   (backend restart) running → interrupted → running   (resume from checkpoint)
```

* `result.outcome`: `solved | exhausted | limit_reached | failed | cancelled | no_valid_vote | incorrect`;
  `result.verified` is true **only** if a complete board re-passed the deterministic verifier — the engine's own flag is not trusted.
* **ToT** runs the LangGraph SQLite-checkpointed search in chunks. After each chunk the new events are written to SQLite, then
  pause/cancel/timeout flags are checked, so they act at a decision boundary. **Pause is acknowledged only after the state and a
  `search_paused` event are persisted** (`200 {"status":"paused"}`; `408 PAUSE_TIMEOUT` if the boundary isn't reached in time).
  Duplicate pause/resume/cancel requests are idempotent. A cancelled run never restarts.
* **Backend restart**: runs that were `running` become `interrupted` (`live:false`, `resumable:true` if a valid checkpoint exists).
  `resume` continues from the checkpoint — not from the root; a missing/invalid checkpoint gives `409 CHECKPOINT_UNAVAILABLE`.
* `live` is true only while a worker is executing the run. A finished run's trace is a **recorded replay**
  (`trace.recorded: true`), never confused with a live run.
* **Multi-agent** and **CoT** runs are short and atomic: `pause` → `409 PAUSE_NOT_SUPPORTED`; cancelling mid-flight →
  `409 RUN_NOT_CANCELLABLE`. Their events are persisted when the run finishes (still before the terminal status/WS message).
* Multi-agent "variants" are **candidate-order variants of one deterministic solver, not independent LLM agents** — the API labels
  them so (`vote.vote_type`, `note`, agent-status `note`). Their search events carry `data.variant`.

## 5. WebSocket `/ws/solve/{run_id}?after=<seq>`

Events are read **from SQLite**, so the stream never depends on a live worker, and an event is sent at most once per connection.

| Server message | Meaning |
|---|---|
| `{"type":"event","event":<TraceEvent>}` | One persisted trace event, strictly increasing `sequence` |
| `{"type":"status","status":"running\|paused\|…","last_sequence":N}` | Run status changes — kept separate from trace events |
| `{"type":"terminal","status","outcome","verified","last_sequence"}` | Sent once, after every event is delivered; then the server closes with 1000. Covers success, failure and cancellation |
| `{"type":"error","error":{…}}` | e.g. unknown run; the server then closes with code **4404** |

**Reconnect protocol**: remember the last `sequence` you processed and reconnect with `?after=<that>`; you receive only the missed
events (no duplicates, no gaps), then the live ones. `GET /api/solve/{id}/trace?after=<seq>` returns the same missed events over
REST. A paused run keeps the socket open (status `paused`); `terminal` is only sent for `completed | failed | cancelled`.
Replaying a finished run from `after=-1` yields exactly its persisted trace.

### TraceEvent (captured from a real run on the sample puzzle, TA1 cell order)

```json
{
  "event_id": "run-be776e9142d1-event-00007", "run_id": "run-be776e9142d1", "thread_id": "thread-e67c8ce52630",
  "sequence": 7, "event": "dead_end", "agent": "Verifier", "depth": 1, "cell": [0, 1],
  "candidate": null, "candidates": null, "reason_code": "ZERO_CANDIDATES",
  "reason": "cell [0, 1] has no legal candidates",
  "board_snapshot": [[2,0,3,4],[3,4,0,0],[0,1,4,0],[4,0,0,1]],
  "node_id": "run-be776e9142d1-node-0001", "timestamp": "2026-11-20T11:15:16.772219+00:00", "data": {}
}
```

Event names: the 13 core events of spec 6.4 (`search_started`, `cell_selected`, `candidates_generated`, `candidate_proposed`,
`candidate_accepted`, `rule_violation`, `dead_end`, `branch_pruned`, `backtrack_started`, `solution_found`, `solution_verified`,
`search_completed`, `search_failed`) plus `search_paused`, `search_resumed`, `search_cancelled`, `memory_hit_confirmed`,
`memory_hit_rejected`, `route`, `tool_call`, `tool_failure`, `tool_recovered`, `guardrail_decision`, `approval_*`, `vote_tallied`.
A run's terminal event is exactly one of `search_completed | search_failed | search_cancelled`.

**SearchNode** (`trace.nodes`): `node_id, parent_node_id, depth, decision_cell, candidate_value, board_snapshot,
status ∈ pending|expanded|accepted|rejected|dead_end|pruned|solution, reason_code, reason_text, candidate_list, created_at, agent_id`.
ToT runs store the full tree; multi-agent and CoT runs store events only.

## 6. Error codes

| HTTP | Code | When |
|---|---|---|
| 404 | `RUN_NOT_FOUND`, `PUZZLE_NOT_FOUND`, `SESSION_NOT_FOUND`, `APPROVAL_NOT_FOUND`, `EVALUATION_NOT_FOUND`, `MEMORY_NOT_FOUND`, `NOT_FOUND` | Unknown resource |
| 405 | `METHOD_NOT_ALLOWED` | Wrong method |
| 408 | `PAUSE_TIMEOUT`, `CANCEL_TIMEOUT` | Run didn't reach a safe boundary in time (retryable) |
| 409 | `INVALID_STATE`, `PAUSE_NOT_SUPPORTED`, `RESUME_NOT_SUPPORTED`, `RUN_NOT_CANCELLABLE`, `CHECKPOINT_UNAVAILABLE`, `IDEMPOTENCY_CONFLICT`, `EVALUATION_IN_PROGRESS`, `ALREADY_DECIDED`, `APPROVAL_NOT_PENDING` | State/duplicate conflicts |
| 413 | `PAYLOAD_TOO_LARGE` | Body > 64 KB |
| 422 | `INVALID_BOARD`, `INVALID_REQUEST`, `INVALID_ID`, `INVALID_KIND`, `INVALID_IDEMPOTENCY_KEY`, `PUZZLE_CONTRADICTORY`, `GENERATION_FAILED`, `CONFIRMATION_REQUIRED` | Validation (details list `loc`/`message` only) |
| 500 | `INTERNAL_ERROR` | Unexpected (generic message; detail only in local logs) |
| 503 | `OLLAMA_UNAVAILABLE`, `VECTOR_STORE_UNAVAILABLE` | RAG dependencies down (retryable) |

Run **failure codes** (inside `result.failure`, not HTTP errors): `MAX_NODES`, `TIMEOUT`, `HOP_LIMIT_EXCEEDED`, `NO_VALID_VOTE`,
`NO_UNIQUE_WINNER`, `OLLAMA_UNAVAILABLE`, `COT_INCORRECT`, `COT_UNPARSEABLE`, `CHECKPOINT_INVALID`, `NO_CHECKPOINT`,
`CONTRADICTORY_BOARD`, `ZERO_CANDIDATES`, `INTERNAL_ERROR`.

## 7. Persistence (SQLite, `SUDOKU_API_DB`)

`sessions`, `puzzles`, `runs`, `events` (PK `(run_id, sequence)` — replays cannot duplicate), `nodes`, `approvals`, `evaluations`.
Search checkpoints live in the LangGraph SQLite checkpointer (`checkpoints.sqlite3`); long-term memory in `sudoku_memory.sqlite3`;
RAG vectors in Chroma. All of these are git-ignored.

## 8. Human oversight

`POST /api/approvals` runs: input guard (rule-based prompt-injection patterns, rejected **before any model call**) → local Qwen
proposes one move → deterministic legality guard → if still allowed, status `pending` and the move is **held**; `board_after`
stays `null` until `POST …/decision {"approved": true}` (which re-validates once more). Illegal or unparseable suggestions and
injections end as `blocked` and can never be approved. A pending approval survives a backend restart. The detector is
non-exhaustive by design; the real protection is that no text changes which moves are legal.

## 9. OpenAPI review (what was checked and fixed)

* Every spec §8.2 endpoint is present with a summary; all request/response models of §8.4 appear in `components.schemas`
  (`CheckpointSummary` via `GET …/checkpoint`, `APIError` via the declared error responses) — asserted by a test.
* Error responses were first attached to every route; that was inaccurate (`GET /api/health` cannot return 409). The schema now
  lists only the errors each route can return (plus 500), and the `422` body is the real error envelope, not FastAPI's default.
* The duplicate-request `200` on the solve-start routes was undocumented; it is now declared.
* Removed an early inconsistency found by the tests: ToT events used the checkpoint `thread_id` as their `run_id`; they now carry
  the API `run_id`, with `thread_id` as a separate field (spec 8.3).
* Fixed a race found by the tests: `live` could be `true` for a few milliseconds after `status` was `completed`.

## 11. Unit 3 / Unit 4 demonstration endpoints (added for the AI Lab and Memory screens)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/solve?limit=` | Recent runs (newest first) with `resumable`, `board`, `config`; used to resume after a restart |
| GET | `/api/agents/contracts` | Five-field role spec (name, goal, tools, inputs_outputs, limits) of every runtime agent incl. the Supervisor |
| POST | `/api/chat` | One chat turn with short-term memory ON (`thread_id`, LangGraph checkpoint) or OFF (amnesia). Returns `messages_seen_by_model` |
| GET | `/api/chat/{thread_id}` | Restore a thread's messages from its checkpoint (survives a backend restart) |
| POST | `/api/memory/demo/stale-pattern` | DEMO: store a deliberately wrong dead-end pattern to show it cannot prune a valid branch |

New optional fields on the solve requests: **multi-agent** `max_hops` (1-20), `faults` (up to 3 *controlled demo faults*:
`{variant: asc|desc|middle, kind: invalid_board|crash|timeout}`), `inject_tool_failure` (`{tool: "rag_retrieve", times: 1-5}`);
**tot** `use_memory` + `user_id` (consult/update long-term dead-end memory). Using them on the wrong mode is `422 INVALID_OPTION`.
Runs started with faults say so in their first trace event (`data.demo_faults`), so a demonstration is never mistaken for a
normal run. `POST /api/approvals` accepts `proposer: "qwen" | "stand_in"`; `stand_in` is a labelled deterministic legal move
(the approval record carries `proposer`), because the real model rarely proposes a legal one. Agent status gained `retries` and
`recovered`. Run results keep each attempt's `solution`, so a vote can be recomputed from saved data (`ta2.supervisor.tally_votes`).

Error text from failing tools is never copied into traces: only our own `ToolError` messages are recorded; any other exception is
reduced to its type name (detail goes to the server log).

## 10. Known limitations

* Single-process, single-user, **no authentication**; intended for a trusted local network. Do not expose it to the internet.
* Worker threads live in the API process; a hard kill interrupts them (recoverable for ToT as described above, not for multi-agent/CoT).
* CoT cannot be interrupted during the model call; its timeout is checked after the call returns. A real CoT call takes ~10–30 s.
* Multi-agent/CoT traces are written when the run ends, so the WebSocket shows them as a burst rather than incrementally.
* The request-size cap relies on the `Content-Length` header.
* Qwen 3B rarely proposes legal moves (see `traces/oversight.json`); the approval flow therefore usually ends `blocked` with the real model.
* No pagination on `GET /api/approvals` beyond `limit`; no run deletion endpoint; no rate limiting.
