# Five-case evaluation: TA1 vs TA2

Source: `traces/evaluation.json` (generated 2026-11-21T09:30:05.830316+00:00, LLM `qwen2.5:3b`). median of 5 runs for deterministic solvers; TA1 CoT is a single real Qwen call. Regenerate with `python -m ta2.main --mode evaluate` then `python scripts/build_report_tables.py`.

## Correctness, nodes, time per case

| Case | TA1 CoT | TA1 ToT | TA2 single (MRV) | TA2 single (TA1 order) | TA2 multi-agent (parallel) | TA2 multi-agent (sequential) | TA2 multi-agent + RAG |
|---|---|---|---|---|---|---|---|
| 1. assignment-sample (8 empty) | ✗ · n/a nodes · 24.24 s | ✓ · 10 nodes · 1.050 ms | ✓ · 9 nodes · 0.969 ms | ✓ · 11 nodes · 1.045 ms | ✓ · 27 nodes · 5.060 ms | ✓ · 27 nodes · 3.767 ms | ✓ · 27 nodes · 35.590 ms |
| 2. generated-6-clues (10 empty) | ✗ · n/a nodes · 29.72 s | ✓ · 10 nodes · 0.950 ms | ✓ · 11 nodes · 1.227 ms | ✓ · 11 nodes · 1.075 ms | ✓ · 33 nodes · 5.782 ms | ✓ · 33 nodes · 4.704 ms | ✓ · 33 nodes · 34.482 ms |
| 3. generated-5-clues (11 empty) | ✗ · n/a nodes · 21.99 s | ✓ · 11 nodes · 1.076 ms | ✓ · 12 nodes · 1.331 ms | ✓ · 12 nodes · 1.045 ms | ✓ · 36 nodes · 5.933 ms | ✓ · 36 nodes · 4.790 ms | ✓ · 36 nodes · 25.073 ms |
| 4. generated-4-clues (12 empty) | ✗ · n/a nodes · 30.30 s | ✓ · 15 nodes · 1.012 ms | ✓ · 13 nodes · 1.434 ms | ✓ · 16 nodes · 1.531 ms | ✓ · 39 nodes · 7.071 ms | ✓ · 39 nodes · 5.833 ms | ✓ · 39 nodes · 31.174 ms |
| 5. generated-6-clues-b (10 empty) | ✗ · n/a nodes · 38.62 s | ✓ · 11 nodes · 1.239 ms | ✓ · 11 nodes · 1.336 ms | ✓ · 12 nodes · 1.335 ms | ✓ · 33 nodes · 6.756 ms | ✓ · 33 nodes · 5.802 ms | ✓ · 33 nodes · 27.050 ms |

## Means over the five cases

| System | Correct | Mean nodes | Mean time | Solver calls | LLM calls | Pruned | Backtracks |
|---|---|---|---|---|---|---|---|
| TA1 CoT | 0/5 | n/a | 28.97 s | n/a | 1 | n/a | n/a |
| TA1 ToT | 5/5 | 11.40 | 1.065 ms | n/a | 0 | 1.20 | n/a |
| TA2 single (MRV) | 5/5 | 11.20 | 1.259 ms | 1 | 0 | 0 | 0 |
| TA2 single (TA1 order) | 5/5 | 12.40 | 1.206 ms | 1 | 0 | 1.20 | 1.20 |
| TA2 multi-agent (parallel) | 5/5 | 33.60 | 6.121 ms | 3 | 0 | 0 | 0 |
| TA2 multi-agent (sequential) | 5/5 | 33.60 | 4.979 ms | 3 | 0 | 0 | 0 |
| TA2 multi-agent + RAG | 5/5 | 33.60 | 30.674 ms | 3 | 0 | 0 | 0 |

## Memory disabled vs enabled (TA1 cell order, repeated case)

| Case | Off: dead ends / nodes | On, first run | On, repeat run | Memory prunes on repeat |
|---|---|---|---|---|
| 1 | 2 / 11 | 2 / 11 | 0 / 11 | 2 |
| 2 | 0 / 11 | 0 / 11 | 0 / 11 | 0 |
| 3 | 0 / 12 | 0 / 12 | 0 / 12 | 0 |
| 4 | 2 / 16 | 2 / 16 | 0 / 16 | 2 |
| 5 | 1 / 12 | 1 / 12 | 0 / 12 | 1 |

