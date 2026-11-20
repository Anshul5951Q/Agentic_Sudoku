# Phase 0 Audit — SudokuMind AI / Sudoku ToT TA2

Audit date: 2026-11-20. Spec: `SUDOKUMIND_AI_REQUIREMENTS.md` (v1.0). No source files were modified.
All numbers below are from commands actually run in this audit (Python 3.11.9, fresh `.venv`, Ollama running locally).

## 1. Baseline run results (README commands)

| Command | Result |
|---|---|
| `pip install -r requirements.txt` in a fresh venv | OK. Resolved `langgraph 1.2.24`, `langgraph-checkpoint-sqlite 3.1.3`, `langchain-chroma 1.1.0`, `chromadb 1.5.9`. |
| Any `python -m ta2.main ...` with the *global* Python | **FAIL** `ModuleNotFoundError: langgraph.checkpoint.sqlite` (declared in requirements.txt, just not installed globally). `main.py` imports it eagerly, so even `--mode memory` dies. Fixed by following README step 3 (venv). |
| `--mode memory` | PASS — prints 3 seeded patterns. |
| `--mode checkpoint --thread-id demo-001` | PASS — solved; `checkpoints.sqlite3` has 3 checkpoint rows for the thread (one-step graph). |
| `--mode evaluate` | Runs and writes `traces/evaluation.json`, **but the output is misleading — see F1–F3.** |
| `--mode rag --k 1` / `--k 3` | PASS (retrieves 1 / 3 chunks). Prints a *static instruction*, not an answer. |
| `--mode rag --k 3 --query "Who won the 2018 football world cup?"` | Returns 3 irrelevant chunks and the same static line. **No abstention.** |
| `--mode solve` | PASS — 3 variants, 3/3 vote, writes `traces/latest_solve.json`. Qwen proposer output is incoherent (see F8). |
| TA1 `sudoku_tot.py` | PASS — 1 solution (unique). |
| TA1 `tot_solver.py` | **FAIL on Windows default console** (`UnicodeEncodeError`, cp1252 vs `✗ ├`). PASS with `PYTHONUTF8=1`: 10 "Try" lines, 2 dead-end prunes (at (1,1)=2 and (2,3)=2), solved. |
| TA1 `cot_attempt.py` | Runs (qwen2.5:3b). This run produced an **invalid** grid (`1 2 3 4 / 3 4 1 2 / 1 2 4 3 / 2 3 4 1`, duplicates in columns). Non-deterministic LLM output; a real CoT failure, not fabricated. |
| `pytest` | No tests exist; pytest isn't in the venv or requirements.txt. |

Side effects of running (all gitignored): `.venv/`, `chroma_db/`, `checkpoints.sqlite3`, `sudoku_memory.sqlite3`, `traces/evaluation.json`, `traces/latest_solve.json`. The two trace files come from the flawed evaluation and will be regenerated in Part B. The project is **not a git repository**.

## 2. Findings (defects and honesty issues)

**F1 — The evaluation's "TA1" column is not TA1.** `ta2/evaluation.py` computes `ta1_*` with `BacktrackerAgent` (TA2 code, MRV ordering, forward checking). Real TA1 (`tot_solver.py`, first-empty cell, descending candidates) is never run. The TA1-vs-TA2 table is currently TA2-vs-TA2.

**F2 — Five cases are really four.** `test_puzzles()` returns BASE plus `MASKS[:4]`; `MASKS[0]` reproduces BASE exactly, so case 1 == case 2 (verified), and `MASKS[4]` is never used. All five *are* unique-solution puzzles (I counted solutions, capped at 2) and all have 8 empty cells, but the code never checks this.

