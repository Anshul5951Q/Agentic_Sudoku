"""Background five-case TA1-vs-TA2 evaluation job. Wraps ta2.evaluation; every number is measured by that run."""
from __future__ import annotations

import logging
import threading
from typing import Callable

from ..core.errors import APIError, not_found
from ..core.ids import new_id
from ..schemas import EvaluationMetrics

log = logging.getLogger("sudokumind.evaluation")
SYSTEM_KEYS = ("ta1_tot", "ta1_cot", "ta2_single_mrv", "ta2_single_first_empty_desc", "ta2_multi_agent_mrv",
               "ta2_multi_agent_sequential", "ta2_multi_agent_first_empty", "ta2_multi_agent_with_rag")
# Which stored trace backs each (case, system) cell, so every metric in the app links to recorded run data.
TRACE_FOR = {"ta1_tot": "case{n}_ta1_tot_search_tree", "ta1_cot": "case{n}_ta1_cot_raw_output",
             "ta2_single_mrv": "case{n}_ta2_single_mrv_trace", "ta2_single_first_empty_desc": "case{n}_ta2_single_first_empty_desc_trace",
             "ta2_multi_agent_mrv": "case{n}_ta2_multi_agent", "ta2_multi_agent_sequential": "case{n}_ta2_multi_agent_sequential"}
METRIC_FIELDS = set(EvaluationMetrics.model_fields)


def default_runner(options: dict) -> dict:
    from ta2.evaluation import run_evaluation
    return run_evaluation(with_cot=options["with_cot"], with_rag=options["with_rag"])


def convert(raw: dict) -> dict:
    trace_keys = set((raw.get("traces") or {}).keys())
    cases = []
    for row in raw["cases"]:
        systems = {}
        for k in SYSTEM_KEYS:
            if k not in row:
                continue
            m = {f: v for f, v in row[k].items() if f in METRIC_FIELDS}
            key = TRACE_FOR.get(k, "").format(n=row["case"])
            m["trace_key"] = key if key in trace_keys else None
            systems[k] = m
        cases.append({"case": row["case"], "name": row["name"], "puzzle": row["puzzle"], "empties": row["empties"],
                      "solution_count": row["solution_count"], "systems": systems})
    return {"cases": cases, "memory_comparison": raw.get("memory_comparison", []), "notes": raw.get("notes", []),
            "timing": raw.get("timing"), "challenge": raw.get("challenge"), "rag_comparison": raw.get("rag_comparison", []),
            "rag_available": raw.get("rag_available")}


class EvaluationService:
    def __init__(self, db, runner: Callable[[dict], dict] | None = None):
        self.db, self.runner = db, runner or default_runner
        self.lock = threading.Lock()
        self.current: str | None = None

    def start(self, options: dict) -> dict:
        with self.lock:
            if self.current:
                raise APIError(409, "EVALUATION_IN_PROGRESS", "An evaluation is already running.", retryable=True,
                               details={"evaluation_id": self.current})
            eid = new_id("eval")
            self.db.create_evaluation(eid, options)
            self.current = eid
        threading.Thread(target=self._work, args=(eid, options), daemon=True, name=f"eval-{eid}").start()
        return self.view(self.db.get_evaluation(eid))

    def _work(self, eid: str, options: dict) -> None:
        try:
            raw = self.runner(options)
            self.db.save_evaluation_traces(eid, raw.get("traces") or {})
            self.db.finish_evaluation(eid, "completed", convert(raw))
        except Exception as e:
            log.exception("evaluation %s failed", eid)
            self.db.finish_evaluation(eid, "failed", error=f"{type(e).__name__}: evaluation failed (see server log)")
        finally:
            with self.lock:
                self.current = None

    def get(self, eid: str) -> dict:
        row = self.db.get_evaluation(eid)
        if not row:
            raise not_found("evaluation", eid)
        return self.view(row)

    def view(self, row: dict) -> dict:
        res = row.get("result") or {}
        return {"evaluation_id": row["evaluation_id"], "status": row["status"], "created_at": row["created_at"],
                "finished_at": row["finished_at"], "options": row.get("options") or {}, "cases": res.get("cases", []),
                "memory_comparison": res.get("memory_comparison", []), "notes": res.get("notes", []),
                "timing": res.get("timing"), "challenge": res.get("challenge"), "rag_comparison": res.get("rag_comparison", []),
                "rag_available": res.get("rag_available"), "trace_keys": self.db.evaluation_trace_keys(row["evaluation_id"]),
                "error": row.get("error")}

    def trace(self, eid: str, key: str):
        if not self.db.get_evaluation(eid):
            raise not_found("evaluation", eid)
        t = self.db.get_evaluation_trace(eid, key)
        if t is None:
            raise not_found("evaluation_trace", key)
        return t
