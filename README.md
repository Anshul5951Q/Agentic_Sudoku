# Sudoku Mini-Puzzle Solver — TA2 Extension

TA1 (frozen in `ta1/`) is a single CoT attempt plus a Tree-of-Thought solver. TA2 (`ta2/`) adds Unit 3
(short-term memory, long-term memory, RAG, failure handling, resumable search checkpoints) and Unit 4
(role agents with contracts, a supervisor with `MAX_HOPS`, human approval/guardrails, verified voting,
challenge analysis). Everything runs locally: Ollama `qwen2.5:3b` and `nomic-embed-text` only, no paid
API, no cloud model, no internet call by the agent. **Deterministic validation is always authoritative.**

Conventions: boards are 4x4 lists of ints, `0` = empty; coordinates are **zero-based `[row, col]`**
everywhere in code and traces.

## Setup
```powershell
ollama pull qwen2.5:3b
ollama pull nomic-embed-text
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt -r requirements-dev.txt
```
Run everything from the project root. Data locations default to the project root and can be moved with
`SUDOKU_DATA_DIR` / `SUDOKU_TRACE_DIR`.

## Run
```powershell
python -m ta2.main --mode solve                      # supervisor + 3 candidate-order variants + verified vote
python -m ta2.main --mode solve --strategy mrv       # MRV cell selection (TA1 order is the default here: it branches)
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
python -m ta2.main --mode evaluate                   # five-case TA1-vs-TA2 evaluation (--no-cot skips real Qwen CoT calls)
python -m ta2.main --mode demos                      # all of the above, saved to traces/
python -m ta2.corpus_build                           # regenerate the solved-example RAG chunks from the real solver
```

## Tests
```powershell
python -m pytest -q                 # offline logic tests + tests that use local Ollama (auto-skipped if it is down)
python -m pytest -q -m "not ollama"
```

## Architecture / roles (five-field contracts live in `ta2/agents.py`, `ta2/supervisor.py`)
| Role | Goal | Tools | Inputs → outputs | Limits |
|---|---|---|---|---|
| **Proposer** | choose next cell + candidate order | candidate generator; optional Qwen ordering hint | board, strategy, order → cell, legal candidates | cannot commit; output is always a permutation of the legal set |
| **Evaluator / RuleChecker** | judge one placement | row/col/box validator | board, cell, value → verdict + reason code | one placement only; cannot declare a puzzle solved |
| **Verifier / Backtracker** | detect dead ends, restore exact parent, verify boards | `SearchEngine`, state stack, validator | partial state → branch status / verified solution | must restore exact parent; cannot accept an unverified solution |
| **Supervisor** | route work, enforce policy, tally votes | router, `ToolRunner`, trace recorder | puzzle + config → routing trace, `VoteResult`, verified winner or failure | `MAX_HOPS`, timeout, node/tool budgets; invalid/partial/timed-out attempts never vote |

Modules: `sudoku_rules.py` (pure validity logic) · `search.py` (iterative one-decision-per-step engine) ·
`agents.py` · `supervisor.py` · `checkpointer.py` (LangGraph + SQLite, one checkpoint per decision) ·
`memory.py` (namespaced SQLite) · `chat_memory.py` · `rag.py` · `llm_proposer.py` · `oversight.py` ·
`failure.py` · `models.py` (`TraceEvent`, `SearchNode`, `AgentContract`, `VoteResult`) · `evaluation.py` ·
`ta1_runner.py` · `demos.py`.

## What the three parallel solvers are (and are not)
They are **candidate-order variants** of one deterministic solver (`asc`, `desc`, `middle`). They are not
independent LLM agents and a 3–0 vote among them is a consistency check, not independent reasoning. On
many puzzles they produce identical traces.

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
1. **Qwen 3B is a weak Sudoku player.** In the recorded runs it never proposed a legal move for the sample
   board (see `oversight.json`, `challenge_injection.json`), even with no attack. It is advisory only: every
   suggestion passes the deterministic filter, and the approval demo for the approved/rejected paths uses a
   clearly labelled deterministic stand-in because the real model offered no legal move.
2. The injection detector is rule-based and not exhaustive. The real protection is that no text can change
   which moves are legal and nothing is applied without validation and human approval.
3. TA2's MRV search never backtracks on unique-solution puzzles from the grids tested (naked singles suffice),
   so dead ends, pruning and mid-search resume are demonstrated with the TA1 cell order (`first_empty`).
4. TA1 CoT is non-deterministic; its recorded outcomes are single samples.
5. "Nodes" are counted differently for TA1 (`Try` lines in its own search tree) and TA2 (search nodes
   created, including the root); compare trends, not exact equality.
6. Timing differences between the deterministic solvers are microseconds; the multi-agent run costs more
   (3 solver runs, thread pool overhead) without being more correct on these puzzles.
7. The RAG relevance threshold (0.53) was calibrated on 16 queries of mine; it is a measured separation on a
   small set, not a general guarantee.
8. Not built yet: FastAPI backend and Android app (Phases 2–4); approvals are persisted in the LangGraph
   checkpoint database, not yet a dedicated table.

## Report evidence checklist
- [x] Dead-end / pruning trace (`checkpoint_resume.json`, `eval_case*_ta1_tot_search_tree.json`)
- [x] RAG k=1 vs k=3 and an unanswerable query (`rag_k1_k3.json`)
- [x] Stop/restart long-term memory (`long_term_memory.json`)
- [x] Checkpoint DB + stable thread ID + mid-search resume (`checkpoint_resume.json`)
- [x] Voting table with valid flag, nodes, time (`supervisor_routing.json`)
- [x] Five-case TA1 vs TA2 table (`evaluation.json`)
- [x] Injected failure and recovery; approved/rejected/injection paths
- [x] Role table (above) and contracts in code
- [ ] Contribution table and AI-assistance disclosure (you must write these; the SOP requires your own declaration)

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
