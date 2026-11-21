# SudokuMind AI

A 4×4 Sudoku solver that makes **reasoning, search, backtracking, memory and multi-agent coordination
visible and inspectable**. Local-only: Ollama `qwen2.5:3b` and `nomic-embed-text`; no paid API, no
cloud model, no internet call by the agent. **Deterministic Sudoku validation is always authoritative;
LLM output is advisory.**

The project has four layers that share one deterministic engine:

- `ta1/` — the frozen baseline (single CoT attempt and a plain Tree-of-Thought solver). **Hash-checked, never edited.**
- `ta2/` — the TA2 extension: iterative ToT engine, five-field agent contracts, supervisor with `MAX_HOPS`,
  LangGraph-SQLite checkpoints resumable per decision, namespaced long-term memory, short-term chat memory,
  grounded RAG with abstention, failure injection/recovery, human-approval oversight, evaluation harness.
- `backend/` — a FastAPI wrapper around `ta2/` (puzzles, CoT/ToT/multi-agent runs with persisted traces,
  WebSocket streaming with reconnect, pause/resume/cancel, memory, RAG, history, analytics, evaluation,
  human approval). Full reference: [docs/API.md](docs/API.md).
- `android/` — an Expo Router (React Native + TypeScript) client: Home, Play (board, validation, uniqueness,
  save/load, Solve-with-AI), AI Lab (agent cards, routing with MAX_HOPS, votes with exclusions, approval),
  Memory (thread / long-term / dead-end library / RAG), Search Tree (board + playback + node inspector +
  live WebSocket). Details: [android/README.md](android/README.md).

Conventions: boards are 4×4 lists of ints, `0` = empty; coordinates are **zero-based `[row, col]`** in
code, traces, API and UI.

## Status

Phases 0–4 are built and tested. Phase 5 (history and analytics screens, hardening, APK release) is not
yet started. See **Honest limitations** below and the per-phase reports in the git log.

- **Backend + engine:** 262 pytest tests passing (Unit 3/4 behaviour, agents, checkpointing, memory,
  oversight, RAG offline + live Ollama paths, API routes, WebSocket).
- **Android app:** 192 Jest tests passing (components, screens, connection fallback, trace replay against
  **real recorded backend traces**, WebSocket client).
- **On device (Pixel_10a emulator):** Play, AI Lab (agent cards, routing, votes, approval, resume after a
  real backend kill), Memory (thread / RAG unanswerable) and the Search Tree with the WebSocket client
  have been exercised end-to-end against real local Qwen and Chroma.

## Structure

```
ta1/                frozen baseline (hash-checked, never edited)
ta2/                engine + agents + supervisor + memory + rag + oversight + evaluation (also a CLI)
backend/            FastAPI app (routers, services, Pydantic schemas, SQLite persistence) + its tests
android/            Expo Router + React Native + TypeScript client + Jest tests
traces/             real recorded evidence (CLI runs: python -m ta2.main --mode demos / evaluate)
tests/              engine + Unit 3/4 pytest suites
scripts/            record_app_fixtures.py (Jest fixtures from the real backend), build_report_tables.py
docs/               API.md, LOCAL_NETWORK.md, DEMO_SCRIPT.md, TESTING.md, EVIDENCE_CHECKLIST.md, PHASE0_AUDIT.md
docs/report/        report-evidence package: ARCHITECTURE, ROLE_TABLE, COMPONENT_CHECKLIST, FIVE_CASE_TABLE,
                    LIMITATIONS, CONTRIBUTION_TABLE (template), AI_ASSISTANCE_DISCLOSURE (template)
```

## Quickstart

### 1. Local models and Python

```powershell
ollama pull qwen2.5:3b
ollama pull nomic-embed-text
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt -r requirements-dev.txt -r backend/requirements.txt
```

Everything runs from the project root. Data locations default there and can be moved with `SUDOKU_DATA_DIR`
/ `SUDOKU_TRACE_DIR`.

### 2. The CLI demos (write real evidence to `traces/`)

```powershell
python -m ta2.main --mode solve                      # supervisor + 3 candidate-order variants + verified vote
python -m ta2.main --mode checkpoint --thread-id demo-001   # pause after 10 decisions, reconnect, resume
python -m ta2.main --mode resume --thread-id demo-001       # resume any thread from its last checkpoint
python -m ta2.main --mode memory                     # long-term memory: restart persistence + dead-end recall
python -m ta2.main --mode chat                       # short-term memory with vs without a thread (real Qwen)
python -m ta2.main --mode rag --k 1 --query "What does backtracking restore?"
python -m ta2.main --mode rag --k 3 --query "Who won the 2018 football world cup?"   # -> I don't know.
python -m ta2.main --mode inject-failure             # tool failure -> retry / fallback recovery trace
python -m ta2.main --mode hop-limit                  # annotated routing trace + MAX_HOPS stop
python -m ta2.main --mode approve                    # approved / rejected / prompt-injection paths
python -m ta2.main --mode challenge                  # prompt-injection before/after (real Qwen calls)
python -m ta2.main --mode evaluate                   # five-case TA1-vs-TA2 evaluation (+ sequential vs parallel, challenge, RAG k=1/k=3)
python scripts/build_report_tables.py                # regenerate docs/report/FIVE_CASE_TABLE.md and ROLE_TABLE.md from traces/
python -m ta2.main --mode demos                      # all of the above, saved to traces/
```

### 3. Backend

```powershell
python -m backend                           # http://127.0.0.1:8000, Swagger at /docs
```

Host/port from `SUDOKU_API_HOST` / `SUDOKU_API_PORT`; **no hardcoded IPs** in source. CORS for Expo dev
(`localhost`/`127.0.0.1`) is allowed by default; add more with `SUDOKU_CORS_ORIGINS`.

