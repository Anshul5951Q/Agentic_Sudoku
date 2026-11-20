"""Local Qwen proposer. Its output is advisory: it is parsed as JSON and filtered through the
deterministic legal-candidate set, so the model can never introduce an illegal value."""
from __future__ import annotations

import json
import re
from typing import Callable

from . import config
from . import sudoku_rules as R


def _default_llm(prompt: str) -> str:
    from langchain_ollama import ChatOllama
    return str(ChatOllama(model=config.LLM_MODEL, temperature=0, num_predict=200).invoke(prompt).content)


def _json_obj(text: str) -> dict | None:
    m = re.search(r"\{.*?\}", text, flags=re.S)
    if not m:
        return None
    try:
        v = json.loads(m.group(0))
        return v if isinstance(v, dict) else None
    except json.JSONDecodeError:
        return None


def _board_text(board) -> str:
    return "\n".join(" ".join(map(str, row)) for row in board)


def suggest_ordering(board, cell, legal: list[int], llm: Callable[[str], str] | None = None) -> dict:
    """Ask the model to order the already-legal candidates. Returns the final (validated) ordering."""
    prompt = (
        "You are the Proposer in a 4x4 Sudoku system. Digits 1-4; rows, columns and 2x2 boxes have no duplicates. "
        f"The deterministic system selected cell row={cell[0]}, col={cell[1]} (zero-based) with legal candidates {legal}.\n"
        f"Board (0 = empty):\n{_board_text(board)}\n"
        'Reply with ONLY JSON like {"order": [..]} listing exactly the legal candidates in the order you suggest trying.')
    try:
        raw = (llm or _default_llm)(prompt)
    except Exception as e:
        return {"ordering": sorted(legal), "source": "deterministic", "raw": None, "error": type(e).__name__}
    obj = _json_obj(raw) or {}
    order = obj.get("order")
    if (isinstance(order, list) and all(isinstance(x, int) and not isinstance(x, bool) for x in order)
            and sorted(order) == sorted(legal)):
        return {"ordering": order, "source": "qwen", "raw": raw}
    return {"ordering": sorted(legal), "source": "deterministic", "raw": raw, "error": "REJECTED_NOT_A_LEGAL_PERMUTATION"}


def suggest_move(board, llm: Callable[[str], str] | None = None, user_text: str = "") -> dict:
    """Ask the model for ONE move. The result is only a *suggestion*; validity is checked by the caller.

    `user_text` is untrusted: it is delimited in the prompt and can never change what is legal."""
    request = f"<user_request>{user_text[:300]}</user_request>\n" if user_text else ""
    prompt = (
        "You are the Proposer for a 4x4 Sudoku. Suggest exactly one legal move for the board (0 = empty).\n"
        f"{_board_text(board)}\n{request}"
        'Reply with ONLY JSON: {"row": r, "col": c, "value": v} using zero-based row/col (0-3) and value 1-4.')
    try:
        raw = (llm or _default_llm)(prompt)
    except Exception as e:
        return {"move": None, "raw": None, "error": type(e).__name__}
    obj = _json_obj(raw)
    try:
        mv = {"row": int(obj["row"]), "col": int(obj["col"]), "value": int(obj["value"])}
    except (TypeError, KeyError, ValueError):
        return {"move": None, "raw": raw, "error": "UNPARSEABLE"}
    return {"move": mv, "raw": raw, "error": None}


def ask_qwen_for_candidates(board, cell, candidates) -> str:
    """Backwards-compatible text helper used by the demo CLI (advisory only)."""
    return suggest_ordering(board, cell, list(candidates))["source"] + ": " + str(
        suggest_ordering(board, cell, list(candidates))["ordering"])
