"""Human approval of AI-suggested moves, persisted in SQLite. The LLM never commits a move on its own."""
from __future__ import annotations

import json

from ta2.agents import ProposerAgent
from ta2.checkpointer import open_saver
from ta2.models import utc_now
from ta2.oversight import build_oversight_graph, decide, request_move

from ..core.errors import APIError, not_found
from ..core.ids import new_id


class ApprovalService:
    def __init__(self, db, settings, llm=None):
        self.db, self.settings, self.llm = db, settings, llm

    @staticmethod
    def _stand_in(board):
        cell, legal = ProposerAgent().propose(board)
        if cell is None or not legal:
            return lambda prompt: "{}"
        return lambda prompt: json.dumps({"row": cell[0], "col": cell[1], "value": legal[0]})

    def _record(self, approval_id: str, board_before, user_text: str, out: dict, status: str, decided: bool = False, proposer: str = "qwen") -> dict:
        payload = {"board_before": board_before, "user_text": user_text, "suggestion": (out.get("suggestion") or {}).get("move"),
                   "suggestion_error": (out.get("suggestion") or {}).get("error"), "guard": out.get("guard"),
                   "outcome": out.get("outcome"), "applied": bool(out.get("applied")), "proposer": proposer,
                   "board_after": out.get("board") if out.get("applied") else None, "events": out.get("events", [])}
        self.db.save_approval(approval_id, approval_id, status, payload, decided)
        return self.db.get_approval(approval_id)

    def request(self, board, user_text: str, proposer: str = "qwen") -> dict:
        approval_id = new_id("approval")
        llm = self._stand_in(board) if proposer == "stand_in" else self.llm
        with open_saver(self.settings.checkpoint_db) as saver:
            app = build_oversight_graph(saver, llm=llm)
            out = request_move(app, approval_id, board, user_text)
        status = "pending" if out["pending_approval"] else "blocked"
        return self._record(approval_id, board, user_text, out, status, proposer=proposer)

    def decide(self, approval_id: str, approved: bool) -> dict:
        row = self.db.get_approval(approval_id)
        if not row:
            raise not_found("approval", approval_id)
        if row["status"] in ("approved", "rejected"):
            if (row["status"] == "approved") == approved:
                return row                                   # duplicate decision: idempotent
            raise APIError(409, "ALREADY_DECIDED", f"approval was already {row['status']}")
        if row["status"] == "blocked":
            raise APIError(409, "APPROVAL_NOT_PENDING", "this suggestion was blocked by a guardrail and cannot be approved")
        with open_saver(self.settings.checkpoint_db) as saver:
            app = build_oversight_graph(saver, llm=self.llm)
            out = decide(app, approval_id, approved)
        proposer = row.get("proposer", "qwen")
        return self._record(approval_id, row["board_before"], row["user_text"], {**out, "suggestion": {"move": row["suggestion"]}},
                            "approved" if out.get("applied") else "rejected", decided=True, proposer=proposer)