### 4. Android app

```powershell
cd android
npm install
npx expo start --android       # starts Metro and opens Expo Go on a running emulator
```

Base URL lookup, in order: Settings override → `EXPO_PUBLIC_API_BASE_URL` → Expo dev-server host →
emulator alias `10.0.2.2`. For an emulator against a loopback-only backend, the verified route is
`adb reverse tcp:8000 tcp:8000` + `EXPO_PUBLIC_API_BASE_URL=http://localhost:8000`.

### 4b. Installable APK

See [android/README.md](android/README.md#build-the-apk-local-no-cloud-build) (`npm run prebuild:android`, `npm run build:apk`,
`adb install`). Connect a phone with [docs/LOCAL_NETWORK.md](docs/LOCAL_NETWORK.md).

### 5. Tests

```powershell
python -m pytest -q                       # engine + API; live-Ollama tests auto-skip if it is down
python -m pytest -q -m "not ollama"       # pure offline
cd android ; npm test                     # 192 Jest tests
```

## Architecture / roles

Five-field contracts live in [`ta2/agents.py`](ta2/agents.py) and [`ta2/supervisor.py`](ta2/supervisor.py);
the backend exposes them at `GET /api/agents/contracts` and the app shows them on each agent card.

| Role | Goal | Tools | Inputs → outputs | Limits |
|---|---|---|---|---|
| **Proposer** | choose next cell + candidate order | candidate generator; optional Qwen ordering hint | board, strategy, order → cell, legal candidates | cannot commit; output is always a permutation of the legal set |
| **Evaluator / RuleChecker** | judge one placement | row/column/box validator | board, cell, value → verdict + reason code | one placement only; cannot declare a puzzle solved |
| **Verifier / Backtracker** | detect dead ends, restore exact parent, verify boards | `SearchEngine`, state stack, validator | partial state → branch status / verified solution | must restore exact parent; cannot accept an unverified solution |
| **Supervisor** | route work, enforce policy, tally votes | router, `ToolRunner`, trace recorder | puzzle + config → routing trace, `VoteResult`, verified winner or failure | `MAX_HOPS`, timeout, node/tool budgets; invalid/partial/timed-out attempts never vote |

**Modules:** `sudoku_rules.py` (pure validity logic) · `search.py` (iterative one-decision-per-step engine) ·
`agents.py` · `supervisor.py` · `checkpointer.py` (LangGraph + SQLite, one checkpoint per decision) ·
`memory.py` (namespaced SQLite) · `chat_memory.py` · `rag.py` · `llm_proposer.py` · `oversight.py` ·
`failure.py` · `models.py` (`TraceEvent`, `SearchNode`, `AgentContract`, `VoteResult`) · `evaluation.py` ·
`ta1_runner.py` · `demos.py`.

## What the three parallel solvers are (and are not)

They are **candidate-order variants** of one deterministic solver (`asc`, `desc`, `middle`). They are
**not independent LLM agents**, and a 3–0 vote among them is a consistency check, not evidence of
independent reasoning. On most unique-solution puzzles they produce identical traces.

## Evidence → files in `traces/` (all produced by real runs)

| SOP item | File |
|---|---|
| U3-1 short-term memory (with vs without) | `short_term_memory.json` |
| U3-2 long-term memory, restart, recall | `long_term_memory.json` |
| U3-3 RAG k=1/k=3, "I don't know" | `rag_k1_k3.json`, `rag_calibration.json` |
| U3-4 failure injection + recovery | `failure_recovery.json` |
| search-state checkpoint / mid-search resume | `checkpoint_resume.json` |
| U4-2 routing trace, MAX_HOPS | `supervisor_routing.json` |
| U4-3 approved / rejected / injection | `oversight.json` |
| U4-4 challenge (cost; prompt injection) | `challenge_cost.json`, `challenge_injection.json` |
| five-case TA1 vs TA2 | `evaluation.json`, `eval_case*_*.json` |

## Honest limitations

The full list, with the measured numbers behind each point, is [docs/report/LIMITATIONS.md](docs/report/LIMITATIONS.md). In short:
Qwen 3B CoT is usually wrong on these puzzles; multi-agent costs ≈3× the nodes and several times the time of one solver
without being more correct here; sequential dispatch beat the thread pool on 4×4; the injection pattern guard misses
disguised attacks (the deterministic legality check and human approval catch them); MRV rarely backtracks, so dead ends are
shown with the TA1 cell order; the API has no authentication; the APK is debug-signed.

## Report evidence

* Demo walkthrough (spec §16, 19 steps, recorded-replay fallback): [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)
* Evidence checklist mapped to spec §17: [docs/EVIDENCE_CHECKLIST.md](docs/EVIDENCE_CHECKLIST.md)
* Report package: [docs/report/](docs/report/)
* Regression and recovery matrix: [docs/TESTING.md](docs/TESTING.md)

## Original sample puzzle

```
. . 3 4
3 4 . .
. 1 4 .
4 . . 1
```

Unique solution (verified by `count_solutions`):

```
1 2 3 4
3 4 1 2
2 1 4 3
4 3 2 1
```

## AI assistance disclosure

This project was developed with Claude Code (Anthropic) assistance across all phases. The academic
course requires the student to write their own contribution table and AI-assistance disclosure before
submission: templates are in [docs/report/CONTRIBUTION_TABLE.md](docs/report/CONTRIBUTION_TABLE.md) and
[docs/report/AI_ASSISTANCE_DISCLOSURE.md](docs/report/AI_ASSISTANCE_DISCLOSURE.md).

## License

No license file is included; all rights reserved by the repository owner unless stated otherwise.
