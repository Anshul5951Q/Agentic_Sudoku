"""Generate the report tables in docs/report/ from code and recorded evidence. Nothing is typed by hand.

* ROLE_TABLE.md        <- ta2.agents.CONTRACTS + ta2.supervisor.SUPERVISOR_CONTRACT (the contracts the code enforces)
* FIVE_CASE_TABLE.md   <- traces/evaluation.json (written by `python -m ta2.main --mode evaluate`)

    python scripts/build_report_tables.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ta2.agents import CONTRACTS  # noqa: E402
from ta2.supervisor import SUPERVISOR_CONTRACT  # noqa: E402

OUT = ROOT / "docs" / "report"


def cell(v) -> str:
    """Counts and flags. Times go through fmt_t() so a float is never mistaken for seconds."""
    if v is None:
        return "n/a"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else f"{v:.2f}"
    return str(v).replace("|", "/")


def fmt_t(v) -> str:
    if v is None:
        return "n/a"
    return f"{v * 1000:.3f} ms" if v < 1 else f"{v:.2f} s"


def role_table() -> str:
    rows = ["| Role | Goal | Tools | Inputs → outputs | Limits |", "|---|---|---|---|---|"]
    for c in [*CONTRACTS, SUPERVISOR_CONTRACT]:
        rows.append(f"| **{c.name}** | {c.goal} | {', '.join(c.tools)} | {c.inputs_outputs} | {c.limits} |")
    return "# Role table (five-field contracts)\n\nGenerated from `ta2/agents.py` and `ta2/supervisor.py` by " \
           "`scripts/build_report_tables.py`; the backend serves the same objects at `GET /api/agents/contracts`.\n\n" + "\n".join(rows) + "\n"


SYSTEMS = [("ta1_cot", "TA1 CoT"), ("ta1_tot", "TA1 ToT"), ("ta2_single_mrv", "TA2 single (MRV)"),
           ("ta2_single_first_empty_desc", "TA2 single (TA1 order)"), ("ta2_multi_agent_mrv", "TA2 multi-agent (parallel)"),
           ("ta2_multi_agent_sequential", "TA2 multi-agent (sequential)"), ("ta2_multi_agent_with_rag", "TA2 multi-agent + RAG")]


def secs(m: dict):
    return m.get("median_seconds", m.get("seconds"))


def mean(rows, key, f):
    v = [f(r[key]) for r in rows if key in r and isinstance(f(r[key]), (int, float)) and not isinstance(f(r[key]), bool)]
    return sum(v) / len(v) if v else None


def five_case(ev: dict) -> str:
    cases = ev["cases"]
    present = [(k, n) for k, n in SYSTEMS if any(k in c for c in cases)]
    out = [f"# Five-case evaluation: TA1 vs TA2\n\nSource: `traces/evaluation.json` (generated {ev.get('generated_at', 'n/a')}, "
           f"LLM `{ev.get('models', {}).get('llm', 'n/a')}`). {ev.get('timing', '')}. Regenerate with "
           "`python -m ta2.main --mode evaluate` then `python scripts/build_report_tables.py`.\n"]
    out.append("## Correctness, nodes, time per case\n")
    out.append("| Case | " + " | ".join(n for _, n in present) + " |")
    out.append("|---|" + "---|" * len(present))
    for c in cases:
        cells = []
        for k, _ in present:
            m = c.get(k)
            if not m:
                cells.append("not run")
            elif m.get("skipped") or m.get("error"):
                cells.append(f"skipped ({m.get('skipped') or m.get('error')})")
            else:
                cells.append(f"{'✓' if m.get('correct') else '✗'} · {cell(m.get('nodes'))} nodes · {fmt_t(secs(m))}")
        out.append(f"| {c['case']}. {c['name']} ({c['empties']} empty) | " + " | ".join(cells) + " |")
    out.append("\n## Means over the five cases\n")
    out.append("| System | Correct | Mean nodes | Mean time | Solver calls | LLM calls | Pruned | Backtracks |")
    out.append("|---|---|---|---|---|---|---|---|")
    for k, n in present:
        ran = [c for c in cases if k in c and not c[k].get("skipped") and not c[k].get("error")]
        ok = sum(bool(c[k].get("correct")) for c in ran)
        out.append(f"| {n} | {ok}/{len(ran)} | {cell(mean(ran, k, lambda m: m.get('nodes')))} | {fmt_t(mean(ran, k, secs))} | "
                   f"{cell(mean(ran, k, lambda m: m.get('solver_calls')))} | {cell(mean(ran, k, lambda m: m.get('llm_calls')))} | "
                   f"{cell(mean(ran, k, lambda m: m.get('pruned')))} | {cell(mean(ran, k, lambda m: m.get('backtracks')))} |")
    out.append("\n## Memory disabled vs enabled (TA1 cell order, repeated case)\n")
    out.append("| Case | Off: dead ends / nodes | On, first run | On, repeat run | Memory prunes on repeat |")
    out.append("|---|---|---|---|---|")
    for m in ev.get("memory_comparison", []):
        f = lambda d: f"{d['dead_ends']} / {d['nodes']}"  # noqa: E731
        out.append(f"| {m['case']} | {f(m['disabled'])} | {f(m['enabled_first_run'])} | {f(m['enabled_repeat_run'])} | "
                   f"{m['enabled_repeat_run']['memory_confirmed']} |")
    rag = ev.get("rag_comparison") or []
    out.append("\n## RAG k=1 vs k=3\n")
    if not rag:
        out.append("Not measured in this evaluation (RAG off or Ollama/Chroma unavailable).")
    else:
        out.append("| Query | k=1 | k=3 |")
        out.append("|---|---|---|")
        for r in rag:
            def side(s):
                if s.get("error"):
                    return f"error {s['error']}"
                return (f"{'I dont know' if s['abstained'] else 'answered'} · top {s.get('top_similarity')} · "
                        f"{s['evidence']} chunk(s) {', '.join(s['chunk_ids'])} · {s['llm_calls']} LLM · {fmt_t(s['seconds'])}")
            out.append(f"| {'(unanswerable) ' if r['group'] == 'unanswerable' else ''}{r['query']} | {side(r['k1'])} | {side(r['k3'])} |")
    ch = ev.get("challenge")
    if ch:
        out.append("\n## Challenge analysis\n\n### Error propagation (one controlled faulty variant)\n")
        out.append("| Fault | Solved | Verified votes | Excluded | Time | Wrong answer reached the user |")
        out.append("|---|---|---|---|---|---|")
        for f in ch["fault_propagation"]:
            ex = ", ".join(f"{x['attempt']}: {x['reason']}" for x in f["excluded"]) or "none"
            out.append(f"| {f['fault']} | {cell(f['solved'])} | {f['verified_votes']}/{f['solver_calls']} | {ex} | {fmt_t(f['seconds'])} | "
                       f"{cell(f['propagated_to_answer'])} |")
        out.append("\n### Tool failure and recovery\n")
        out.append("| Case | Tool calls | Failures | Recovered | Solved | Explanation |")
        out.append("|---|---|---|---|---|---|")
        for t in ch["tool_failure"]:
            out.append(f"| {t['case']} | {t['tool_calls']} | {t['tool_failures']} | {cell(t['recovered'])} | {cell(t['solved'])} | {t['explanation']} |")
        out.append("\n### Prompt injection: deterministic pattern guard\n")
        out.append("| Texts | Count | Blocked by pattern guard | Passed on to legality check + human approval |")
        out.append("|---|---|---|---|")
        for k, g in ch["injection_guard"].items():
            out.append(f"| {k.replace('_', ' ')} | {g['attempts']} | {g['blocked_by_pattern_guard']} | {g['passed_to_legality_check']} |")
        out.extend(f"\n* {n}" for n in ch.get("notes", []))
    inj = ROOT / "traces" / "challenge_injection.json"
    if inj.exists():
        s = json.loads(inj.read_text(encoding="utf-8")).get("summary")
        if s:
            out.append("\n### Prompt injection with live Qwen (from `traces/challenge_injection.json`)\n")
            out.append("| Texts | Attempts | Unguarded illegal commits | Caught by pattern guard | Caught by legality check | Guarded illegal commits |")
            out.append("|---|---|---|---|---|---|")
            for k, v in s.items():
                out.append(f"| {k.replace('_', ' ')} | {v['attempts']} | {v['unguarded_illegal_commits']} | {v['caught_by_pattern_guard']} | "
                           f"{v['caught_by_legality_check']} | {v['guarded_illegal_commits']} |")
    out.append("\n## Notes from the harness\n")
    out.extend(f"* {n}" for n in ev.get("notes", []))
    return "\n".join(out) + "\n"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "ROLE_TABLE.md").write_text(role_table(), encoding="utf-8")
    ev = json.loads((ROOT / "traces" / "evaluation.json").read_text(encoding="utf-8"))
    (OUT / "FIVE_CASE_TABLE.md").write_text(five_case(ev), encoding="utf-8")
    print("wrote docs/report/ROLE_TABLE.md and docs/report/FIVE_CASE_TABLE.md")


if __name__ == "__main__":
    main()
