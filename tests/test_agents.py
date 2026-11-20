"""Section 12.2 agent tests plus engine/trace behaviour."""
import pytest
from ta2 import sudoku_rules as R
from ta2.agents import (BacktrackerAgent, CONTRACTS, ProposerAgent, RuleCheckerAgent, VerifierAgent)
from ta2.models import AgentContract, TraceEvent, SearchNode, EVENT_NAMES, CORE_EVENTS
from ta2.search import SearchEngine

SAMPLE = [[0, 0, 3, 4], [3, 4, 0, 0], [0, 1, 4, 0], [4, 0, 0, 1]]
SOLUTION = [[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]]


@pytest.mark.parametrize("strategy", ["mrv", "first_empty"])
@pytest.mark.parametrize("order", ["asc", "desc", "middle"])
def test_proposer_only_suggests_legal_candidates(strategy, order):
    cell, vals = ProposerAgent().propose(SAMPLE, order, strategy)
    assert cell is not None and sorted(vals) == R.candidates(SAMPLE, *cell)
    assert SAMPLE[cell[0]][cell[1]] == 0


def test_proposer_mrv_vs_first_empty():
    assert ProposerAgent().propose(SAMPLE, "asc", "first_empty")[0] == (0, 0)
    assert ProposerAgent().propose(SAMPLE, "asc", "mrv")[0] == (0, 1)  # single candidate
    assert ProposerAgent().propose(SOLUTION)[0] is None


def test_proposer_does_not_mutate_board():
    before = [r[:] for r in SAMPLE]
    ProposerAgent().propose(SAMPLE)
    assert SAMPLE == before


def test_evaluator_rejects_row_violation():
    v = RuleCheckerAgent().check(SAMPLE, 0, 0, 3)
    assert not v.ok and v.code == "ROW_CONFLICT"


def test_evaluator_rejects_column_violation():
    b = [[0] * 4 for _ in range(4)]
    b[3][0] = 2
    v = RuleCheckerAgent().check(b, 0, 0, 2)
    assert not v.ok and v.code == "COL_CONFLICT"


def test_evaluator_rejects_box_violation():
    b = [[0] * 4 for _ in range(4)]
    b[1][1] = 2
    v = RuleCheckerAgent().check(b, 0, 0, 2)
    assert not v.ok and v.code == "BOX_CONFLICT"


def test_evaluator_accepts_legal_and_rejects_occupied_or_out_of_range():
    assert RuleCheckerAgent().check(SAMPLE, 0, 1, 2).ok
    assert RuleCheckerAgent().check(SAMPLE, 0, 2, 1).code == "CELL_OCCUPIED"
    assert RuleCheckerAgent().check(SAMPLE, 0, 1, 9).code == "VALUE_OUT_OF_RANGE"


def test_verifier_rejects_incomplete_board():
    v = VerifierAgent().verify_final(SAMPLE, SAMPLE)
    assert not v.ok and v.code == "INCOMPLETE"


def test_verifier_rejects_invalid_complete_board():
    bad = [r[:] for r in SOLUTION]
    bad[0][0], bad[0][1] = bad[0][1], bad[0][0]
    v = VerifierAgent().verify_final(bad, SAMPLE)
    assert not v.ok and v.code == "RULE_VIOLATION"


def test_verifier_rejects_valid_board_that_changes_clues():
    other = [[2, 1, 4, 3], [4, 3, 2, 1], [1, 2, 3, 4], [3, 4, 1, 2]]
    assert VerifierAgent().verify_final(other, SAMPLE).code == "CLUE_CHANGED"


def test_verifier_accepts_real_solution_and_flags_partial_problems():
    assert VerifierAgent().verify_final(SOLUTION, SAMPLE).ok
    assert VerifierAgent().verify_partial(SAMPLE).ok
    assert VerifierAgent().verify_partial([[1, 1, 0, 0]] + [[0] * 4] * 3).code == "CONTRADICTORY_BOARD"
    dead = [r[:] for r in SAMPLE]
    dead[0][0] = 2
    assert VerifierAgent().verify_partial(dead).code == "ZERO_CANDIDATES"
    assert VerifierAgent().verify_partial("nope").code == "MALFORMED_BOARD"


def test_backtracker_detects_dead_end_and_prunes():
    b = BacktrackerAgent()
    sol = b.solve(SAMPLE, order="desc", strategy="first_empty")
    assert sol == SOLUTION
    names = [e["event"] for e in b.trace]
    assert names.count("dead_end") == 2 and names.count("branch_pruned") >= 2
    dead = [e for e in b.trace if e["event"] == "dead_end"]
    assert all(e["reason_code"] == "ZERO_CANDIDATES" for e in dead)
    assert dead[0]["cell"] == [0, 1]  # (1,2) in TA1's 1-based notation


