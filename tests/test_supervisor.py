"""Supervisor, voting, MAX_HOPS and failure-routing tests (12.2 / 12.3 / 12.4)."""
import time
import pytest
from ta2 import sudoku_rules as R
from ta2.failure import BudgetExceeded, FailureInjector, ToolError, ToolRunner
from ta2.supervisor import Supervisor, tally_votes, default_solver
from ta2.trace import Recorder

SAMPLE = [[0, 0, 3, 4], [3, 4, 0, 0], [0, 1, 4, 0], [4, 0, 0, 1]]
SOLUTION = [[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]]


def fake_solver(mapping):
    """mapping: order -> callable returning a raw attempt dict."""
    def solver(puzzle, variant, deadline, max_nodes):
        return mapping[variant["order"]](puzzle, deadline)
    return solver


GOOD = lambda p, d: {"solution": [r[:] for r in SOLUTION], "status": "solved", "nodes": 5}
INVALID = lambda p, d: {"solution": [[1, 1, 1, 1]] * 4, "status": "solved", "nodes": 5}
PARTIAL = lambda p, d: {"solution": [r[:] for r in SAMPLE], "status": "solved", "nodes": 5}


def test_default_run_solves_and_votes_only_verified():
    r = Supervisor(strategy="first_empty").solve_and_vote(SAMPLE, run_id="t1")
    assert r["status"] == "solved" and r["solution"] == SOLUTION and r["valid"]
    assert sum(r["votes"].values()) == 3 and r["vote"]["vote_type"] == "candidate_order_variants"
    assert all(a["kind"] == "candidate-order variant" for a in r["attempts"])
    assert "not independent" in r["note"]


def test_routing_trace_is_recorded_and_hops_counted():
    r = Supervisor().solve_and_vote(SAMPLE, run_id="t2")
    assert [h["hop"] for h in r["routing_trace"]] == list(range(1, len(r["routing_trace"]) + 1))
    assert r["hops"] == len(r["routing_trace"]) <= r["max_hops"]
    assert {h["to"] for h in r["routing_trace"]} >= {"Verifier", "SolverVariants", "Supervisor"}
    routes = [e for e in r["events"] if e["event"] == "route"]
    assert len(routes) == r["hops"]


def test_max_hops_stops_runaway_coordination():
    looping = lambda ctx: "dispatch"  # never finishes
    r = Supervisor(max_hops=4, router=looping, solver=fake_solver({o: GOOD for o in ("asc", "desc", "middle")})
                   ).solve_and_vote(SAMPLE)
    assert r["status"] == "failed" and r["failure"]["code"] == "HOP_LIMIT_EXCEEDED"
    assert r["hops"] == 4 and r["solution"] is None
    assert r["events"][-1]["event"] == "search_failed"


def test_invalid_and_partial_attempts_cannot_vote():
    solver = fake_solver({"asc": GOOD, "desc": INVALID, "middle": PARTIAL})
    r = Supervisor(solver=solver).solve_and_vote(SAMPLE)
    assert r["votes"] == {R.board_key(SOLUTION): 1}
    assert {e["attempt"] for e in r["vote"]["excluded"]} == {"variant-desc", "variant-middle"}
    assert r["status"] == "solved"


def test_crashed_attempt_cannot_vote_and_does_not_crash_supervisor():
    def boom(p, d):
        raise RuntimeError("secret C:\\internal\\path")
    r = Supervisor(solver=fake_solver({"asc": GOOD, "desc": boom, "middle": GOOD})).solve_and_vote(SAMPLE)
    crashed = [a for a in r["attempts"] if a["status"] == "error"]
    assert len(crashed) == 1 and crashed[0]["error"] == "RuntimeError"
    assert "secret" not in str(r["attempts"]) and sum(r["votes"].values()) == 2


def test_timed_out_attempt_does_not_vote():
    def slow(p, d):
        time.sleep(0.6)
        return GOOD(p, d)
    r = Supervisor(timeout_s=0.15, solver=fake_solver({"asc": GOOD, "desc": slow, "middle": GOOD})).solve_and_vote(SAMPLE)
    assert [a["status"] for a in r["attempts"]].count("timeout") == 1
    assert sum(r["votes"].values()) == 2


def test_no_valid_vote_means_no_winner():
    solver = fake_solver({"asc": INVALID, "desc": PARTIAL, "middle": lambda p, d: {"solution": None, "status": "exhausted"}})
    r = Supervisor(solver=solver).solve_and_vote(SAMPLE)
    assert r["solution"] is None and r["valid"] is False and r["status"] == "failed"
    assert r["failure"]["code"] == "NO_VALID_VOTE" and r["votes"] == {}


def test_contradictory_input_is_rejected_before_dispatch():
    r = Supervisor().solve_and_vote([[1, 1, 0, 0]] + [[0] * 4] * 3)
    assert r["status"] == "failed" and r["failure"]["code"] == "CONTRADICTORY_BOARD"
    assert r["attempts"] == [] and r["solver_calls"] == 0