**F3 — The TA2 MRV engine never backtracks, so the ToT metrics are degenerate.** On every case: 9 nodes, 0 pruned, 0 backtracks, 16 trace events, identical across all three candidate-order variants, so the vote is trivially 3–0. I also enumerated all 2,620 unique-solution puzzles with 4, 5 or 6 clues taken from the sample grid: MRV search backtracked or pruned on **none** of them. Consequences: (a) the two "documented pruned branches" in the README, the memory seeds and corpus chunks 3–4 describe TA1's search order, which TA2 never executes; (b) a mid-search checkpoint/resume demo needs a branching search, which MRV can't provide on these puzzles; (c) "candidate-order variants" are indistinguishable here.

**F4 — Supervisor.** `max_hops` is stored and echoed but never enforced; no hop counter, no routing trace, no timeout, no tool/call budget; an exception in a worker propagates through `pool.map`. Docstring calls the variants "independent search attempts".

**F5 — Checkpointer.** One node (`solve`) runs the whole search; `hops`/`max_hops` in state are unused; no mid-search state; the DB path is the repo root.

**F6 — Memory.** Never consulted by the solver (only printed). Single string `namespace`, no `user_id`, no `last_used`, patterns are free prose in 1-based coordinates and cannot be validated against a board. Restart persistence is plausible (SQLite file) but untested.

**F7 — RAG.** 10 well-labelled chunks (≥8 ✓), persistent Chroma ✓, `nomic-embed-text` ✓. But: no LLM answer, no relevance score or abstention, `get_vectorstore()` re-adds/re-embeds all 10 chunks on **every** query, default L2 distance with no cosine config, and re-adding the same IDs will not refresh edited chunk text. Chunk 8 says "independent solver attempts" (inaccurate). Corpus has no *solved examples*, which the Reasoning-topic Unit 3 item asks to retrieve.

**F8 — Qwen proposer is advisory *and* unusable today.** Returns free text, unparsed, not wired into the search. In my run it listed "2" for cells (3,2), (2,2), (4,2) when only one legal candidate existed. Good evidence for the "validate every suggestion" rule, but it needs a structured prompt plus a parse-and-filter step.

**F9 — No input validation.** A board with duplicate clues (`[[1,1,0,0],...]`) is not rejected: the solver burns 190 nodes and returns `None`. `valid_board` only handles complete boards; there is no partial-board/clue validator and no range or type check.

**F10 — TA1 files are import-hostile.** Top-level code runs on import, the puzzle is hardcoded, and `tot_solver.py` prints non-cp1252 characters. They can't be called per puzzle without editing them.

**F11 — Misc.** `Backtracker` returns `False` on `MAX_NODES` indistinguishably from "no solution"; trace cells are 1-based while boards are 0-based (spec §8.3 requires one documented convention); `requirements.txt` lacks pytest, and TA1 `cot_attempt.py` imports `ollama` which is only present transitively.

## 3. SOP requirement → code mapping

| Req | Status | What exists | Missing |
|---|---|---|---|
| U3-1 short-term memory | **Partial** | SqliteSaver + stable `thread_id` (`checkpointer.py`) | Any multi-turn flow; with/without-memory demo |
| U3-2 long-term memory | **Partial** | SQLite `memories` table, `put/get/all` | `(user_id, kind)` namespaces; created/last-used; retrieval by current board; validate-before-use; restart test; solver integration |
| U3-3 RAG | **Partial** | Chroma, nomic, 10 chunks, `k` param | Grounded Qwen answer; relevance threshold + "I don't know"; chunk-ID citations; efficient (non-reseeding) store; k=1/k=3 comparison trace |
| U3-4 tool/failure handling | **Missing** (TA1 tools preserved ✓) | — | Failure injection, catch/explain/route, recovery trace |
| U4-1 role design | **Partial** | `Proposer`, `RuleChecker`, `Backtracker`, `Supervisor` classes; README prose table | Five-field spec as code (name, goal, tools, inputs/outputs, limits) + contract tests; a distinct **Verifier** role (verification is currently inline) |
| U4-2 coordination | **Partial** | Supervisor runs 3 variants + vote | Enforced `MAX_HOPS`; routing trace; timeouts/budgets |
| U4-3 oversight/guardrail | **Missing** | — | Approval step (approved + rejected), injection guard, before/after evidence |
| U4-4 challenge analysis | **Missing** | Raw timings in `evaluation.json` | A deliberate measured challenge (cost calls/time and/or injection before/after) |
| Reasoning U3 | **Partial** | Dead-end notes in corpus | Retrieval of *solved examples*; persisted *mid-search* state |
| Reasoning U4 | **Partial** | Proposer, Rule Checker, vote | Separate Verifier; non-trivial voting; honest cost comparison vs single agent (needs real TA1 baseline, F1) |
| §12.1/12.2 tests | **Missing (0 tests)** | — | Everything |
| §9.3 / §6.4 trace + search-node models | **Missing** | Ad-hoc dict events | Pydantic `TraceEvent` / `SearchNode`, zero-based coords, 13 event names |
| Evaluation (§12.7) | **Broken** | Harness runs | F1, F2, uniqueness check, extra metrics, saved per-case traces |