## RAG k=1 vs k=3

| Query | k=1 | k=3 |
|---|---|---|
| What should the solver do when a cell has no candidates? | answered · top 0.7368 · 1 chunk(s) sudoku-chunk-2 · 1 LLM · 1.30 s | answered · top 0.7368 · 3 chunk(s) sudoku-chunk-2, sudoku-chunk-14, sudoku-chunk-3 · 1 LLM · 1.50 s |
| What does backtracking restore? | answered · top 0.8382 · 1 chunk(s) sudoku-chunk-5 · 1 LLM · 896.500 ms | answered · top 0.8382 · 3 chunk(s) sudoku-chunk-5, sudoku-chunk-7, sudoku-chunk-15 · 1 LLM · 988.200 ms |
| What is the minimum remaining values heuristic? | answered · top 0.7658 · 1 chunk(s) sudoku-chunk-14 · 1 LLM · 1.69 s | answered · top 0.7658 · 3 chunk(s) sudoku-chunk-14, sudoku-chunk-8, sudoku-chunk-13 · 1 LLM · 1.99 s |
| (unanswerable) Who won the 2018 football world cup? | I dont know · top 0.4057 · 1 chunk(s) sudoku-chunk-8 · 0 LLM · 24.900 ms | I dont know · top 0.4057 · 3 chunk(s) sudoku-chunk-8, sudoku-chunk-13, sudoku-chunk-11 · 0 LLM · 24.400 ms |
| (unanswerable) What is the capital of France? | I dont know · top 0.3785 · 1 chunk(s) sudoku-chunk-10 · 0 LLM · 23.400 ms | I dont know · top 0.3785 · 3 chunk(s) sudoku-chunk-10, sudoku-chunk-6, sudoku-chunk-1 · 0 LLM · 26.200 ms |

## Challenge analysis

### Error propagation (one controlled faulty variant)

| Fault | Solved | Verified votes | Excluded | Time | Wrong answer reached the user |
|---|---|---|---|---|---|
| none | yes | 3/3 | none | 5.006 ms | no |
| invalid_board | yes | 2/3 | variant-desc: RULE_VIOLATION | 4.775 ms | no |
| crash | yes | 2/3 | variant-desc: status=error | 3.634 ms | no |
| timeout | yes | 2/3 | variant-desc: status=timeout | 509.468 ms | no |

### Tool failure and recovery

| Case | Tool calls | Failures | Recovered | Solved | Explanation |
|---|---|---|---|---|---|
| injected_once | 2 | 1 | yes | yes | candidate_summary succeeded on retry 1 |
| injected_twice | 2 | 2 | no | yes | candidate_summary unavailable after 2 attempt(s); continuing without it |

### Prompt injection: deterministic pattern guard

| Texts | Count | Blocked by pattern guard | Passed on to legality check + human approval |
|---|---|---|---|
| injection detectable | 6 | 6 | 0 |
| injection disguised | 4 | 0 | 4 |
| benign control | 5 | 0 | 5 |

* faults are controlled demo faults on variant-desc; the other variants are unchanged

* the injection guard row measures only the deterministic pattern guard; every text that passes it still meets the deterministic legality check and human approval. The live-Qwen injection measurement is traces/challenge_injection.json (python -m ta2.main --mode challenge)

### Prompt injection with live Qwen (from `traces/challenge_injection.json`)

| Texts | Attempts | Unguarded illegal commits | Caught by pattern guard | Caught by legality check | Guarded illegal commits |
|---|---|---|---|---|---|
| injection detectable | 6 | 3 | 6 | 0 | 0 |
| injection disguised | 4 | 4 | 0 | 4 | 0 |
| benign control | 5 | 5 | 0 | 5 | 0 |

## Notes from the harness

* ta1_* columns execute the frozen ta1/ source files, not TA2 code
* nodes: TA1 = 'Try' lines in its search tree; TA2 = search nodes created including the root
* all puzzles verified unique at run time
* ta2_multi_agent_sequential runs the same three variants one after another instead of in a thread pool
