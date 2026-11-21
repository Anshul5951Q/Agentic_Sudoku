# Limitations and trade-offs (measured, not assumed)

Numbers refer to `docs/report/FIVE_CASE_TABLE.md`, generated from `traces/evaluation.json`. Re-read them after every
re-run; they change between runs.

1. **Qwen 2.5 3B is a weak Sudoku solver.** In the latest evaluation TA1 CoT solved 0 of 5 cases (an earlier recorded
   run solved 1 of 5, see `traces/challenge_cost.json`) at ~22–39 s per call. CoT outcomes are single non-deterministic
   samples. The model is advisory everywhere else and every suggestion passes the deterministic filter.
2. **Multi-agent costs more and is not more correct here.** Three candidate-order variants cost ≈3× the nodes and
   several times the time of one MRV solver, with the same 5/5 correctness. The value is a consistency check and fault
   tolerance: a crashed, timed-out or invalid variant is excluded and never changes the answer (challenge table).
3. **The variants are not independent LLM agents.** They are one deterministic solver with different candidate orders;
   a 3–0 vote is not evidence of independent reasoning.
4. **Sequential beat parallel on these puzzles.** Each variant takes about a millisecond, so thread-pool overhead
   outweighs any parallel speed-up. Parallelism would only pay off for much longer solver runs.
5. **MRV rarely backtracks on unique 4×4 puzzles** (naked singles suffice), so dead ends, pruning, memory recall and
   mid-search resume are demonstrated with the TA1 cell order (`first_empty`).
6. **Memory helps only on repeats.** Long-term memory removed every dead end on the repeat run of cases with dead ends
   (and changed nothing on cases with none). Node counts were unchanged in the measurement (e.g. case 1: 11 → 11), so the
   gain is fewer dead-end explorations, not a smaller tree.
7. **The prompt-injection pattern guard is not exhaustive.** It blocked all 6 obvious attacks and 0 of 4 disguised ones.
   Safety comes from the deterministic legality check and human approval, which stopped every illegal move in the live
   Qwen measurement.
8. **The RAG threshold (0.53) was calibrated on 16 queries.** It is a measured separation on a small set, not a guarantee.
9. **Node counts differ by definition** between TA1 ("Try" lines) and TA2 (nodes created, including the root). Compare trends.
10. **Timing is machine-dependent.** Deterministic times are medians of 5 runs on one laptop; CoT times depend on Ollama load.
11. **No authentication.** The API is for a trusted local network only (`docs/LOCAL_NETWORK.md`).
12. **Emulator networking:** `10.0.2.2` against a loopback-only backend timed out (cause not found); `adb reverse` works.
13. **The APK is signed with the debug keystore** (Expo template default). Fine for installing locally, not for store release.
14. **Multi-agent and CoT runs are atomic.** They cannot be paused; their events are written when the run ends.
15. **Physical-device testing:** see the Definition of Done in the project README for what was and was not done on real hardware.
