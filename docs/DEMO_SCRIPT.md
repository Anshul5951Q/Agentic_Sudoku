# SudokuMind AI: demo and jury walkthrough (spec §16)

Every step below uses **live execution data** from the local backend, local Qwen (`qwen2.5:3b`), `nomic-embed-text`
and Chroma. If the network or runtime fails mid-demo, use the **recorded-replay fallback** at the end and say
out loud that it is a recording.

## 0. Before the jury arrives (10 minutes)

```powershell
ollama list                                   # qwen2.5:3b and nomic-embed-text must be listed
.\.venv\Scripts\Activate.ps1
$env:SUDOKU_DATA_DIR = "$PWD\.live_data"      # keep demo data out of the repo root (git-ignored)
python -m backend                             # loopback only: phone reaches it through adb reverse (see LOCAL_NETWORK.md)
```

Phone: USB debugging on, then `adb reverse tcp:8000 tcp:8000`, open **SudokuMind AI** and check that the header
badges read **API connected** and **LLM ready**. Check that **Analytics → Run evaluation now** has at least one
stored evaluation (tick *TA1 CoT* once beforehand; it makes five real Qwen calls).

## 1–19. Walkthrough

| # | Spec step | Where in the app | What to point at (all live data) |
|---|---|---|---|
| 1 | Open SudokuMind AI | launcher icon | Home: Status card shows App / Backend / Ollama separately |
| 2 | Load the sample puzzle | **Play → Load sample** | clues shown in dark ink; zero-based coordinates |
| 3 | Validate the puzzle | **Validate**, then **Check uniqueness** | "No rule violations"; "unique solution" (counted by the backend) |
| 4 | Run CoT and show its actual outcome | **Solve with AI → CoT (LLM)** | the run's real outcome; if Qwen's grid is wrong it says *incorrect*, with the rule violations |
| 5 | Run ToT and display candidate branches | **Solve with AI → ToT**, strategy **First empty (TA1 order)** | live search tree; candidate chips at each step |
| 6 | Pick a dead-end branch, explain the pruning | **Events → Dead ends & pruning**, tap the event, then tap the red node | Node inspector: `[ZERO_CANDIDATES]` / reason text, board at that node |
| 7 | Show backtracking to a prior state | filter **Backtracks**, step **◀ / ▶** | the board returns to the exact parent snapshot |
| 8 | Show the verified solution | **⏭** (end) | "Verified solution" card: every row/column/box and all clues re-checked |
| 9 | Run Multi-Agent mode | **AI Lab → Normal → Start run** | three candidate-order variants dispatched by the Supervisor |
| 10 | Show Proposer / Evaluator / Verifier activity | **AI Lab → Agents** | agent cards with the five-field contract, status and last message |
| 11 | Show Supervisor routing and the hop limit | **Routing** tab; then preset **Hop limit = 3 → Start run** | annotated hops; the run stops with `HOP_LIMIT_EXCEEDED` |
| 12 | Voting table, verified votes only | preset **Invalid variant → Start run → Votes** | the invalid board is listed under *excluded* and never votes |
| 13 | Save the session | **Play → Save** | appears in **Home → History and replay** |
| 14 | Restart backend, resume/recall state | start the backend with `$env:SUDOKU_STEP_DELAY="0.5"` so a ToT run lasts long enough, start a ToT run, `Ctrl+C` the backend, start it again; **History → session → Resume from checkpoint** | run status `interrupted` → resumes from the checkpoint (`search_resumed` event), not from the root. Memory: **Memory → Long-term** still lists the learned dead ends |
| 15 | RAG question with retrieved evidence | **Memory → RAG → Example: backtracking → Compare k=1 and k=3** | chunk IDs, similarity scores, grounded answer |
| 16 | Unanswerable question | **Example: unanswerable** | `I don't know.`, with the reason (below the relevance threshold) |
| 17 | Inject a controlled tool failure, show recovery | **AI Lab → Tool failure + retry → Start run** | `tool_failure` → retry → recovered; preset **Tool stays down** shows graceful degradation |
| 18 | Human approval and rejection | **AI Lab → Human approval**: **Approve** once, **Reject** once, then **Try a rule-override instruction** | approved move applied after validation; rejected move not applied; injection blocked before any model call |
| 19 | Analytics: TA1 vs TA2 on five cases | **Analytics** | five-case table (tap a cell: the recorded trace behind it), charts, single vs multi-agent cost, sequential vs parallel, memory on/off, RAG k=1 vs k=3, voting, challenge analysis |

### Talking points the numbers support (read them from the screen, never from memory)
* The multi-agent run **costs more** (≈3× nodes, several × time) and is **not more correct** on these puzzles: the trade-off sentence is computed from the stored evaluation.
* On 4×4 puzzles, **sequential** dispatch of the three variants was measured faster than the thread pool. Each variant finishes in about a millisecond, so the pool's overhead dominates.
* Disguised prompt injections pass the pattern guard; the deterministic legality check plus human approval is what actually stops them (challenge table).

## Recorded-replay fallback (network or runtime failure)

1. **Backend unreachable:** Home and History show **Open bundled recorded replay (offline)**. It replays two traces
   recorded earlier from the real backend: ToT with dead ends and backtracking, and a multi-agent vote. The
   header says **"RECORDED REPLAY bundled with the app … NOT a live run"**, and there are no pause/resume controls.
2. **Backend up, Ollama down:** every finished run opens as **RECORDED REPLAY of the stored trace (not a live run)**
   from History. Deterministic ToT and multi-agent runs still work live without Ollama; CoT, RAG and the Qwen
   proposer fail with an explicit `OLLAMA_UNAVAILABLE`.
3. **Evidence files:** `traces/*.json` hold the recorded CLI evidence (see `docs/EVIDENCE_CHECKLIST.md`).

Say "this is a recording from <date>" whenever a fallback is used. Never present a replay as a live run.
