"""U3-2 long-term memory: namespaces, restart survival, validated dead-end recall."""
import subprocess
import sys
import pytest
from ta2 import sudoku_rules as R
from ta2.memory import SudokuMemory
from ta2.search import SearchEngine

SAMPLE = [[0, 0, 3, 4], [3, 4, 0, 0], [0, 1, 4, 0], [4, 0, 0, 1]]
SOLUTION = [[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]]


def test_namespace_separation(tmp_path):
    m = SudokuMemory(tmp_path / "m.db")
    m.put("profile", "level", {"v": "beginner"}, user_id="alice")
    m.put("profile", "level", {"v": "expert"}, user_id="bob")
    m.put("puzzle_history", "level", {"v": "history"}, user_id="alice")
    assert m.get("profile", "level", "alice") == {"v": "beginner"}
    assert m.get("profile", "level", "bob") == {"v": "expert"}
    assert m.get("puzzle_history", "level", "alice") == {"v": "history"}
    assert m.get("dead_ends", "level", "alice") is None
    assert [r["kind"] for r in m.list(user_id="alice")] == ["profile", "puzzle_history"]
    with pytest.raises(ValueError):
        m.put("secrets", "k", 1)


def test_created_and_last_used_tracking(tmp_path):
    m = SudokuMemory(tmp_path / "m.db")
    m.put("profile", "k", {"a": 1})
    rec = m.list("profile")[0]
    assert rec["created_at"] and rec["last_used_at"] is None and rec["use_count"] == 0
    m.get("profile", "k")
    rec = m.list("profile")[0]
    assert rec["last_used_at"] and rec["use_count"] == 1


def test_delete_and_clear_are_scoped_to_user(tmp_path):
    m = SudokuMemory(tmp_path / "m.db")
    a = m.put("profile", "k", 1, user_id="alice")
    m.put("profile", "k", 2, user_id="bob")
    assert m.delete(a, user_id="bob") is False      # cannot delete another user's memory
    assert m.delete(a, user_id="alice") is True
    assert m.clear(user_id="bob") == 1 and m.list(user_id="bob") == []


def test_memory_survives_process_restart(tmp_path):
    db = tmp_path / "m.db"
    SudokuMemory(db).put("profile", "name", {"display": "Yash"}, user_id="u1")
    code = ("import sys, json; sys.path.insert(0, '.'); from ta2.memory import SudokuMemory; "
            f"print(json.dumps(SudokuMemory(r'{db}').get('profile','name','u1')))")
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True).stdout
    assert '"Yash"' in out


def solve_with_memory(mem, puzzle=SAMPLE, strategy="first_empty", order="desc"):
    eng = SearchEngine(memory_hook=mem)
    return eng.run(eng.init_state(puzzle, strategy=strategy, order=order))


def test_dead_ends_are_learned_then_recalled_and_reverified(tmp_path):
    mem = SudokuMemory(tmp_path / "m.db")
    first = solve_with_memory(mem)
    assert first["counters"]["dead_ends"] == 2 and len(mem.list("dead_ends")) == 2
    second = solve_with_memory(mem)
    assert second["solution"] == SOLUTION
    assert second["counters"]["memory_confirmed"] == 2
    assert second["counters"]["dead_ends"] == 0     # known dead ends were pruned without re-exploring
    names = [e["event"] for e in second["events"]]
    assert names.count("memory_hit_confirmed") == 2
    assert all(m["use_count"] >= 1 and m["last_used_at"] for m in mem.list("dead_ends"))


def test_pattern_for_a_different_board_does_not_match(tmp_path):
    mem = SudokuMemory(tmp_path / "m.db")
    solve_with_memory(mem)
    other = [[0, 0, 0, 4], [3, 4, 0, 0], [0, 1, 4, 0], [4, 0, 0, 1]]  # (0,2) clue removed
    assert mem.lookup(other, [0, 0], 2) is None


def test_poisoned_memory_cannot_prune_the_correct_branch(tmp_path):
    """A stale/wrong pattern claims the CORRECT move is a dead end. The solver must still solve."""
    mem = SudokuMemory(tmp_path / "m.db")
    poisoned = mem.make_pattern(SAMPLE, [0, 0], 1, "ZERO_CANDIDATES")   # (0,0)=1 is part of the true solution
    mem.put("dead_ends", mem.pattern_key(poisoned), poisoned)
    out = solve_with_memory(mem)
    assert out["solution"] == SOLUTION and out["status"] == "solved"
    assert out["counters"]["memory_rejected"] >= 1 and out["counters"]["memory_confirmed"] == 0
    rej = [e for e in out["events"] if e["event"] == "memory_hit_rejected"]
    assert rej and rej[0]["reason_code"] == "MEMORY_STALE"


def test_poisoned_memory_with_mrv_strategy_too(tmp_path):
    mem = SudokuMemory(tmp_path / "m.db")
    p = mem.make_pattern(SAMPLE, [0, 1], 2, "ZERO_CANDIDATES")    # (0,1)=2 is the only legal and correct value
    mem.put("dead_ends", mem.pattern_key(p), p)
    out = solve_with_memory(mem, strategy="mrv", order="asc")
    assert out["solution"] == SOLUTION and out["counters"]["memory_confirmed"] == 0


def test_malformed_pattern_is_ignored_safely(tmp_path):
    mem = SudokuMemory(tmp_path / "m.db")
    mem.put("dead_ends", "junk", {"givens": "oops", "cell": None})
    assert mem.lookup(SAMPLE, [0, 0], 1) is None
    assert solve_with_memory(mem)["solution"] == SOLUTION


def test_relevant_filters_by_current_board(tmp_path):
    mem = SudokuMemory(tmp_path / "m.db")
    solve_with_memory(mem)
    assert len(mem.relevant(SAMPLE)) == 1          # only the pattern whose givens are all on this board
    deeper = [r[:] for r in SAMPLE]
    deeper[0][0], deeper[0][1] = 1, 2              # the second pattern's givens are now present too
    assert len(mem.relevant(deeper)) == 2
    assert mem.relevant([[0] * 4 for _ in range(4)]) == []
