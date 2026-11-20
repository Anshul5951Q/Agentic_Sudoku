"""CLI for the TA2 extension. Heavy components are imported lazily so each mode only needs what it uses."""
from __future__ import annotations

import argparse
import json
import sys

from . import config

PUZZLE = [[0, 0, 3, 4], [3, 4, 0, 0], [0, 1, 4, 0], [4, 0, 0, 1]]
TRACE_DIR = config.TRACE_DIR
MODES = ["solve", "rag", "evaluate", "checkpoint", "resume", "memory", "chat", "approve", "inject-failure",
         "hop-limit", "challenge", "demos"]


def print_grid(board) -> None:
    if board is None:
        print("No verified solution found.")
        return
    for row in board:
        print(" ".join(str(x) if x else "." for x in row))


def _show(label: str, payload: dict, keys: tuple[str, ...] = ()) -> None:
    where = config.TRACE_DIR / f"{payload.get('kind', label)}.json"
    print(f"[{label}] saved -> {where}")
    for k in keys:
        if k in payload:
            print(f"  {k}: {json.dumps(payload[k], default=str)[:400]}")


def mode_solve(args) -> None:
    from .demos import save
    from .supervisor import Supervisor
    strategy = args.strategy
    print("Initial puzzle:")
    print_grid(PUZZLE)
    result = Supervisor(strategy=strategy).solve_and_vote(PUZZLE, run_id="solve-cli")
    print(f"\nStatus: {result['status']}  (strategy={strategy}, candidate-order variants, hops={result['hops']}/{result['max_hops']})")
    print("Verified voted solution:")
    print_grid(result["solution"])
    print("Votes (verified solutions only):", json.dumps(result["votes"]))
    for a in result["attempts"]:
        c = a["counters"]
        print(f"  {a['name']}: status={a['status']} nodes={a['nodes']} pruned={c.get('pruned')} backtracks={c.get('backtracks')}")
    save("latest_solve", {"puzzle": PUZZLE, "result": {k: v for k, v in result.items() if k != "runs"}})
    print("Saved search tree and agent traces to", config.TRACE_DIR / "latest_solve.json")
    if not result["valid"]:
        raise SystemExit("No verified solution; inspect traces before reporting results.")


def mode_rag(args) -> None:
    from . import rag
    r = rag.answer(args.query, args.k)
    print(f"Query: {r['query']}\nk={r['k']}  top similarity={r.get('top_similarity')}  threshold={r.get('threshold')}")
    for c in r["evidence"]:
        print(f"  - {c['chunk_id']} [{c['heading']}] similarity={c['similarity']}")
    print("\nAnswer:", r["answer"], f"({r['reason_code']})")


def mode_evaluate(args) -> None:
    from .demos import challenge_cost, save
    from .evaluation import run_evaluation
    out = run_evaluation(with_cot=not args.no_cot, with_rag=not args.no_rag)
    for name, tr in out.pop("traces").items():
        save(f"eval_{name}", {"data": tr})
    save("evaluation", out)
    challenge_cost(out)
    print(f"{'case':<5}{'TA1 ToT nodes/prune':<22}{'TA2 mrv nodes':<15}{'TA2 first-empty bt':<20}{'multi (3 variants) s':<22}{'TA1 CoT':<10}")
    for r in out["cases"]:
        cot = r.get("ta1_cot", {})
        print(f"{r['case']:<5}{str(r['ta1_tot']['nodes']) + '/' + str(r['ta1_tot']['pruned']):<22}{r['ta2_single_mrv']['nodes']:<15}"
              f"{r['ta2_single_first_empty_desc']['backtracks']:<20}{r['ta2_multi_agent_mrv']['median_seconds']:<22.6f}"
              f"{('ok' if cot.get('correct') else 'wrong') if 'correct' in cot else 'n/a':<10}")
    print("Saved measured results to", config.TRACE_DIR / "evaluation.json")


