# Sudoku Mini-Puzzle Solver — TA2 Extension

This extension preserves the supplied TA1 scripts as references and adds Unit 3 memory/RAG/checkpointing and Unit 4 role-based agents, voting, and evaluation. It uses local Ollama models only; no paid API or live internet is called by the agent.

## Stack
- Python 3.11 recommended
- Ollama models: `qwen2.5:3b` and `nomic-embed-text`
- LangChain v1, LangGraph, `langgraph-checkpoint-sqlite`, Chroma via `langchain-chroma`
- SQLite for long-term memory and LangGraph checkpoints

## 1. Freeze the TA1 baseline
Copy your existing TA1 files into `ta1/` and do not edit them. In this delivered package, `ta1_baseline_reference/` is a reminder folder; copy your original `cot_attempt.py`, `sudoku_tot.py`, and `tot_solver.py` into it or rename it to `ta1/` before submission. Keep TA2 code separate under `ta2/`.

## 2. Install local models
Install/start Ollama, then run:
```powershell
ollama pull qwen2.5:3b
ollama pull nomic-embed-text
ollama list
```
Keep Ollama running. The core deterministic solver works without calling an LLM; RAG requires `nomic-embed-text` locally.

## 3. Create environment and install packages
From the project root in PowerShell:
```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

## 4. Run commands
Run commands from the project root so imports and data paths resolve.
```powershell
# Full demo: persistent memory + local RAG + three solver runs + vote + search trace
python -m ta2.main --mode solve

# Seed/read persistent dead-end memory (SQLite)
python -m ta2.main --mode memory

# RAG retrieval comparison; run once with k=1 and once with k=3
python -m ta2.main --mode rag --k 1 --query "What happens when a cell has no candidates?"
python -m ta2.main --mode rag --k 3 --query "What happens when a cell has no candidates?"

# LangGraph SQLite checkpoint, using a stable thread ID
python -m ta2.main --mode checkpoint --thread-id demo-001

# Five-case TA1-vs-TA2 measured evaluation
python -m ta2.main --mode evaluate
```

Outputs are written under `traces/`. Keep the actual console output and JSON files for your report. Do not invent or manually estimate measurements.

## Architecture / roles
- **ProposerAgent**: selects an empty cell with the fewest candidates and proposes legal candidates.
- **RuleCheckerAgent**: checks each proposed placement against row, column and 2x2 box constraints.
- **BacktrackerAgent**: explores candidates, detects zero-candidate dead ends, restores state, and records the trace.
- **Supervisor**: runs three candidate-order variants in parallel, verifies completed grids and votes only among valid results. This is a controlled baseline for distributed voting; the variants are not claimed to be three different LLMs.
- **Memory**: SQLite table of reusable dead-end patterns.
- **RAG**: Chroma persistent vector store, populated from 10 labeled chunks in `ta2/corpus/sudoku_knowledge.txt`, embedded with local `nomic-embed-text`.
- **Checkpoint**: LangGraph SQLite checkpointer and `thread_id` for persisted workflow state.

## Honest limitations / SOP notes
1. The checkpointer stores LangGraph workflow state, but this example graph is a one-step solve graph; it does not yet pause interactively at every search decision. The detailed branch history is saved as a JSON trace. For a live resume-from-mid-branch demonstration, extend the graph to checkpoint individual search decisions.
2. The three parallel attempts vary candidate order but share the same deterministic constraint engine. Describe this accurately in the report; a majority vote is not evidence of independent model intelligence.
3. The proposer/evaluator/backtracker roles are implemented as Python agents. To use `qwen2.5:3b` as an LLM-based proposer, add a model suggestion step but always validate it with `RuleCheckerAgent`; never trust unverified model output.
4. The five evaluation cases are generated from a known valid grid and a sample puzzle. Run the harness and retain measured outputs. Check each test's uniqueness separately if claiming every puzzle has a unique solution.
5. SOP requires a grounded answer that says “I don't know” if the answer is absent. The current RAG CLI displays retrieved evidence and a grounded-response instruction rather than generating free-form LLM answers. Add a local `ChatOllama(model='qwen2.5:3b')` grounded answer node if your course expects a conversational RAG answer, and test an unanswerable question.
6. TA2 SOP requires short-term memory across turns, long-term memory across restart, RAG with at least 8 chunks, failure routing, a guardrail/approval path, a supervisor hop limit, five identical TA1-vs-TA2 cases, and a challenge cost/error analysis. The code demonstrates key foundations; verify the remaining rubric items and add their traces before submission.

## Report evidence checklist
- [ ] Screenshot/console output for the two documented pruned branches.
- [ ] RAG output for k=1 and k=3, plus an unanswerable query.
- [ ] Stop/restart SQLite memory demonstration.
- [ ] Checkpoint database and stable thread ID trace.
- [ ] Voting table showing each attempt's valid flag, solution, nodes, time, and vote.
- [ ] Five-case TA1 vs TA2 table with actual run measurements.
- [ ] Injected failure and recovery trace; guardrail approved/rejected path.
- [ ] Role table with name, goal, tools, inputs/outputs, and limits.
- [ ] Contribution table and short AI-assistance disclosure, per SOP.

## Original sample puzzle
```
. . 3 4
3 4 . .
. 1 4 .
4 . . 1
```
Expected solution:
```
1 2 3 4
3 4 1 2
2 1 4 3
4 3 2 1
```
