# Topic 10: Sudoku Mini-Puzzle Solver Using Tree-of-Thought Search

# 4x4 Sudoku puzzle
# 0 represents an empty cell

puzzle = [
    [0, 0, 3, 4],
    [3, 4, 0, 0],
    [0, 1, 4, 0],
    [4, 0, 0, 1]
]

search_tree = []


def print_grid(grid):
    """Print the Sudoku grid."""
    for row in grid:
        print(" ".join(str(num) if num != 0 else "." for num in row))


def is_valid(grid, row, col, num):
    """Check whether a number can be placed in a cell."""

    # Check row
    if num in grid[row]:
        return False

    # Check column
    for r in range(4):
        if grid[r][col] == num:
            return False

    # Check 2x2 box
    box_row = (row // 2) * 2
    box_col = (col // 2) * 2

    for r in range(box_row, box_row + 2):
        for c in range(box_col, box_col + 2):
            if grid[r][c] == num:
                return False

    return True


def get_candidates(grid, row, col):
    """Generate all valid candidate numbers."""

    candidates = []

    # Try larger numbers first so that the search
    # demonstrates backtracking on this puzzle.
    for num in range(4, 0, -1):
        if is_valid(grid, row, col, num):
            candidates.append(num)

    return candidates


def find_empty_cell(grid):
    """Find the next empty cell."""

    for row in range(4):
        for col in range(4):
            if grid[row][col] == 0:
                return row, col

    return None


def tree_of_thought(grid, depth=0):
    """Solve Sudoku using Tree-of-Thought search and backtracking."""

    empty = find_empty_cell(grid)

    # No empty cells means the puzzle is solved
    if empty is None:
        search_tree.append(
            f"{'  ' * depth}SOLUTION FOUND"
        )
        return True

    row, col = empty

    # Generate multiple candidate thoughts
    candidates = get_candidates(grid, row, col)

    search_tree.append(
        f"{'  ' * depth}Cell ({row + 1},{col + 1}) candidates: {candidates}"
    )

    # If there are no candidates, this is a dead end
    if not candidates:
        search_tree.append(
            f"{'  ' * depth}✗ No valid candidates - DEAD END"
        )
        return False

    # Explore each candidate as a separate thought/branch
    for candidate in candidates:

        search_tree.append(
            f"{'  ' * depth}├── Try {candidate} at ({row + 1},{col + 1})"
        )

        # Make the candidate placement
        grid[row][col] = candidate

        # Explore this branch
        if tree_of_thought(grid, depth + 1):
            return True

        # The branch failed
        search_tree.append(
            f"{'  ' * (depth + 1)}✗ Dead end - prune branch"
        )

        # Backtrack and remove the candidate
        grid[row][col] = 0

    return False


print("TREE-OF-THOUGHT SUDOKU SOLVER")
print("==============================")

print("\nOriginal Puzzle:")
print_grid(puzzle)

tree_of_thought(puzzle)

print("\nSEARCH TREE:")
print("-----------")

for step in search_tree:
    print(step)

print("\nFINAL SOLUTION:")
print("--------------")
print_grid(puzzle)