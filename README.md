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
ta1/                frozen baseline (hash-checked)
ta2/                engine + agents + supervisor + memory + rag + oversight + evaluation
backend/            FastAPI app (routers, services, Pydantic schemas, SQLite persistence)
android/            Expo Router + React Native + TypeScript client
docs/               docs/API.md, docs/PHASE0_AUDIT.md
tests/              engine + Unit 3/4 pytest suites
traces/             real recorded demo evidence (produced by ta2/demos.py)
requirements.txt    runtime deps (langchain, langgraph, langchain-chroma, chromadb)
requirements-dev.txt    pytest
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
python -m ta2.main --mode evaluate                   # five-case TA1-vs-TA2 evaluation
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

1. **Qwen 3B is a weak Sudoku player.** In the recorded runs it rarely proposed a legal move for the
   sample board (see `oversight.json`, `challenge_injection.json`), even with no attack. It is advisory
   only: every suggestion passes the deterministic filter, and the approval demo uses a clearly labelled
   deterministic stand-in for the approve/reject paths because the real model offered no legal move.
2. The injection detector is rule-based and not exhaustive. The real protection is that no text can
   change which moves are legal, and nothing is applied without validation and human approval.
3. TA2's MRV search does not backtrack on the unique-solution 4×4 puzzles tested (naked singles suffice),
   so dead ends, pruning and mid-search resume are demonstrated with the TA1 cell order (`first_empty`).
4. TA1 CoT is non-deterministic; its recorded outcomes are single samples.
5. "Nodes" are counted differently for TA1 (`Try` lines in its own search tree) and TA2 (search nodes
   created, including the root); compare trends, not exact equality.
6. Timing differences between the deterministic solvers are microseconds; the multi-agent run costs more
   (3 solver runs, thread-pool overhead) without being more correct on these puzzles.
7. The RAG relevance threshold (0.53) was calibrated on 16 queries; it is a measured separation on a
   small set, not a general guarantee.
8. The API has no authentication and is meant for a trusted local network; see `docs/API.md` §10.
9. On the Android emulator, the app cannot reach a loopback-only backend through `10.0.2.2` — only through
   `adb reverse`. The cause is unidentified; the fallback is documented in `android/README.md`.
10. The Analytics tab, history replay with playback, APK release and physical-device test are not built
    yet (planned for Phase 5).

## Report evidence checklist

- [x] Dead-end / pruning trace (`checkpoint_resume.json`, `eval_case*_ta1_tot_search_tree.json`)
- [x] RAG k=1 vs k=3 and an unanswerable query (`rag_k1_k3.json`)
- [x] Stop/restart long-term memory (`long_term_memory.json`)
- [x] Checkpoint DB + stable thread ID + mid-search resume (`checkpoint_resume.json`)
- [x] Voting table with valid flag, nodes, time (`supervisor_routing.json`)
- [x] Five-case TA1 vs TA2 table (`evaluation.json`)
- [x] Injected failure and recovery; approved/rejected/injection paths
- [x] Role table (above) and contracts in code
- [ ] Analytics tab in the app; history playback; APK on a physical device
- [ ] Contribution table and AI-assistance disclosure (for your own declaration; the SOP requires it)

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
submission (see **Report evidence checklist** above and `SUDOKUMIND_AI_REQUIREMENTS.md` §2.4).

## License

No license file is included; all rights reserved by the repository owner unless stated otherwise.
