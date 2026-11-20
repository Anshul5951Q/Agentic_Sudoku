"""Optional local Qwen proposer. Its text is advisory; deterministic rules remain authoritative."""
from langchain_ollama import ChatOllama


def ask_qwen_for_candidates(board: list[list[int]], cell: tuple[int,int], candidates: list[int]) -> str:
    model = ChatOllama(model="qwen2.5:3b", temperature=0)
    prompt = (
        "You are the Proposer agent in a 4x4 Sudoku system. Digits are 1,2,3,4; "
        "rows, columns and 2x2 boxes must have no duplicates. The deterministic system "
        "has selected cell (row,column)=" + str((cell[0]+1,cell[1]+1)) + " and computed legal candidates=" + str(candidates) + ".\n"
        "Board (0 means empty):\n" + "\n".join(" ".join(map(str,row)) for row in board) + "\n"
        "Suggest an ordering of only these candidates and briefly explain. Do not invent candidates."
    )
    return str(model.invoke(prompt).content)