def test_disagreeing_valid_solutions_are_reported_not_hidden():
    empty = [[0] * 4 for _ in range(4)]
    other = [[2, 1, 4, 3], [4, 3, 2, 1], [1, 2, 3, 4], [3, 4, 1, 2]]
    solver = fake_solver({"asc": lambda p, d: {"solution": SOLUTION, "status": "solved"},
                          "desc": lambda p, d: {"solution": other, "status": "solved"},
                          "middle": lambda p, d: {"solution": SOLUTION, "status": "solved"}})
    r = Supervisor(solver=solver).solve_and_vote(empty)
    assert r["vote"]["disagreement"] is True and r["vote"]["solution_count"] == 2
    assert r["solution"] == SOLUTION  # 2-1 plurality, still a verified board


def test_vote_is_reproducible_from_saved_run_data():
    r = Supervisor(strategy="first_empty").solve_and_vote(SAMPLE)
    import json
    saved = json.loads(json.dumps(r["attempts"]))
    assert tally_votes(SAMPLE, saved).model_dump() == r["vote"]


def test_tampered_saved_attempt_is_rejected_on_recount():
    r = Supervisor().solve_and_vote(SAMPLE)
    saved = [dict(a) for a in r["attempts"]]
    saved[0]["solution"] = [[1, 1, 1, 1]] * 4
    assert sum(tally_votes(SAMPLE, saved).votes.values()) == 2


def test_default_solver_runs_real_engine():
    out = default_solver(SAMPLE, {"name": "v", "order": "desc", "strategy": "first_empty", "run_id": "x"}, None, 100)
    assert out["solution"] == SOLUTION and out["counters"]["backtracks"] == 2


# ---- failure injection and routing (U3-4)
def test_injected_failure_is_retried_and_recovers():
    rec = Recorder("f1")
    runner = ToolRunner({"rag_retrieve": lambda q: ["chunk"]}, injector=FailureInjector({"rag_retrieve": 1}),
                        max_retries=1, recorder=rec)
    res = runner.call("rag_retrieve", "q")
    assert res.ok and res.recovered and not res.via_fallback and res.attempts == 2
    assert [e["event"] for e in rec.events] == ["tool_call", "tool_failure", "tool_call", "tool_recovered"]
    assert "injected failure" in rec.events[1]["reason"]


def test_persistent_failure_routes_to_fallback():
    rec = Recorder("f2")
    runner = ToolRunner({"qwen_order": lambda b: "x"}, fallbacks={"qwen_order": lambda b: "deterministic order"},
                        injector=FailureInjector({"qwen_order": 5}), max_retries=1, recorder=rec)
    res = runner.call("qwen_order", SAMPLE)
    assert res.ok and res.via_fallback and res.value == "deterministic order"
    assert rec.events[-1]["reason_code"] == "FALLBACK_USED"


def test_failure_without_fallback_is_explained_not_raised():
    runner = ToolRunner({"t": lambda: 1}, injector=FailureInjector({"t": 9}), max_retries=0)
    res = runner.call("t")
    assert not res.ok and "unavailable" in res.explanation and res.errors


def test_real_exception_in_tool_is_caught():
    def bad():
        raise ConnectionError("ollama down")
    res = ToolRunner({"t": bad}, max_retries=0).call("t")
    assert not res.ok and "ConnectionError" in res.errors[0]


def test_tool_budget_is_enforced():
    runner = ToolRunner({"t": lambda: 1}, max_calls=2)
    runner.call("t"); runner.call("t")
    with pytest.raises(BudgetExceeded):
        runner.call("t")


def test_supervisor_survives_context_tool_failure_and_records_recovery():
    runner = ToolRunner({"rag_retrieve": lambda p: ["c"]}, injector=FailureInjector({"rag_retrieve": 1}), max_retries=1)
    r = Supervisor(tool_runner=runner, context_tools=("rag_retrieve",)).solve_and_vote(SAMPLE, run_id="f3")
    kinds = [e["event"] for e in r["events"]]
    assert "tool_failure" in kinds and "tool_recovered" in kinds
    assert r["status"] == "solved" and r["tool_failures"] == 1 and r["tool_calls"] == 2


def test_supervisor_degrades_gracefully_when_tool_never_recovers():
    runner = ToolRunner({"rag_retrieve": lambda p: ["c"]}, injector=FailureInjector({"rag_retrieve": 9}), max_retries=1)
    r = Supervisor(tool_runner=runner, context_tools=("rag_retrieve",)).solve_and_vote(SAMPLE)
    assert r["status"] == "solved"  # deterministic solving does not depend on the tool
    assert r["events"][[e["event"] for e in r["events"]].index("tool_failure")]["reason_code"] == "TOOL_FAILURE"
    assert any(e["reason_code"] == "TOOL_UNAVAILABLE" for e in r["events"] if e["event"] == "tool_failure")
