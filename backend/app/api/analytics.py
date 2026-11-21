import json
import statistics
from collections import Counter, defaultdict

from fastapi import APIRouter, Depends

from ..context import Context, get_ctx
from ..schemas import AnalyticsComparisons, AnalyticsSummary

router = APIRouter(prefix="/api/analytics", tags=["analytics"])
FINISHED = ("completed", "failed", "cancelled")


@router.get("/summary", response_model=AnalyticsSummary, summary="Aggregate metrics computed from stored runs")
def summary(ctx: Context = Depends(get_ctx)) -> dict:
    runs = ctx.db.list_runs(limit=100000)
    sessions, total_sessions = ctx.db.list_sessions(1, 0)
    with ctx.db.conn() as c:
        puzzles_total = c.execute("SELECT COUNT(*) FROM puzzles").fetchone()[0]
    verified = [r for r in runs if (r.get("result") or {}).get("verified")]
    times = [r["result"]["elapsed_seconds"] for r in verified if r["result"].get("elapsed_seconds") is not None]

    def total(key: str) -> int:
        return sum(int(((r.get("result") or {}).get("counters") or {}).get(key, 0) or 0) for r in runs)

    ev = ctx.db.latest_evaluation()
    latest = None
    if ev:
        cases = (ev.get("result") or {}).get("cases", [])
        latest = {"evaluation_id": ev["evaluation_id"], "finished_at": ev["finished_at"], "cases": len(cases),
                  "ta2_multi_agent_correct": sum(bool(c["systems"].get("ta2_multi_agent_mrv", {}).get("correct")) for c in cases),
                  "ta1_tot_correct": sum(bool(c["systems"].get("ta1_tot", {}).get("correct")) for c in cases)}
    return {"sessions_saved": total_sessions, "puzzles_total": puzzles_total, "runs_total": len(runs),
            "runs_by_mode": dict(Counter(r["mode"] for r in runs)), "runs_by_status": dict(Counter(r["status"] for r in runs)),
            "puzzles_solved": len({r["puzzle_id"] for r in verified}), "verified_runs": len(verified),
            "average_solve_seconds": round(sum(times) / len(times), 6) if times else None,
            "search_nodes_explored": total("nodes"), "dead_end_branches": total("dead_ends"),
            "branches_pruned": total("pruned"), "backtracks": total("backtracks"),
            "llm_calls": sum(int((r.get("result") or {}).get("llm_calls") or 0) for r in runs),
            "tool_calls": sum(int((r.get("result") or {}).get("tool_calls") or 0) for r in runs),
            "latest_evaluation": latest}


def _metrics(r: dict) -> dict:
    res = r.get("result") or {}
    c = res.get("counters") or {}
    return {"run_id": r["run_id"], "mode": r["mode"], "status": r["status"], "created_at": r["created_at"],
            "outcome": res.get("outcome"), "verified": bool(res.get("verified")), "seconds": res.get("elapsed_seconds"),
            "nodes": c.get("nodes"), "pruned": c.get("pruned"), "backtracks": c.get("backtracks"), "dead_ends": c.get("dead_ends"),
            "llm_calls": res.get("llm_calls"), "tool_calls": res.get("tool_calls"),
            "solver_calls": c.get("solver_calls", 1 if r["mode"] == "tot" else 0 if r["mode"] == "cot" else None),
            "memory_confirmed": c.get("memory_confirmed"), "use_memory": bool((r.get("config") or {}).get("use_memory"))}


def _aggregate(label: str, rows: list[dict]) -> dict:
    def nums(k):
        return [x[k] for x in rows if isinstance(x.get(k), (int, float))]

    def mean(k):
        v = nums(k)
        return round(sum(v) / len(v), 6) if v else None
    secs = nums("seconds")
    return {"label": label, "runs": len(rows), "verified": sum(x["verified"] for x in rows),
            "verified_rate": round(sum(x["verified"] for x in rows) / len(rows), 4) if rows else None,
            "mean_seconds": mean("seconds"), "median_seconds": round(statistics.median(secs), 6) if secs else None,
            "mean_nodes": mean("nodes"), "mean_dead_ends": mean("dead_ends"), "mean_backtracks": mean("backtracks"),
            "llm_calls": sum(nums("llm_calls")), "tool_calls": sum(nums("tool_calls")), "solver_calls": sum(nums("solver_calls")),
            "run_ids": [x["run_id"] for x in rows[:25]]}


@router.get("/comparisons", response_model=AnalyticsComparisons,
            summary="Mode, same-puzzle, memory, voting and approval comparisons computed from stored runs only")
def comparisons(ctx: Context = Depends(get_ctx)) -> dict:
    runs = [r for r in ctx.db.list_runs(limit=100000) if r["status"] in FINISHED]
    rows = [_metrics(r) for r in runs]
    by_mode = {m: [x for x in rows if x["mode"] == m] for m in ("cot", "tot", "multi-agent")}
    groups: dict[str, list[tuple[dict, dict]]] = defaultdict(list)
    for r, m in zip(runs, rows):
        groups[json.dumps(r["board"])].append((r, m))
    same = []
    for key, items in groups.items():
        modes = {m["mode"] for _, m in items}
        if len(items) >= 2:
            same.append({"board": json.loads(key), "modes": sorted(modes), "runs": [m for _, m in items[:12]]})
    same.sort(key=lambda g: (-len(g["modes"]), -len(g["runs"])))
    tot = by_mode["tot"]
    votes = []
    for r, m in zip(runs, rows):
        v = (r.get("result") or {}).get("vote")
        if r["mode"] == "multi-agent" and v:
            cfg = r.get("config") or {}
            votes.append({"run_id": r["run_id"], "created_at": r["created_at"], "votes": v.get("votes", {}),
                          "eligible": v.get("eligible", []), "excluded": v.get("excluded", []),
                          "disagreement": v.get("disagreement"), "verified_winner": m["verified"],
                          "faults": cfg.get("faults") or [], "inject_tool_failure": cfg.get("inject_tool_failure"),
                          "max_hops": cfg.get("max_hops"), "outcome": m["outcome"]})
    approvals = ctx.db.list_approvals(500)
    by_status: dict[str, list[str]] = defaultdict(list)
    for a in approvals:
        by_status[a["status"]].append(a["approval_id"])
    return {"source": "computed from stored runs and approvals in the backend database; nothing is hardcoded or estimated",
            "finished_runs": len(rows),
            "modes": [_aggregate(m, by_mode[m]) for m in ("cot", "tot", "multi-agent")],
            "same_puzzle": same[:10],
            "memory": [_aggregate("memory off", [x for x in tot if not x["use_memory"]]),
                       _aggregate("memory on", [x for x in tot if x["use_memory"]])],
            "votes": votes[:25],
            "approvals": {k: {"count": len(v), "approval_ids": v[:10]} for k, v in by_status.items()}}
