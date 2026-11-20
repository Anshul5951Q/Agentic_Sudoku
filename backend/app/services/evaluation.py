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
               "ta2_multi_agent_first_empty", "ta2_multi_agent_with_rag")
METRIC_FIELDS = set(EvaluationMetrics.model_fields)


def default_runner(options: dict) -> dict:
    from ta2.evaluation import run_evaluation
    out = run_evaluation(with_cot=options["with_cot"], with_rag=options["with_rag"])
    out.pop("traces", None)
    return out


def convert(raw: dict) -> dict:
    cases = []
    for row in raw["cases"]:
        systems = {k: {f: v for f, v in row[k].items() if f in METRIC_FIELDS} for k in SYSTEM_KEYS if k in row}
        cases.append({"case": row["case"], "name": row["name"], "puzzle": row["puzzle"], "empties": row["empties"],
                      "solution_count": row["solution_count"], "systems": systems})
    return {"cases": cases, "memory_comparison": raw.get("memory_comparison", []), "notes": raw.get("notes", []),
            "timing": raw.get("timing")}


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
            self.db.finish_evaluation(eid, "completed", convert(self.runner(options)))
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

    @staticmethod
    def view(row: dict) -> dict:
        res = row.get("result") or {}
        return {"evaluation_id": row["evaluation_id"], "status": row["status"], "created_at": row["created_at"],
                "finished_at": row["finished_at"], "options": row.get("options") or {}, "cases": res.get("cases", []),
                "memory_comparison": res.get("memory_comparison", []), "notes": res.get("notes", []),
                "timing": res.get("timing"), "error": row.get("error")}
