"""Evaluation harness: distinct unique cases, real TA1 execution, deterministic judging."""
import hashlib
import pytest
from ta2 import evaluation as E, ta1_runner as T
from ta2 import sudoku_rules as R


def test_five_distinct_cases_each_with_unique_solution():
    cases = E.build_cases()
    assert len(cases) == 5
    assert len({R.board_key(c["puzzle"]) for c in cases}) == 5          # the old harness had a duplicate
    assert all(R.count_solutions(c["puzzle"], 2) == 1 for c in cases)
    assert cases[0]["puzzle"] == E.SAMPLE


def test_cases_are_reproducible():
    assert [c["puzzle"] for c in E.build_cases()] == [c["puzzle"] for c in E.build_cases()]


def test_non_unique_case_is_refused(monkeypatch):
    monkeypatch.setattr(E, "make_case", lambda clues, seed: [[0] * 4 for _ in range(4)])
    with pytest.raises(ValueError):
        E.build_cases()


def test_ta1_tot_runs_real_frozen_code_with_substituted_puzzle():
    r = T.run_tot(E.SAMPLE)
    assert r["correct"] and r["nodes"] == 10 and r["dead_ends"] == 2 and r["pruned"] == 2
    assert any("DEAD END" in line for line in r["search_tree"])


def test_ta1_loader_never_modifies_the_frozen_files():
    before = {n: hashlib.sha256((T.TA1_DIR / n).read_bytes()).hexdigest() for n in ("tot_solver.py", "cot_attempt.py")}
    T.run_tot(E.build_cases()[3]["puzzle"])
    after = {n: hashlib.sha256((T.TA1_DIR / n).read_bytes()).hexdigest() for n in before}
    assert before == after


def test_ta1_tot_on_every_case_is_judged_by_our_validator():
    for c in E.build_cases():
        r = T.run_tot(c["puzzle"])
        assert r["correct"] is R.is_complete_valid(R.solve_one(c["puzzle"]), c["puzzle"]) and r["solution"]


def test_ta1_tot_on_unsolvable_puzzle_is_not_called_correct():
    r = T.run_tot([[0, 3, 0, 0], [0, 0, 2, 0], [2, 0, 4, 0], [0, 0, 0, 0]])
    assert r["correct"] is False and r["solution"] is None


def test_loader_rejects_malformed_boards():
    with pytest.raises(R.InvalidBoard):
        T.run_tot([[9] * 4] * 4)


def test_evaluation_run_without_llm_or_rag_is_measured_not_canned():
    out = E.run_evaluation(with_cot=False, with_rag=False)
    assert len(out["cases"]) == 5 and out["rag_available"] is False
    for row in out["cases"]:
        assert row["ta1_tot"]["correct"] and row["ta2_single_mrv"]["correct"] and row["ta2_multi_agent_mrv"]["correct"]
        assert row["ta2_multi_agent_mrv"]["solver_calls"] == 3 and row["ta2_single_mrv"]["median_seconds"] > 0
        assert row["ta2_multi_agent_mrv"]["nodes"] >= 3 * row["ta2_single_mrv"]["nodes"] - 3
    first = out["cases"][0]
    assert first["ta1_tot"]["nodes"] == 10 and first["ta2_single_first_empty_desc"]["backtracks"] == 2
    # memory on a repeated case: dead ends were learned then pruned without re-exploring
    m = out["memory_comparison"][0]
    assert m["disabled"]["dead_ends"] == 2 and m["enabled_repeat_run"]["dead_ends"] == 0
    assert m["enabled_repeat_run"]["memory_confirmed"] == 2