## 4. Part B implementation plan (file by file; one small commit each)

0. **`git init`** + commit current state as baseline (needs your OK — see §7).
1. **Freeze TA1**: copy 3 files to `ta1/` byte-identical (verify SHA-256 against Appendix), update README (and the one stale reference in it), *then* remove `ta1_baseline_reference/`. Nothing imports it, so only README changes. Add `tests/test_ta1_frozen.py` checking the hashes.
2. **`ta2/sudoku_rules.py`** (new, pure logic, no I/O): `validate_board_shape`, `find_conflicts`, `is_complete_valid`, `candidates`, `count_solutions(limit=2)`, `has_zero_candidate_cell`. `agents.py` re-uses it (keeps `candidates`/`valid_board` names so nothing breaks).
3. **`tests/test_rules.py`** — all §12.1: valid complete board; row/col/box duplicate; contradictory puzzle; no solution; one / multiple solutions; candidate generation; zero-candidate dead end; clue preservation; sample puzzle uniqueness; count stops at 2.
4. **`ta2/models.py`** (new): Pydantic `TraceEvent`, `SearchNode`, `AgentContract` (five fields), `VoteResult`. Convention: **zero-based `[row, col]`, `0` = empty**, documented in the module docstring; human-readable text may say "row 1, col 2 (1-based)" only inside prose.
5. **`ta2/agents.py`**: formalize contracts (`CONTRACT` class attr per agent; a `Verifier` role added), Backtracker emits `TraceEvent`s / builds `SearchNode`s, `cell_strategy` ("mrv" default | "first_empty") and `order` options, distinguishes `exhausted` from `limit_reached`, validates clues up front. **`tests/test_agents.py`** — all §12.2 except supervisor items.
6. **`ta2/supervisor.py`**: enforced `MAX_HOPS`, routing trace `(hop, from, to, reason)`, per-run timeout and call budgets, worker exceptions caught and recorded, invalid/timed-out/partial results cannot vote, variants relabelled **"candidate-order variants"** (class and docstrings/corpus chunk 8). Tests: `MAX_HOPS` with a deliberately looping stub, invalid agent can't vote, no valid vote → no winner, vote reproducible from saved run data.
7. **`ta2/checkpointer.py`**: rewrite the solve as an *iterative* LangGraph (`select_cell → evaluate → apply/backtrack → verify`), explicit stack in state, checkpoint per decision, stable `thread_id`, `max_steps` pause, resume with `invoke(None, config)`. Test: run N steps, build a **fresh** graph/connection, resume, assert same solution as an uninterrupted run and that sequence numbers continue (no restart from root). Corrupt/missing checkpoint → recoverable error.
8. **`ta2/memory.py`**: tables `memories(user_id, kind, key, payload_json, created_at, last_used_at, use_count)`; namespaces `(user_id, "profile" | "puzzle_history" | "dead_ends")`; dead-end patterns stored structurally (`givens`, `cell`, `value`, `reason_code`). **A pattern applies only if its givens are a subset of the current board AND the dead end is re-confirmed deterministically**; otherwise logged as `memory_hit_rejected`. Tests: restart survival (subprocess), namespace isolation, poisoned/stale pattern cannot prune the correct branch.
9. **`ta2/chat_memory.py`** (new): small LangGraph multi-turn chat with SqliteSaver; with-memory (same `thread_id`) vs without (fresh thread). Unit tests use a fake chat model and assert on the messages the model *received*; the live demo uses real qwen2.5:3b and saves its trace.
10. **`ta2/rag.py`**: persistent store built once (content-hash check, rebuild on change), cosine space, `similarity_search_with_relevance_scores`, `answer(query, k)` → grounded Qwen answer with chunk-ID citations, retrieved text delimited as untrusted data, abstention ("I don't know") when relevance is below a threshold that I calibrate from measured scores and record, plus a model-side abstain instruction. Add a few corpus chunks of **solved examples generated by running the verified solver** (script, not hand-typed). Tests: ≥8 chunks (no Ollama), and k=1/k=3 + abstention marked `@pytest.mark.ollama` (skipped if Ollama is down).
11. **`ta2/guardrails.py`** + **`ta2/llm_proposer.py`**: structured JSON proposal, parse, filter against the deterministic candidate set; injection detector (rule-based, documented as non-exhaustive); LangGraph `interrupt()` human approval before an AI-suggested move touches the user puzzle. Paths: approved, rejected, injection. Qwen can never commit a move.
12. **`ta2/failure.py`** (or inside supervisor): `inject_failure(tool, times)` wrapper; catch → explain → bounded retry → route to fallback (e.g. RAG down → solve without retrieval; Qwen down → deterministic order). Recovery trace.
13. **`ta2/evaluation.py`**: 5 *distinct* cases, uniqueness asserted at runtime; **real TA1** run via a loader (decision D3); metrics per §12.7 (correct, nodes, time, solver/LLM/tool calls, pruned, memory/RAG use, vote outcome, failures); repeats for timing; writes `traces/` per case. U4-4 challenge: cost (calls/time, single vs multi-agent) **and** prompt-injection before/after.
14. **`ta2/main.py`**: new modes (`chat`, `approve`, `inject-failure`, `resume`, `guard-demo`), lazy imports (so `--mode memory` no longer dies if a heavy dependency is missing), UTF-8-safe printing; README rewritten with real commands, limitations and checklist; `requirements-dev.txt`.
15. **Run everything, save real traces** to `traces/` (un-ignore `traces/*.json` or keep the evidence copies — D6), final 10-item report.

