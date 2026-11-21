"""Record real backend responses for the Android Jest tests (history, compare, analytics, evaluation).

Runs the real FastAPI app in-process on temporary databases with the real deterministic engine and the real
five-case evaluation (no LLM, no RAG, so it is reproducible offline). Nothing is hand-written:

    python scripts/record_app_fixtures.py
"""
from __future__ import annotations

import json
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend.app.core.config import Settings  # noqa: E402
from backend.app.main import create_app  # noqa: E402

SAMPLE = [[0, 0, 3, 4], [3, 4, 0, 0], [0, 1, 4, 0], [4, 0, 0, 1]]
OUT = ROOT / "android" / "tests" / "recorded"


def wait(c, path, done):
    end = time.time() + 120
    while time.time() < end:
        r = c.get(path).json()
        if done(r):
            return r
        time.sleep(0.05)
    raise SystemExit(f"timeout waiting for {path}")


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        s = Settings(db_path=t / "api.sqlite3", checkpoint_db=t / "cp.sqlite3", memory_db=t / "mem.sqlite3", chroma_dir=t / "chroma")
        c = TestClient(create_app(s, ollama_models=lambda h: set()))
        puzzle = c.post("/api/puzzles", json={"board": SAMPLE, "name": "assignment sample", "source": "sample"}).json()
        runs = []
        for mode, body in (("tot", {"strategy": "first_empty", "order": "desc"}), ("multi-agent", {}),
                           ("tot", {"strategy": "first_empty", "order": "desc", "use_memory": True}),
                           ("multi-agent", {"faults": [{"variant": "desc", "kind": "invalid_board"}]})):
            rid = c.post(f"/api/solve/{mode}", json={"puzzle_id": puzzle["puzzle_id"], **body}).json()["run_id"]
            runs.append(wait(c, f"/api/solve/{rid}", lambda r: r["status"] in ("completed", "failed", "cancelled")))
        eid = c.post("/api/evaluation/run", json={"with_cot": False, "with_rag": False}).json()["evaluation_id"]
        ev = wait(c, f"/api/evaluation/{eid}", lambda r: r["status"] != "running")
        first_key = ev["cases"][0]["systems"]["ta2_multi_agent_mrv"]["trace_key"]
        fixtures = {
            "history-list": c.get("/api/history").json(),
            "history-session": c.get(f"/api/history/{puzzle['session_id']}").json(),
            "history-compare": c.get(f"/api/history/compare?a={runs[0]['run_id']}&b={runs[1]['run_id']}").json(),
            "analytics-comparisons": c.get("/api/analytics/comparisons").json(),
            "evaluation": ev,
            "evaluation-list": c.get("/api/evaluation").json(),
            "evaluation-trace": c.get(f"/api/evaluation/{eid}/traces/{first_key}").json(),
        }
        c.close()
    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in fixtures.items():
        payload = {"source": "recorded from the real backend by scripts/record_app_fixtures.py (do not edit)", "data": data}
        (OUT / f"{name}.json").write_text(json.dumps(payload, indent=1), encoding="utf-8")
        print("wrote", (OUT / f"{name}.json").relative_to(ROOT))


if __name__ == "__main__":
    main()
