# Topic 10: Sudoku Mini-Puzzle Solver Using Tree-of-Thought Search

# 4x4 Sudoku puzzle
# 0 represents an empty cell

puzzle = [
    [0, 0, 3, 4],
    [3, 4, 0, 0],
    [0, 1, 4, 0],
    [4, 0, 0, 1]
]


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


def find_all_solutions(grid, solutions):
    """Find all possible Sudoku solutions."""

    # Find an empty cell
    for row in range(4):
        for col in range(4):
            if grid[row][col] == 0:

                # Try every possible number
                for num in range(1, 5):

                    if is_valid(grid, row, col, num):
                        grid[row][col] = num

                        find_all_solutions(grid, solutions)

                        # Backtrack
                        grid[row][col] = 0

                        # We only need to find two solutions
                        if len(solutions) >= 2:
                            return

                return

    # No empty cells means a complete solution was found
    solutions.append([row[:] for row in grid])


print("4x4 SUDOKU PUZZLE")
print("==================")

print("\nOriginal Puzzle:")
print_grid(puzzle)

# Find all solutions
solutions = []
find_all_solutions(puzzle, solutions)

print("\nNumber of solutions found:", len(solutions))

if len(solutions) == 1:
    print("The puzzle has a UNIQUE solution.")

    print("\nUnique Solution:")
    print_grid(solutions[0])

else:
    print("The puzzle does NOT have a unique solution.")