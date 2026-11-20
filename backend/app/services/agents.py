"""Derive per-agent status purely from the persisted trace events (nothing is invented)."""
from __future__ import annotations

from datetime import datetime

TERMINAL_EVENTS = ("search_completed", "search_failed", "search_cancelled")
AGENTS = ("Proposer", "RuleChecker", "Verifier", "Backtracker", "Supervisor")


def _secs(a: str, b: str) -> float:
    return round((datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds(), 6)


def derive(run: dict, events: list[dict], live: bool) -> dict:
    names = list(AGENTS) + (["LLM-CoT"] if run["mode"] == "cot" else [])
    names += sorted({e["agent"] for e in events} - set(names))
    failed_run = run["status"] == "failed"
    out = []
    for name in names:
        mine = [e for e in events if e["agent"] == name]
        if not mine:
            out.append({"agent": name, "status": "idle", "event_count": 0, "tool_calls": 0})
            continue
        last = mine[-1]
        latest_overall = events[-1] if events else None
        if run["status"] in ("completed", "failed", "cancelled"):
            fail_ev = next((e for e in reversed(mine) if e["event"] == "search_failed"), None)
            status = "failed" if (fail_ev or (failed_run and name == "Supervisor")) else "completed"
        elif live:
            status = "running" if latest_overall and latest_overall["agent"] == name else "waiting"
        else:
            status = "waiting"            # paused / interrupted
        err = next((e["reason"] for e in reversed(mine) if e["event"] in ("search_failed", "tool_failure")), None)
        out.append({
            "agent": name, "status": status, "current_task": last.get("reason") or last["event"],
            "latest_message": {"event": last["event"], "sequence": last["sequence"], "reason_code": last.get("reason_code"),
                               "reason": last.get("reason"), "timestamp": last["timestamp"]},
            "event_count": len(mine), "tool_calls": sum(e["event"] == "tool_call" for e in mine),
            "first_activity_at": mine[0]["timestamp"], "last_activity_at": last["timestamp"],
            "active_seconds": _secs(mine[0]["timestamp"], last["timestamp"]), "error": err})
    routing = [{"hop": e["data"].get("hop"), "to": e["data"].get("to"), "reason": e.get("reason"), "sequence": e["sequence"]}
               for e in events if e["event"] == "route"]
    return {"run_id": run["run_id"], "run_status": run["status"], "mode": run["mode"], "agents": out, "routing_trace": routing,
            "note": ("Status is derived from the stored trace. Multi-agent 'variants' are candidate-order variants of one "
                     "deterministic solver, not independent LLM agents." if run["mode"] == "multi-agent" else
                     "Status is derived from the stored trace of this run.")}
