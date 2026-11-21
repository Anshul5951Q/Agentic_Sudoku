"""Run orchestration: wraps the TA2 engine/supervisor/TA1-CoT runner. No Sudoku logic lives here.

* ToT runs execute the checkpointed LangGraph search in small chunks. After every chunk the new trace
  events are written to SQLite, then the pause/cancel/timeout flags are checked, so pause/cancel happen
  at a safe decision boundary and the state is persisted before they are acknowledged.
* A run survives a backend restart: running runs are marked ``interrupted`` and can be resumed from
  their LangGraph checkpoint (never from the root unless the checkpoint is missing or invalid).
"""
from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
import threading
import time
from time import perf_counter
from typing import Callable

from ta2 import sudoku_rules as R
from ta2.agents import VerifierAgent
from ta2.checkpointer import (CheckpointError, build_graph, load_state, mark_paused, mark_terminal, open_saver,
                              resume_search, start_search)
from ta2.models import TraceEvent, utc_now
from ta2.failure import FailureInjector, ToolRunner, fault_solver
from ta2.memory import SudokuMemory
from ta2.supervisor import Supervisor, default_solver

from ..core.errors import APIError, ID_RE, not_found
from ..core.ids import new_id
from ..schemas import TERMINAL_STATUSES
from .agents import TERMINAL_EVENTS

log = logging.getLogger("sudokumind.runs")

DETERMINISTIC = {
    "tot": ["cell selection (MRV / first-empty)", "candidate generation", "row/column/box rule checking",
            "pruning and backtracking", "final solution verification"],
    "multi-agent": ["cell selection", "candidate generation", "rule checking", "pruning and backtracking",
                    "supervisor routing and MAX_HOPS", "vote counting (verified solutions only)", "final solution verification"],
    "cot": ["final board verification (the model's answer is never trusted)"],
}
LLM = {"tot": [], "multi-agent": [], "cot": ["qwen2.5:3b single-path reasoning (frozen TA1 CoT prompt)"]}


class RunControl:
    def __init__(self):
        self.pause, self.cancel = threading.Event(), threading.Event()
        self.thread: threading.Thread | None = None

    @property
    def live(self) -> bool:
        return self.thread is not None and self.thread.is_alive()


def request_hash(mode: str, board, config: dict) -> str:
    return hashlib.sha256(json.dumps([mode, board, config], sort_keys=True).encode()).hexdigest()


