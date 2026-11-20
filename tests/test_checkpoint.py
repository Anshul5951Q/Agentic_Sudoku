"""U3 checkpointing: saved per decision, resumable from a mid-search state, corruption detected."""
import pytest
from ta2 import sudoku_rules as R
from ta2.checkpointer import (CheckpointError, build_graph, checkpoint_summaries, load_state, open_saver,
                              resume_search, run_checkpointed, start_search)
from ta2.search import SearchEngine

SAMPLE = [[0, 0, 3, 4], [3, 4, 0, 0], [0, 1, 4, 0], [4, 0, 0, 1]]
SOLUTION = [[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]]


def reference(strategy="first_empty", order="desc"):
    eng = SearchEngine()
    s = eng.init_state(SAMPLE, run_id="ref", thread_id="ref", strategy=strategy, order=order)
    return eng.run(s)


def strip(events):
    return [(e["event"], e["cell"], e["candidate"], e["depth"], e["reason_code"])
            for e in events if e["event"] not in ("search_paused", "search_resumed")]


def test_checkpoint_saved_after_each_decision(tmp_path):
    db = tmp_path / "c.sqlite3"
    with open_saver(db) as saver:
        app = build_graph(saver)
        out = start_search(app, SAMPLE, "t-all", "first_empty", "desc")
        sums = checkpoint_summaries(saver, "t-all")
    assert out["status"] == "solved" and out["solution"] == SOLUTION
    assert len(sums) >= out["counters"]["steps"]  # at least one checkpoint per decision
    assert sorted(x["search_steps"] for x in sums if x["search_steps"])[-1] == out["counters"]["steps"]


def test_search_resumes_from_mid_search_state_after_reconnect(tmp_path):
    db = tmp_path / "c.sqlite3"
    with open_saver(db) as saver:                         # "process 1"
        app = build_graph(saver)
        paused = start_search(app, SAMPLE, "t-mid", "first_empty", "desc", max_steps=10)
    assert paused["status"] == "running" and paused["paused"] is True
    assert paused["counters"]["steps"] == 10 and len(paused["stack"]) > 0   # genuinely mid-search
    with open_saver(db) as saver:                         # "process 2": fresh connection and graph
        app = build_graph(saver)
        mid = load_state(app, "t-mid")
        assert mid["counters"]["steps"] == 10 and mid["board"] == paused["board"]
        done = resume_search(app, "t-mid")
    ref = reference()
    assert done["status"] == "solved" and done["solution"] == ref["solution"]
    names = [e["event"] for e in done["events"]]
    assert names.count("search_started") == 1                      # did not restart from the root
    assert names.count("search_paused") == 1 and names.count("search_resumed") == 1
    assert strip(done["events"]) == strip(ref["events"])           # identical decisions to an uninterrupted run
    assert [e["sequence"] for e in done["events"]] == list(range(len(done["events"])))
    assert done["counters"]["backtracks"] == ref["counters"]["backtracks"] == 2


def test_multiple_pause_resume_cycles(tmp_path):
    db = tmp_path / "c.sqlite3"
    steps = 0
    while True:
        with open_saver(db) as saver:
            app = build_graph(saver)
            out = start_search(app, SAMPLE, "t-cyc", "first_empty", "desc", max_steps=4) if steps == 0 \
                else resume_search(app, "t-cyc", max_steps=4)
        steps += 1
        if out["status"] != "running":
            break
        assert steps < 50
    assert out["solution"] == SOLUTION and steps > 2


def test_resume_after_simulated_crash(tmp_path):
    db = tmp_path / "c.sqlite3"
    with open_saver(db) as saver:
        app = build_graph(saver, crash_at_step=9)
        with pytest.raises(RuntimeError):
            start_search(app, SAMPLE, "t-crash", "first_empty", "desc")
    with open_saver(db) as saver:
        app = build_graph(saver)
        state = load_state(app, "t-crash")
        assert state["counters"]["steps"] == 8   # last good checkpoint, not the root
        done = resume_search(app, "t-crash")
    assert done["status"] == "solved" and done["solution"] == SOLUTION
    assert strip(done["events"]) == strip(reference()["events"])


def test_stable_thread_ids_are_independent(tmp_path):
    with open_saver(tmp_path / "c.sqlite3") as saver:
        app = build_graph(saver)
        a = start_search(app, SAMPLE, "thread-a", "first_empty", "desc", max_steps=5)
        b = start_search(app, SAMPLE, "thread-b", "mrv", "asc")
        assert load_state(app, "thread-a")["counters"]["steps"] == 5
        assert b["status"] == "solved" and a["status"] == "running"


def test_missing_checkpoint_is_a_recoverable_error(tmp_path):
    with open_saver(tmp_path / "c.sqlite3") as saver:
        app = build_graph(saver)
        with pytest.raises(CheckpointError) as e:
            resume_search(app, "nope")
    assert e.value.code == "NO_CHECKPOINT"


def test_corrupt_checkpoint_is_detected_not_resumed(tmp_path):
    with open_saver(tmp_path / "c.sqlite3") as saver:
        app = build_graph(saver)
        start_search(app, SAMPLE, "t-bad", "first_empty", "desc", max_steps=6)
        app.update_state({"configurable": {"thread_id": "t-bad"}}, {"board": [[9, 9, 9, 9]] * 4})
        with pytest.raises(CheckpointError) as e:
            resume_search(app, "t-bad")
    assert e.value.code == "CHECKPOINT_INVALID"


def test_finished_thread_resume_is_a_noop(tmp_path):
    with open_saver(tmp_path / "c.sqlite3") as saver:
        app = build_graph(saver)
        first = start_search(app, SAMPLE, "t-done")
        again = resume_search(app, "t-done")
    assert again["solution"] == first["solution"] and len(again["events"]) == len(first["events"])


def test_run_checkpointed_wrapper_reuses_thread(tmp_path):
    db = tmp_path / "c.sqlite3"
    a = run_checkpointed(SAMPLE, "w1", db)
    b = run_checkpointed(SAMPLE, "w1", db)
    assert a["solution"] == SOLUTION and len(a["events"]) == len(b["events"])


def test_silent_chunk_boundaries_emit_no_pause_events(tmp_path):
    with open_saver(tmp_path / "c.sqlite3") as saver:
        app = build_graph(saver)
        out = start_search(app, SAMPLE, "t-silent", "first_empty", "desc", max_steps=3, silent=True)
        while out["status"] == "running":
            out = resume_search(app, "t-silent", max_steps=3, silent=True)
    names = [e["event"] for e in out["events"]]
    assert "search_paused" not in names and "search_resumed" not in names
    assert strip(out["events"]) == strip(reference()["events"])


def test_mark_paused_and_cancel_are_recorded_in_the_checkpoint(tmp_path):
    from ta2.checkpointer import mark_paused, mark_terminal
    with open_saver(tmp_path / "c.sqlite3") as saver:
        app = build_graph(saver)
        start_search(app, SAMPLE, "t-ext", "first_empty", "desc", max_steps=4, silent=True)
        st = mark_paused(app, "t-ext")
        assert st["paused"] and st["events"][-1]["event"] == "search_paused" and st["seq"] == len(st["events"])
        done = resume_search(app, "t-ext", max_steps=2, silent=True)
        assert [e["event"] for e in done["events"]].count("search_resumed") == 1
        end = mark_terminal(app, "t-ext", "search_cancelled", "cancelled", "CANCELLED", "cancelled by user")
        assert end["status"] == "cancelled" and end["events"][-1]["event"] == "search_cancelled"
        assert resume_search(app, "t-ext")["status"] == "cancelled"      # a cancelled run never restarts