## 5. Proposed architecture

### Phase 1 (Part B): Python engine, all runnable from CLI/pytest

```
main.py (CLI)
   │
   ▼
Supervisor (LangGraph, MAX_HOPS, budgets, routing trace)
   ├── Proposer ──► candidates (deterministic) ──► [optional Qwen order, parsed + filtered]
   ├── Evaluator/RuleChecker ──► row/col/box verdict + reason_code
   ├── Verifier/Backtracker ──► dead-end detect, restore parent, verify full board
   ├── Guardrail ──► injection filter + interrupt() human approval
   ├── Memory (SQLite, (user_id,kind)) ──► pattern applies only if re-confirmed
   ├── RAG (Chroma + nomic) ──► grounded Qwen answer | "I don't know"
   └── TraceStore ──► TraceEvent / SearchNode ──► traces/*.json
Checkpointer: LangGraph SqliteSaver, thread_id, one checkpoint per search decision
```
`sudoku_rules.py` is the single authority on validity; nothing in the LLM path can bypass it.

### Phase 2 (after your approval of that phase): FastAPI, a thin layer on `ta2`

```
backend/app/
  main.py              FastAPI app, CORS/env config, error envelope (§8.5)
  api/    puzzles.py solve.py agents.py memory.py rag.py history.py analytics.py
  schemas/             Pydantic: re-exports ta2.models + request/response types (§8.4)
  services/run_manager.py   starts a solve in a worker thread, owns run_id ⇄ thread_id
  persistence/         SQLite: runs, events(run_id, sequence PK), nodes, evaluations, approvals
```
- Solving logic stays in `ta2/`; the backend only orchestrates and persists. `run_id` maps 1:1 to a LangGraph `thread_id`.
- **Events are written to SQLite first, then streamed.** `/ws/solve/{run_id}?after=<seq>` replays missed events from the DB and then tails live ones, so reconnect and replay need no live socket and cannot duplicate (unique `(run_id, sequence)`). A terminal event (`search_completed | search_failed | cancelled`) always closes the stream.
- **Pause/resume/cancel** set a flag checked at the graph's safe boundary; state is checkpointed before the 200 is returned; resume = `invoke(None, thread_id)`.
- Endpoints exactly as spec §8.2; board = 4×4 ints, `0` = empty, zero-based `[row, col]`; errors never leak paths or stack traces.
- Backend host/port from env, not hardcoded.