def test_backtracker_restores_exact_parent_state():
    eng = SearchEngine()
    s = eng.init_state(SAMPLE, strategy="first_empty", order="desc")
    restores = 0
    while s["status"] == "running":
        was_backtrack = s["phase"] == "backtrack" and bool(s["stack"])
        eng.step(s)
        if was_backtrack:
            restores += 1
            assert s["board"] == s["stack"][-1]["board_before"]
            assert s["stack"][-1]["placed"] is None
    assert restores == 2 and s["status"] == "solved"
    # the original puzzle object was never mutated
    assert s["puzzle"] == SAMPLE


def test_backtrack_event_carries_the_restored_snapshot():
    b = BacktrackerAgent()
    b.solve(SAMPLE, order="desc", strategy="first_empty")
    bt = [e for e in b.trace if e["event"] == "backtrack_started"]
    assert len(bt) == 2 and bt[0]["board_snapshot"] == SAMPLE


def test_solution_is_verified_and_preserves_clues():
    b = BacktrackerAgent()
    sol = b.solve(SAMPLE)
    assert R.is_complete_valid(sol, SAMPLE)
    assert [e["event"] for e in b.trace][-3:] == ["solution_found", "solution_verified", "search_completed"]


def test_contradictory_puzzle_fails_fast_without_search():
    b = BacktrackerAgent()
    assert b.solve([[1, 1, 0, 0]] + [[0] * 4] * 3) is None
    assert b.status == "failed" and b.state["failure"]["code"] == "CONTRADICTORY_BOARD"
    assert b.state["counters"]["expansions"] == 0


def test_unsolvable_but_consistent_puzzle_is_exhausted_not_failed():
    p = [[0, 3, 0, 0], [0, 0, 2, 0], [2, 0, 4, 0], [0, 0, 0, 0]]  # no duplicate, no zero-candidate cell, 0 solutions
    assert R.count_solutions(p) == 0 and VerifierAgent().verify_partial(p).ok
    b = BacktrackerAgent()
    assert b.solve(p, strategy="first_empty") is None
    assert b.status == "exhausted" and b.state["failure"] is None
    assert b.trace[-1]["event"] == "search_completed" and b.trace[-1]["reason_code"] == "EXHAUSTED"


def test_max_nodes_is_reported_as_limit_not_as_no_solution():
    b = BacktrackerAgent(max_nodes=3)
    assert b.solve(SAMPLE) is None
    assert b.status == "limit_reached" and b.state["failure"]["code"] == "MAX_NODES"
    assert b.trace[-1]["event"] == "search_failed"


def test_trace_events_are_ordered_valid_and_zero_based():
    b = BacktrackerAgent()
    b.solve(SAMPLE, order="desc", strategy="first_empty")
    for i, e in enumerate(b.trace):
        TraceEvent(**e)
        assert e["sequence"] == i and e["event"] in EVENT_NAMES
        if e["cell"]:
            assert all(0 <= x <= 3 for x in e["cell"])
    assert {"search_started", "cell_selected", "candidates_generated", "candidate_proposed",
            "candidate_accepted", "dead_end", "branch_pruned", "backtrack_started",
            "solution_found", "solution_verified", "search_completed"} <= {e["event"] for e in b.trace}
    assert set(CORE_EVENTS) <= EVENT_NAMES


def test_search_tree_has_parent_child_and_statuses():
    b = BacktrackerAgent()
    b.solve(SAMPLE, order="desc", strategy="first_empty")
    nodes = b.state["nodes"]
    for n in nodes.values():
        SearchNode(**n)
        if n["parent_node_id"]:
            assert n["parent_node_id"] in nodes and nodes[n["parent_node_id"]]["depth"] == n["depth"] - 1
    statuses = {n["status"] for n in nodes.values()}
    assert "solution" in statuses and ("dead_end" in statuses or "pruned" in statuses)
    assert sum(n["status"] == "solution" for n in nodes.values()) == 1


def test_candidate_order_variants_can_differ_but_agree_on_unique_solution():
    sols = {}
    for order in ("asc", "desc", "middle"):
        b = BacktrackerAgent()
        sols[order] = b.solve(SAMPLE, order=order, strategy="first_empty")
    assert sols["asc"] == sols["desc"] == sols["middle"] == SOLUTION


def test_every_agent_has_a_complete_five_field_contract():
    assert len(CONTRACTS) == 4
    for c in CONTRACTS:
        assert isinstance(c, AgentContract)
        assert c.name and c.goal and c.tools and c.inputs_outputs and c.limits


def test_proposer_cannot_commit_moves():
    assert not hasattr(ProposerAgent, "commit") and not hasattr(ProposerAgent, "place")
