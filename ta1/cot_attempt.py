import ollama

puzzle = """
. . 3 4
3 4 . .
. 1 4 .
4 . . 1
"""

system_prompt = """
You are a careful 4x4 Sudoku solver.

Your task is to solve the Sudoku using a SINGLE reasoning path.

Follow these rules strictly:
1. The Sudoku uses only the numbers 1, 2, 3, and 4.
2. Each row must contain 1, 2, 3, and 4 exactly once.
3. Each column must contain 1, 2, 3, and 4 exactly once.
4. Each 2x2 box must contain 1, 2, 3, and 4 exactly once.
5. Treat "." as an empty cell.
6. Examine the puzzle from top to bottom and left to right.
7. For each empty cell, determine the possible candidates using the
   row, column, and 2x2 box constraints.
8. Choose ONE candidate and continue with that choice.
9. Do NOT use a search tree, branching, backtracking, or an external
   solving algorithm.
10. Do not assume that a number is missing from a row unless you have
    checked all empty positions and the row constraints.
11. After making each placement, verify that it does not violate any
    row, column, or 2x2 box rule.
12. If your chosen path produces a contradiction, clearly identify the
    contradiction instead of silently changing the earlier choice.
13. At the end, provide the completed 4x4 grid if the single reasoning
    path succeeds.
14. Keep the reasoning focused on the Sudoku and do not use Python code
    to solve it.
"""

prompt = f"""
Solve this 4x4 Sudoku using the single-path reasoning procedure
specified in the system instructions.

Puzzle:

{puzzle}

Show your reasoning step by step.

For every placement, state:
- the cell
- the candidate number
- why that candidate is allowed

Do not explore alternative branches.

At the end, provide the final 4x4 grid.
"""

response = ollama.chat(
    model="qwen2.5:3b",
    messages=[
        {
            "role": "system",
            "content": system_prompt
        },
        {
            "role": "user",
            "content": prompt
        }
    ]
)

print("CHAIN-OF-THOUGHT ATTEMPT")
print("========================")
print(response["message"]["content"])