## 6. Parts of the spec this plan deliberately does NOT claim

- The three variants stay "candidate-order variants", not agents. Given F3, I will also report plainly that on these puzzles they produce identical traces.
- Qwen is advisory; guard/injection detection is rule-based and non-exhaustive — the real protection is that no text can change a legal move set.
- The CoT baseline is non-deterministic; I will report measured outcomes, not an assumed failure.

## 7. Decisions needed from you before Part B

| # | Decision | My recommendation |
|---|---|---|
| D1 | **No git repo exists.** "Small commits" needs `git init`. | Yes — init here, commit baseline first. |
| D2 | Add **pytest** (dev-only, `requirements-dev.txt`). Pydantic is already installed transitively via LangChain; I'd import it directly rather than add anything else. | Approve both. |
| D3 | **Running real TA1 on five cases.** TA1 files hardcode the puzzle and run on import; they can't be called per case unmodified. Options: (a) loader that reads the frozen file's source, substitutes the `puzzle = [...]` literal *in memory only*, executes it with captured stdout, counts nodes from its own `search_tree`; (b) re-implement TA1 logic (not really TA1). | (a). Files stay byte-identical (hash test). CoT: run `cot_attempt.py` logic the same way (5 real Qwen calls), validated deterministically. |
| D4 | **MRV never backtracks (F3).** To demonstrate dead ends/pruning/mid-search resume I'll add a `cell_strategy` option: `mrv` (spec-preferred, default) and `first_empty` (TA1 order, which does branch on the sample). Evaluation reports both and states that MRV needs 0 backtracks here. | Approve. |
| D5 | **Coordinates**: zero-based `[row, col]` everywhere in code/trace/API. Prose in corpus/README stays human-style "(row 1, col 2)". | Approve. |
| D6 | `.gitignore` currently ignores `traces/*.json`, but the spec wants traces retained as evidence. | Stop ignoring `traces/`; keep DB/Chroma/venv ignored. |
| D7 | RAG corpus changes (fix chunk 8 wording, add solved-example chunks). Edits need a one-time Chroma rebuild; `chroma_db/` is local and gitignored. | Approve. |
| D8 | The existing global-env conflict (Flask/Werkzeug) is unrelated; I'll work only in `.venv` (Python 3.11.9). | Fine. |

Also note: the requirements doc (§2.4) states the SOP wants the *student* to implement and understand the modules, with AI help limited to debugging/explaining, plus an AI-assistance disclosure. That is your call, not mine — but if the course applies that rule, you may want to implement some modules yourself and use me to review, and either way the disclosure should be prepared.

## Appendix — TA1 baseline SHA-256 (taken before any change)

```
455118628fcf046aa03a690f66374655e9bb65c83a3dcc34f2f6c105b63ddd5c  cot_attempt.py
3a0cbe679dba36e678dc2f008cad11e456b18e2bf4b896ab85d45cf4f46f4698  sudoku_tot.py
f940cbca42585fa3b816cf77886e89c8905ad2c45a38969ffb1cf0424cf8415f  tot_solver.py
```
