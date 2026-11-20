from collections import Counter

from fastapi import APIRouter, Depends

from ..context import Context, get_ctx
from ..schemas import AnalyticsSummary

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


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