def mode_checkpoint(args) -> None:
    from .demos import demo_checkpoint
    p = demo_checkpoint(args.thread_id)
    _show("checkpoint", p, ("paused", "reloaded_from_checkpoint", "final"))


def mode_resume(args) -> None:
    from .checkpointer import build_graph, load_state, open_saver, resume_search
    with open_saver(config.CHECKPOINT_DB) as saver:
        app = build_graph(saver)
        before = load_state(app, args.thread_id)
        print(f"Resuming '{args.thread_id}' from decision step {before['counters']['steps']} (status {before['status']})")
        after = resume_search(app, args.thread_id)
    print("status:", after["status"])
    print_grid(after["solution"])


def mode_memory(args) -> None:
    from .demos import demo_long_term_memory
    _show("long-term memory", demo_long_term_memory(), ("read_back_by_a_separate_python_process", "second_run_using_recalled_memory"))


def mode_chat(args) -> None:
    from .demos import demo_short_term_memory
    p = demo_short_term_memory()
    _show("short-term memory", p)
    for k in ("with_memory", "without_memory"):
        if k in p:
            print(f"  {k}: model saw {p[k]['messages_seen_by_model']} message(s) -> {p[k]['reply']}")


def mode_approve(args) -> None:
    from .demos import demo_oversight
    p = demo_oversight()
    _show("oversight", p)
    for k in ("approved_path", "rejected_path", "injection_path"):
        if k in p:
            print(f"  {k}: outcome={p[k]['outcome']}")


def mode_inject_failure(args) -> None:
    from .demos import demo_failure
    p = demo_failure()
    _show("failure recovery", p, ("verified_solution_still_returned",))


def mode_hop_limit(args) -> None:
    from .demos import demo_supervisor
    p = demo_supervisor()
    _show("supervisor", p, ("hops_used",))
    print("  hop-limit run:", p["hop_limit_run"]["status"], p["hop_limit_run"]["failure"])


def mode_challenge(args) -> None:
    from .demos import challenge_injection
    p = challenge_injection()
    _show("challenge", p, ("summary", "error"))


def mode_demos(args) -> None:
    from .demos import (challenge_injection, demo_checkpoint, demo_failure, demo_long_term_memory, demo_oversight,
                        demo_rag, demo_short_term_memory, demo_supervisor)
    for name, fn in (("checkpoint_resume", demo_checkpoint), ("long_term_memory", demo_long_term_memory),
                     ("short_term_memory", demo_short_term_memory), ("rag", demo_rag), ("failure_recovery", demo_failure),
                     ("supervisor", demo_supervisor), ("oversight", demo_oversight), ("challenge_injection", challenge_injection)):
        try:
            p = fn()
            print(f"[ok] {name} -> {config.TRACE_DIR / (p['kind'] + '.json')}" + (f"  (note: {p['error']})" if "error" in p else ""))
        except Exception as e:
            print(f"[FAILED] {name}: {type(e).__name__}: {str(e)[:200]}")
    mode_evaluate(argparse.Namespace(no_cot=False, no_rag=False))


def main(argv=None) -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Local Sudoku TA2: memory, RAG, agents, voting, checkpointing, oversight, evaluation")
    parser.add_argument("--mode", choices=MODES, default="solve")
    parser.add_argument("--thread-id", default="sudoku-demo")
    parser.add_argument("--query", default="What should the solver do when a cell has no candidates?")
    parser.add_argument("--k", type=int, choices=[1, 3], default=3)
    parser.add_argument("--strategy", choices=["mrv", "first_empty"], default="first_empty")
    parser.add_argument("--no-cot", action="store_true", help="skip the real TA1 CoT (Qwen) calls in evaluate")
    parser.add_argument("--no-rag", action="store_true", help="skip RAG context runs in evaluate")
    args = parser.parse_args(argv)
    config.TRACE_DIR.mkdir(parents=True, exist_ok=True)
    globals()["mode_" + args.mode.replace("-", "_")](args)


if __name__ == "__main__":
    main()
