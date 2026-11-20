"""Human oversight and guardrails (Unit 4, U4-3).

Pipeline for an AI-suggested move on the user's puzzle:
  1. input guard  - reject prompt-injection / rule-override text before the model is even called
  2. proposer     - local Qwen suggests ONE move (advisory)
  3. move guard   - the move must be legal under the deterministic rules; otherwise rejected with a reason
  4. human gate   - LangGraph ``interrupt`` waits for explicit approval; nothing is applied before that
  5. apply        - re-validated once more, then written to the board only if approved

The injection detector is rule-based and NOT exhaustive. The real protection is that no text can change
which moves are legal, and that no model output is applied without validation and approval.
"""
from __future__ import annotations

import re
from copy import deepcopy
from typing import Any, Callable, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from . import sudoku_rules as R
from .llm_proposer import suggest_move
from .models import utc_now

INJECTION_PATTERNS = [
    r"ignore (all |any |the )?(previous|prior|above|earlier)", r"disregard (the |all |any )?(rules|instructions)",
    r"(override|bypass|disable|turn off|forget) (the |all |any )?(sudoku )?(rules|constraints|validation|checks?)",
    r"you are now", r"system prompt", r"new instructions", r"pretend (that|to)", r"jailbreak",
    r"(break|violate) (the )?(sudoku )?rules", r"even if (it is |it's )?(illegal|invalid|wrong)",
    r"without (checking|validat)", r"do anything now",
]
_COMPILED = [re.compile(p, re.I) for p in INJECTION_PATTERNS]


def detect_injection(text: str) -> list[str]:
    return [p.pattern for p in _COMPILED if p.search(text or "")]


def review_move(board, move: dict | None) -> dict:
    """Deterministic guard on a proposed move. Returns {allowed, code, reason}."""
    if not move:
        return {"allowed": False, "code": "NO_MOVE", "reason": "no usable move was proposed"}
    try:
        R.validate_shape(board)
        r, c, v = int(move["row"]), int(move["col"]), int(move["value"])
    except (R.InvalidBoard, KeyError, TypeError, ValueError):
        return {"allowed": False, "code": "MALFORMED_MOVE", "reason": "move or board is malformed"}
    if not (0 <= r < 4 and 0 <= c < 4):
        return {"allowed": False, "code": "CELL_OUT_OF_RANGE", "reason": "row/col must be 0..3"}
    ok, code, reason = R.placement_check(board, r, c, v)
    return {"allowed": ok, "code": "OK" if ok else code, "reason": reason}


class OversightState(TypedDict, total=False):
    board: list
    user_text: str
    suggestion: Any
    guard: Any
    approval: Any
    applied: bool
    outcome: str
    events: list


def _ev(state: dict, kind: str, **data: Any) -> list:
    return state.get("events", []) + [{"seq": len(state.get("events", [])), "event": kind, "timestamp": utc_now(), **data}]


def build_oversight_graph(checkpointer, llm: Callable[[str], str] | None = None):
    def guard_input(state: OversightState) -> OversightState:
        hits = detect_injection(state.get("user_text", ""))
        if hits:
            return {"outcome": "rejected_injection", "applied": False,
                    "guard": {"allowed": False, "code": "INJECTION_DETECTED",
                              "reason": "text tries to override the rules or instructions; rejected before any model call"},
                    "events": _ev(state, "guardrail_decision", decision="reject", code="INJECTION_DETECTED", matched=len(hits))}
        return {"events": _ev(state, "guardrail_decision", decision="allow_input", code="NO_INJECTION_PATTERN")}

    def propose(state: OversightState) -> OversightState:
        s = suggest_move(state["board"], llm)
        return {"suggestion": s, "events": _ev(state, "tool_call", tool="qwen_suggest_move", error=s["error"])}

    def guard_move(state: OversightState) -> OversightState:
        g = review_move(state["board"], state["suggestion"]["move"])
        out = {"guard": g, "events": _ev(state, "guardrail_decision", decision="allow" if g["allowed"] else "reject",
                                         code=g["code"], reason=g["reason"])}
        if not g["allowed"]:
            out.update(outcome="rejected_illegal_move", applied=False)
        return out

    def approval(state: OversightState) -> OversightState:
        events = _ev(state, "approval_requested", move=state["suggestion"]["move"])
        answer = interrupt({"suggestion": state["suggestion"]["move"], "board": state["board"]})
        approved = bool(answer.get("approved")) if isinstance(answer, dict) else False
        events = events + [{"seq": len(events), "event": "approval_decision", "timestamp": utc_now(),
                            "approved": approved, "by": (answer or {}).get("by", "human") if isinstance(answer, dict) else "human"}]
        return {"approval": {"approved": approved}, "events": events}

    def apply(state: OversightState) -> OversightState:
        if not state["approval"]["approved"]:
            return {"applied": False, "outcome": "rejected_by_human"}
        mv = state["suggestion"]["move"]
        g = review_move(state["board"], mv)      # re-validate immediately before writing
        if not g["allowed"]:
            return {"applied": False, "outcome": "rejected_illegal_move", "guard": g}
        b = deepcopy(state["board"])
        b[mv["row"]][mv["col"]] = mv["value"]
        return {"board": b, "applied": True, "outcome": "applied"}

    g = StateGraph(OversightState)
    for name, fn in (("guard_input", guard_input), ("propose", propose), ("guard_move", guard_move),
                     ("approval", approval), ("apply", apply)):
        g.add_node(name, fn)
    g.add_edge(START, "guard_input")
    g.add_conditional_edges("guard_input", lambda s: END if s.get("outcome") else "propose")
    g.add_edge("propose", "guard_move")
    g.add_conditional_edges("guard_move", lambda s: END if s.get("outcome") else "approval")
    g.add_edge("approval", "apply")
    g.add_edge("apply", END)
    return g.compile(checkpointer=checkpointer)


def _cfg(thread_id: str) -> dict:
    return {"configurable": {"thread_id": thread_id}}


def request_move(app, thread_id: str, board, user_text: str = "") -> dict:
    """Start the pipeline; returns the state, with 'pending_approval' set when waiting for a human."""
    out = app.invoke({"board": board, "user_text": user_text, "applied": False, "events": []}, _cfg(thread_id))
    out = dict(out)
    out["pending_approval"] = bool(out.pop("__interrupt__", None))
    return out


def decide(app, thread_id: str, approved: bool, by: str = "human") -> dict:
    out = dict(app.invoke(Command(resume={"approved": approved, "by": by}), _cfg(thread_id)))
    out.pop("__interrupt__", None)
    out["pending_approval"] = False
    return out
