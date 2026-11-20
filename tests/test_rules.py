"""Section 12.1 Sudoku logic tests."""
import pytest
from ta2 import sudoku_rules as R

SAMPLE = [[0, 0, 3, 4], [3, 4, 0, 0], [0, 1, 4, 0], [4, 0, 0, 1]]
SAMPLE_SOLUTION = [[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]]


def test_valid_complete_board():
    assert R.is_complete_valid(SAMPLE_SOLUTION)
    assert R.is_complete_valid(SAMPLE_SOLUTION, SAMPLE)


def test_row_duplicate():
    b = [[1, 1, 0, 0], [0] * 4, [0] * 4, [0] * 4]
    kinds = {c["kind"] for c in R.find_conflicts(b)}
    assert "row" in kinds and not R.is_consistent(b)


def test_column_duplicate():
    b = [[1, 0, 0, 0], [0] * 4, [0] * 4, [1, 0, 0, 0]]
    assert {c["kind"] for c in R.find_conflicts(b)} == {"col"}


def test_box_duplicate():
    b = [[1, 0, 0, 0], [0, 1, 0, 0], [0] * 4, [0] * 4]
    assert {c["kind"] for c in R.find_conflicts(b)} == {"box"}


def test_complete_but_invalid_rejected():
    bad = [row[:] for row in SAMPLE_SOLUTION]
    bad[0][0], bad[0][1] = bad[0][1], bad[0][0]  # swap breaks columns/boxes
    assert not R.is_complete_valid(bad)


def test_incomplete_board_not_complete_valid():
    assert not R.is_complete_valid(SAMPLE)


def test_solution_must_preserve_clues():
    other = [[2, 1, 4, 3], [4, 3, 2, 1], [1, 2, 3, 4], [3, 4, 1, 2]]
    assert R.is_complete_valid(other)  # a valid grid in itself...
    assert not R.is_complete_valid(other, SAMPLE)  # ...but it ignores the clues


def test_contradictory_puzzle_has_zero_solutions():
    b = [[1, 1, 0, 0], [0] * 4, [0] * 4, [0] * 4]
    assert R.count_solutions(b) == 0 and R.solve_one(b) is None


def test_puzzle_with_no_solution_but_no_direct_conflict():
    # (0,0): row forbids 2,3,4 and column forbids 1 -> no candidate, yet no duplicate exists.
    b = [[0, 2, 3, 4], [0, 0, 0, 0], [1, 0, 0, 0], [0, 0, 0, 0]]
    assert R.is_consistent(b) and R.candidates(b, 0, 0) == []
    assert R.count_solutions(b) == 0


def test_one_solution_sample_is_unique():
    assert R.count_solutions(SAMPLE) == 1
    assert R.solve_one(SAMPLE) == SAMPLE_SOLUTION


def test_multiple_solutions_and_counting_stops_at_two():
    empty = [[0] * 4 for _ in range(4)]
    assert R.count_solutions(empty, limit=2) == 2  # 288 exist; must stop at 2
    assert R.count_solutions(empty, limit=1) == 1


def test_counting_does_not_mutate_input():
    b = [row[:] for row in SAMPLE]
    R.count_solutions(b)
    assert b == SAMPLE


def test_candidate_generation():
    assert R.candidates(SAMPLE, 0, 0) == [1, 2]
    assert R.candidates(SAMPLE, 0, 1) == [2]
    assert R.candidates(SAMPLE, 0, 2) == []  # filled cell


def test_zero_candidate_dead_end():
    b = [row[:] for row in SAMPLE]
    b[0][0] = 2  # TA1's documented dead end: (0,1) then has no candidate
    assert R.zero_candidate_cell(b) == (0, 1)
    assert R.zero_candidate_cell(SAMPLE) is None


@pytest.mark.parametrize("v,code", [(3, "ROW_CONFLICT"), (1, "COL_CONFLICT"), (5, "VALUE_OUT_OF_RANGE")])
def test_placement_check_codes(v, code):
    b = [[3, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]
    b[3][1] = 1 if code == "COL_CONFLICT" else 0
    r, c = (0, 1) if code != "COL_CONFLICT" else (1, 1)
    assert R.placement_check(b, r, c, v)[1] == code


def test_placement_box_conflict():
    b = [[0] * 4 for _ in range(4)]
    b[1][1] = 2
    assert R.placement_check(b, 0, 0, 2)[1] == "BOX_CONFLICT"


@pytest.mark.parametrize("bad", [
    [[0] * 4] * 3, [[0] * 3] * 4, "x", [[0, 0, 0, 5]] + [[0] * 4] * 3,
    [[0, 0, 0, True]] + [[0] * 4] * 3, [[0, 0, 0, "1"]] + [[0] * 4] * 3,
])
def test_malformed_boards_rejected(bad):
    with pytest.raises(R.InvalidBoard):
        R.validate_shape(bad)