class RunManager:
    def __init__(self, db, settings, cot_runner: Callable[[list], dict] | None = None,
                 rag_retrieve: Callable[[], object] | None = None):
        self.db, self.s = db, settings
        self.cot_runner = cot_runner
        self.rag_retrieve = rag_retrieve or self._default_rag_retrieve
        self.controls: dict[str, RunControl] = {}
        self.lock = threading.RLock()

    def _default_rag_retrieve(self):
        from ta2 import rag
        return rag.retrieve_scored("dead end backtracking candidates", 3, store=rag.get_vectorstore(self.s.chroma_dir))

    # ------------------------------------------------------------------ creation
    def recover(self) -> int:
        """After a restart no worker is alive: mark orphaned runs interrupted (resumable if checkpointed)."""
        n = 0
        for r in self.db.runs_with_status("running", "queued"):
            if not self.is_live(r["run_id"]):
                self.db.update_run(r["run_id"], status="interrupted")
                n += 1
        return n

    def is_live(self, run_id: str) -> bool:
        """A worker is executing the run NOW. A finished run is never live, even in the instant before its
        worker thread has fully exited (status is the source of truth)."""
        c = self.controls.get(run_id)
        if not (c and c.live):
            return False
        r = self.db.get_run(run_id)
        return bool(r and r["status"] in ("queued", "running"))

    def create(self, mode: str, board, puzzle: dict, config: dict, idem_key: str | None) -> tuple[dict, bool]:
        conflicts = R.find_conflicts(board)
        if conflicts:
            raise APIError(422, "PUZZLE_CONTRADICTORY", "The puzzle breaks the Sudoku rules and cannot be solved.",
                           details={"conflicts": conflicts[:5]})
        if idem_key is not None and not ID_RE.match(idem_key):
            raise APIError(422, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be 1-64 characters: letters, digits, _ or -")
        rh = request_hash(mode, board, config)
        with self.lock:
            if idem_key:
                prev = self.db.find_by_idempotency(idem_key)
                if prev:
                    if prev["request_hash"] != rh:
                        raise APIError(409, "IDEMPOTENCY_CONFLICT", "This Idempotency-Key was already used with a different request.")
                    return prev, True
            run_id = new_id("run")
            run = self.db.create_run({"run_id": run_id, "thread_id": new_id("thread"), "session_id": puzzle["session_id"],
                                      "puzzle_id": puzzle["puzzle_id"], "mode": mode, "status": "queued", "board": board,
                                      "config": config, "created_at": utc_now(), "idempotency_key": idem_key,
                                      "request_hash": rh})
            self.db.touch_session(puzzle["session_id"])
            self._spawn(run_id, {"tot": self._tot_worker, "multi-agent": self._multi_worker, "cot": self._cot_worker}[mode], False)
        return run, False

    def _spawn(self, run_id: str, target, resume: bool) -> None:
        ctl = self.controls.setdefault(run_id, RunControl())
        ctl.pause.clear()
        t = threading.Thread(target=self._guard, args=(target, run_id, resume), daemon=True, name=f"run-{run_id}")
        ctl.thread = t
        t.start()

    def _guard(self, target, run_id: str, resume: bool) -> None:
        try:
            target(run_id, resume)
        except Exception:
            log.exception("run %s crashed", run_id)
            self._fail(run_id, "INTERNAL_ERROR", "The run failed because of an internal error.")

    # ------------------------------------------------------------------ control endpoints
    def get(self, run_id: str) -> dict:
        r = self.db.get_run(run_id)
        if not r:
            raise not_found("run", run_id)
        return r

    def has_checkpoint(self, thread_id: str) -> bool:
        try:
            con = sqlite3.connect(str(self.s.checkpoint_db), timeout=5)
            try:
                return con.execute("SELECT 1 FROM checkpoints WHERE thread_id=? LIMIT 1", (thread_id,)).fetchone() is not None
            finally:
                con.close()
        except sqlite3.Error:
            return False

    def resumable(self, run: dict) -> bool:
        return run["mode"] == "tot" and run["status"] in ("paused", "interrupted") and self.has_checkpoint(run["thread_id"])

    def checkpoint_summary(self, run: dict) -> dict:
        """Summary of the LangGraph checkpoint for a run (what a resume would continue from)."""
        base = {"thread_id": run["thread_id"], "status": None, "search_steps": None, "depth": None, "events": None,
                "resumable": False, "detail": None}
        if run["mode"] != "tot":
            return {**base, "detail": "only tree-of-thought runs are checkpointed per decision"}
        if not self.has_checkpoint(run["thread_id"]):
            return {**base, "detail": "no checkpoint stored for this run"}
        try:
            with open_saver(self.s.checkpoint_db) as saver:
                st = load_state(build_graph(saver), run["thread_id"])
        except CheckpointError as e:
            return {**base, "detail": e.message}
        return {**base, "status": st["status"], "search_steps": st["counters"]["steps"], "depth": len(st["stack"]),
                "events": len(st["events"]), "resumable": run["status"] in ("paused", "interrupted") and st["status"] == "running"}

    def pause(self, run_id: str, wait_s: float = 15.0) -> dict:
        run = self.get(run_id)
        if run["mode"] != "tot":
            raise APIError(409, "PAUSE_NOT_SUPPORTED", "Only tree-of-thought runs have decision-level checkpoints; "
                           "multi-agent and CoT runs are short atomic runs.", recoverable=True)
        if run["status"] == "paused":
            return run                                      # duplicate pause: idempotent
        if run["status"] in TERMINAL_STATUSES or run["status"] == "interrupted":
            raise APIError(409, "INVALID_STATE", f"cannot pause a run that is {run['status']}")
        ctl = self.controls.get(run_id)
        if not ctl or not ctl.live:
            raise APIError(409, "INVALID_STATE", "run has no active worker")
        ctl.pause.set()
        deadline = perf_counter() + wait_s
        while perf_counter() < deadline:                    # acknowledge only after state is persisted
            r = self.db.get_run(run_id)
            if r["status"] == "paused":
                return r
            if r["status"] in TERMINAL_STATUSES:
                raise APIError(409, "INVALID_STATE", f"run finished ({r['status']}) before it could be paused")
            time.sleep(0.01)
        raise APIError(408, "PAUSE_TIMEOUT", "The run did not reach a safe boundary in time; try again.", retryable=True)

    def resume(self, run_id: str) -> dict:
        with self.lock:
            run = self.get(run_id)
            if run["status"] == "running" and self.is_live(run_id):
                return run                                  # duplicate resume: idempotent
            if run["mode"] != "tot":
                raise APIError(409, "RESUME_NOT_SUPPORTED", "Only tree-of-thought runs can be resumed.")
            if run["status"] not in ("paused", "interrupted"):
                raise APIError(409, "INVALID_STATE", f"cannot resume a run that is {run['status']}")
            if not self.has_checkpoint(run["thread_id"]):
                raise APIError(409, "CHECKPOINT_UNAVAILABLE", "No checkpoint exists for this run; start a new run.", recoverable=True)
            self.db.update_run(run_id, status="running")
            self._spawn(run_id, self._tot_worker, True)
        return self.get(run_id)

    def cancel(self, run_id: str, wait_s: float = 15.0) -> dict:
        with self.lock:
            run = self.get(run_id)
            if run["status"] == "cancelled":
                return run
            if run["status"] in ("completed", "failed"):
                raise APIError(409, "INVALID_STATE", f"cannot cancel a run that is {run['status']}")
            if run["mode"] != "tot" and self.is_live(run_id):
                raise APIError(409, "RUN_NOT_CANCELLABLE", "Multi-agent and CoT runs are short atomic runs and cannot be cancelled mid-flight.")
            ctl = self.controls.setdefault(run_id, RunControl())
            if not ctl.live:                                # paused / interrupted: cancel directly
                self._cancel_idle(run)
                return self.get(run_id)
            ctl.cancel.set()
        deadline = perf_counter() + wait_s
        while perf_counter() < deadline:
            r = self.db.get_run(run_id)
            if r["status"] in TERMINAL_STATUSES:
                return r
            time.sleep(0.01)
        raise APIError(408, "CANCEL_TIMEOUT", "The run did not stop in time; try again.", retryable=True)

    def _cancel_idle(self, run: dict) -> None:
        run_id = run["run_id"]
        try:
            with open_saver(self.s.checkpoint_db) as saver:
                app = build_graph(saver)
                state = mark_terminal(app, run["thread_id"], "search_cancelled", "cancelled", "CANCELLED", "cancelled by user")
            self._persist(run_id, state)
        except CheckpointError:
            self._append_terminal(run_id, "search_cancelled", "CANCELLED", "cancelled by user")
        self.db.update_run(run_id, status="cancelled", finished_at=utc_now(),
                           result={"outcome": "cancelled", "verified": False, "counters": (self.get(run_id)["progress"] or {})})

    # ------------------------------------------------------------------ persistence helpers
    def _persist(self, run_id: str, state: dict) -> None:
        last = self.db.last_sequence(run_id)
        self.db.insert_events(run_id, [e for e in state["events"] if e["sequence"] > last])
        self.db.upsert_nodes(run_id, state["nodes"])
        prog = dict(state["counters"])
        prev = (self.db.get_run(run_id) or {}).get("progress") or {}
        prog["active_seconds"] = prev.get("active_seconds", 0.0)
        self.db.update_run(run_id, progress=prog)

    def _append_terminal(self, run_id: str, event: str, code: str, reason: str) -> None:
        events = self.db.get_events(run_id)
        if events and events[-1]["event"] in TERMINAL_EVENTS:
            return
        seq = (events[-1]["sequence"] + 1) if events else 0
        run = self.db.get_run(run_id)
        ev = TraceEvent(event_id=f"{run_id}-event-{seq:05d}", run_id=run_id, thread_id=run["thread_id"], sequence=seq,
                        event=event, agent="Supervisor", reason_code=code, reason=reason).model_dump()
        self.db.insert_events(run_id, [ev])

    def _fail(self, run_id: str, code: str, reason: str) -> None:
        self._append_terminal(run_id, "search_failed", code, reason)
        run = self.db.get_run(run_id)
        self.db.update_run(run_id, status="failed", finished_at=utc_now(),
                           result={"outcome": "failed", "verified": False, "failure": {"code": code, "reason": reason},
                                   "counters": run.get("progress") or {}})

    def _finish_state(self, run_id: str, state: dict, extra: dict | None = None) -> None:
        run = self.db.get_run(run_id)
        sol = state.get("solution")
        verified = bool(sol is not None and VerifierAgent().verify_final(sol, run["board"]).ok)   # never trust the flag
        status = state["status"]
        outcome = "solved" if (status == "solved" and verified) else {"exhausted": "exhausted", "limit_reached": "limit_reached",
                                                                          "cancelled": "cancelled"}.get(status, "failed")
        run_status = {"cancelled": "cancelled", "failed": "failed", "limit_reached": "failed"}.get(status, "completed")
        prog = run.get("progress") or {}
        res = {"outcome": outcome, "verified": verified, "solution": sol if verified else None,
               "failure": state.get("failure"), "counters": state["counters"], "llm_calls": 0, "tool_calls": 0,
               "elapsed_seconds": round(prog.get("active_seconds", 0.0), 6),
               "note": "exhausted: the search space was fully explored; the puzzle has no solution" if outcome == "exhausted" else None,
               **(extra or {})}
        self.db.update_run(run_id, status=run_status, finished_at=utc_now(), result=res)

    def _add_active(self, run_id: str, seconds: float) -> None:
        prog = (self.db.get_run(run_id).get("progress") or {})
        prog["active_seconds"] = prog.get("active_seconds", 0.0) + seconds
        self.db.update_run(run_id, progress=prog)

    # ------------------------------------------------------------------ workers
    def _tot_worker(self, run_id: str, resume: bool) -> None:
        run = self.db.get_run(run_id)
        cfg, ctl, tid = run["config"], self.controls[run_id], run["thread_id"]
        self.db.update_run(run_id, status="running", **({} if run["started_at"] else {"started_at": utc_now()}))
        started = resume
        announce = resume
        seg_start = perf_counter()
        elapsed_before = (run.get("progress") or {}).get("active_seconds", 0.0)
        try:
            hook = SudokuMemory(self.s.memory_db, user_id=cfg.get("user_id", "demo-user")) if cfg.get("use_memory") else None
            with open_saver(self.s.checkpoint_db) as saver:
                app = build_graph(saver, memory_hook=hook)
                while True:
                    try:
                        if not started:
                            state = start_search(app, run["board"], tid, cfg["strategy"], cfg["order"],
                                                 max_steps=self.s.chunk_steps, max_nodes=cfg["max_nodes"], silent=True,
                                                 run_id=run_id)
                            started = True
                        else:
                            # the first chunk after a pause OR a restart records search_resumed in the trace
                            state = resume_search(app, tid, max_steps=self.s.chunk_steps, silent=True, announce=announce)
                            announce = False
                    except CheckpointError as e:
                        self._add_active(run_id, perf_counter() - seg_start)
                        self._fail(run_id, e.code, "The saved checkpoint is missing or invalid; start a new run.")
                        return
                    self._persist(run_id, state)
                    if state["status"] != "running":
                        self._add_active(run_id, perf_counter() - seg_start)
                        self._finish_state(run_id, state)
                        return
                    if ctl.cancel.is_set():
                        state = mark_terminal(app, tid, "search_cancelled", "cancelled", "CANCELLED", "cancelled by user")
                        self._persist(run_id, state)
                        self._add_active(run_id, perf_counter() - seg_start)
                        self._finish_state(run_id, state)
                        return
                    if elapsed_before + perf_counter() - seg_start > cfg["timeout_s"]:
                        state = mark_terminal(app, tid, "search_failed", "failed", "TIMEOUT", "search exceeded its time budget")
                        self._persist(run_id, state)
                        self._add_active(run_id, perf_counter() - seg_start)
                        self._finish_state(run_id, state)
                        return
                    if ctl.pause.is_set():
                        state = mark_paused(app, tid)
                        self._persist(run_id, state)
                        self._add_active(run_id, perf_counter() - seg_start)
                        ctl.pause.clear()
                        self.db.update_run(run_id, status="paused")      # acknowledged only after persistence
                        return
                    if self.s.step_delay:
                        time.sleep(self.s.step_delay)
        finally:
            ctl.cancel.clear()

    @staticmethod
    def _fault_solver(faults: list[dict]):
        """CONTROLLED demo faults around the unchanged deterministic solver (shared with the evaluation harness)."""
        return fault_solver(faults, default_solver)

    def _multi_worker(self, run_id: str, resume: bool) -> None:
        run = self.db.get_run(run_id)
        cfg = run["config"]
        self.db.update_run(run_id, status="running", started_at=utc_now())
        faults = cfg.get("faults") or []
        timeout_s = min(cfg["timeout_s"], 1.5) if any(f["kind"] == "timeout" for f in faults) else cfg["timeout_s"]
        max_hops = cfg.get("max_hops") or self.s.max_hops
        tools, ctx_tools = None, ()
        tf = cfg.get("inject_tool_failure")
        if tf:
            tools = ToolRunner({"rag_retrieve": lambda puzzle: self.rag_retrieve()},
                               injector=FailureInjector({tf["tool"]: tf["times"]}), max_retries=1)
            ctx_tools = ("rag_retrieve",)
        sup = Supervisor(max_hops=max_hops, timeout_s=timeout_s, max_nodes=cfg["max_nodes"], strategy=cfg["strategy"],
                         solver=self._fault_solver(faults) if faults else None, tool_runner=tools, context_tools=ctx_tools)
        t0 = perf_counter()
        res = sup.solve_and_vote(run["board"], run_id=run_id)
        events = self._merge_multi_events(run_id, run["thread_id"], res, cfg, max_hops)
        self.db.insert_events(run_id, events)
        verified = bool(res["solution"] is not None and VerifierAgent().verify_final(res["solution"], run["board"]).ok)
        outcome = "solved" if verified else ("no_valid_vote" if res["failure"] and res["failure"]["code"] in
                                              ("NO_VALID_VOTE", "NO_UNIQUE_WINNER") else "failed")
        counters = {"solver_calls": res["solver_calls"], "hops": res["hops"], "max_hops": res["max_hops"],
                    "tool_calls": res["tool_calls"], "tool_failures": res["tool_failures"],
                    "nodes": sum(a["nodes"] for a in res["attempts"]),
                    "pruned": sum(a["counters"].get("pruned", 0) for a in res["attempts"]),
                    "backtracks": sum(a["counters"].get("backtracks", 0) for a in res["attempts"]),
                    "attempts": [{k: v for k, v in a.items() if k != "trace"} | {"valid": a.get("valid", False)}
                                 for a in res["attempts"]]}
        result = {"outcome": outcome, "verified": verified, "solution": res["solution"] if verified else None,
                  "failure": res["failure"], "counters": counters, "vote": res["vote"], "llm_calls": res["llm_calls"],
                  "tool_calls": res["tool_calls"], "elapsed_seconds": round(perf_counter() - t0, 6), "note": res["note"]}
        self.db.update_run(run_id, status="completed" if outcome == "solved" else "failed", finished_at=utc_now(),
                           result=result, progress=counters)

    @staticmethod
    def _merge_multi_events(run_id: str, thread_id: str, res: dict, cfg: dict | None = None, max_hops: int | None = None) -> list[dict]:
        """One ordered stream: supervisor events with each variant's real search events inserted after dispatch."""
        cfg = cfg or {}
        faults = cfg.get("faults") or []
        start = TraceEvent(event_id="x", run_id=run_id, thread_id=thread_id, sequence=0, event="search_started", agent="Supervisor",
                           reason_code="SUPERVISED_RUN",
                           reason=("supervised run of candidate-order variants" +
                                   (f"; CONTROLLED DEMO FAULTS injected: {', '.join(f['variant'] + '=' + f['kind'] for f in faults)}" if faults else "") +
                                   (f"; injected tool failure: {cfg['inject_tool_failure']['tool']} x{cfg['inject_tool_failure']['times']}" if cfg.get("inject_tool_failure") else "")),
                           data={"max_hops": max_hops, "demo_faults": faults, "variants_are": "candidate-order variants, not independent agents"}).model_dump()
        merged: list[tuple[dict, dict]] = [(start, {})]
        terminal = None
        for e in res["events"]:
            if e["event"] in TERMINAL_EVENTS:
                terminal = e
                continue
            merged.append((e, {}))
            if e["event"] == "route" and e["data"].get("to") == "SolverVariants":
                for a in res["attempts"]:
                    for v in a.get("trace", []):
                        merged.append((v, {"variant": a["name"], "variant_sequence": v["sequence"]}))
        if terminal:
            merged.append((terminal, {}))
        out = []
        for i, (e, extra) in enumerate(merged):
            d = dict(e)
            d.update(sequence=i, event_id=f"{run_id}-event-{i:05d}", run_id=run_id, thread_id=thread_id)
            d["data"] = {**d.get("data", {}), **extra}
            out.append(TraceEvent(**d).model_dump())
        return out

    def _cot_worker(self, run_id: str, resume: bool) -> None:
        run = self.db.get_run(run_id)
        self.db.update_run(run_id, status="running", started_at=utc_now())
        runner = self.cot_runner
        if runner is None:
            from ta2.ta1_runner import run_cot as runner
        evs: list[dict] = []

        def emit(event: str, agent: str, **kw) -> None:
            evs.append(TraceEvent(event_id=f"{run_id}-event-{len(evs):05d}", run_id=run_id, thread_id=run["thread_id"],
                                  sequence=len(evs), event=event, agent=agent, **kw).model_dump())

        emit("search_started", "Supervisor", board_snapshot=run["board"], reason_code="COT", reason="single-path chain-of-thought attempt (frozen TA1 prompt)")
        emit("tool_call", "LLM-CoT", reason_code="LLM_CALL", reason="one local qwen2.5:3b call", data={"tool": "qwen2.5:3b", "llm_calls": 1})
        t0 = perf_counter()
        try:
            out = runner(run["board"])
        except Exception as e:
            out = {"error": type(e).__name__, "parsed_grid": None, "correct": False, "raw_output": ""}
        seconds = perf_counter() - t0
        grid, err = out.get("parsed_grid"), out.get("error")
        verified, failure = False, None
        if err:
            failure = {"code": "OLLAMA_UNAVAILABLE", "reason": "The local model call failed; check that Ollama is running."}
            emit("tool_failure", "LLM-CoT", reason_code="OLLAMA_UNAVAILABLE", reason=failure["reason"])
            emit("search_failed", "Supervisor", reason_code=failure["code"], reason=failure["reason"])
        elif grid is None:
            failure = {"code": "COT_UNPARSEABLE", "reason": "The model's answer did not contain a final 4x4 grid."}
            emit("search_failed", "Supervisor", reason_code=failure["code"], reason=failure["reason"])
        else:
            emit("solution_found", "LLM-CoT", board_snapshot=grid, reason_code="COT_ANSWER", reason="the model claims this grid is the solution")
            v = VerifierAgent().verify_final(grid, run["board"])
            if v.ok:
                verified = True
                emit("solution_verified", "Verifier", board_snapshot=grid, reason_code=v.code, reason=v.reason)
                emit("search_completed", "Supervisor", reason_code="SOLVED", reason="CoT answer passed deterministic verification")
            else:
                conflicts = R.find_conflicts(grid)
                failure = {"code": "COT_INCORRECT", "reason": f"The CoT answer is not a valid solution: {v.reason}"}
                emit("rule_violation", "Verifier", board_snapshot=grid, reason_code=v.code, reason=v.reason,
                     data={"conflicts": conflicts[:8]})
                emit("search_failed", "Supervisor", reason_code=failure["code"], reason=failure["reason"])
        self.db.insert_events(run_id, evs)
        counters = {"llm_calls": 1, "seconds": round(seconds, 3)}
        outcome = "solved" if verified else ("incorrect" if failure["code"] == "COT_INCORRECT" else "failed")
        raw = (out.get("raw_output") or "")[:4000]
        self.db.update_run(run_id, status="completed" if verified else "failed", finished_at=utc_now(), progress=counters,
                           result={"outcome": outcome, "verified": verified, "solution": grid if verified else None, "failure": failure,
                                   "counters": counters, "llm_calls": 1, "tool_calls": 0, "elapsed_seconds": round(seconds, 6),
                                   "note": "CoT output is not a correctness proof; only the deterministic verifier decides. " +
                                           ("Raw model output (truncated): " + raw if raw else "")})

    # ------------------------------------------------------------------ views
    def view(self, run: dict) -> dict:
        live = self.is_live(run["run_id"])
        return {**{k: run[k] for k in ("run_id", "thread_id", "session_id", "puzzle_id", "mode", "status", "board", "config",
                                       "created_at", "started_at", "finished_at", "result")},
                "progress": run.get("progress") or {}, "last_sequence": self.db.last_sequence(run["run_id"]), "live": live,
                "resumable": self.resumable(run), "deterministic_components": DETERMINISTIC[run["mode"]],
                "llm_components": LLM[run["mode"]]}
