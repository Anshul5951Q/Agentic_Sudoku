import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.core.config import Settings
from backend.app.main import create_app

SAMPLE = [[0, 0, 3, 4], [3, 4, 0, 0], [0, 1, 4, 0], [4, 0, 0, 1]]
SOLUTION = [[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]]
LEGAL_MOVE = json.dumps({"row": 0, "col": 1, "value": 2})


def make_settings(tmp: Path, **kw) -> Settings:
    base = dict(db_path=tmp / "api.sqlite3", checkpoint_db=tmp / "cp.sqlite3", memory_db=tmp / "mem.sqlite3", chroma_dir=tmp / "chroma")
    base.update(kw)
    return Settings(**base)


def fake_rag(query: str, k: int) -> dict:
    return {"query": query, "k": k, "answer": "Prune the branch and restore the previous board.", "abstained": False,
            "reason_code": "GROUNDED", "evidence": [{"chunk_id": "sudoku-chunk-2", "heading": "CHUNK 2: CANDIDATES", "text": "t",
                                                      "similarity": 0.7, "distance": 0.3}][:k],
            "retrieved_chunk_ids": ["sudoku-chunk-2"], "top_similarity": 0.7, "threshold": 0.53, "llm_calls": 1}


def good_cot(board):
    return {"parsed_grid": SOLUTION, "correct": True, "error": None, "raw_output": "1 2 3 4 ...", "seconds": 0.0}


def bad_cot(board):
    return {"parsed_grid": [[1, 2, 3, 4], [3, 4, 1, 2], [1, 2, 4, 3], [2, 3, 4, 1]], "correct": False, "error": None, "raw_output": "x"}


def down_cot(board):
    raise ConnectionError("connection refused C:\\secret\\path")


@pytest.fixture
def make_client(tmp_path):
    clients = []

    def _make(settings_kw=None, **kw) -> TestClient:
        kw.setdefault("rag_answer", fake_rag)
        kw.setdefault("cot_runner", good_cot)
        kw.setdefault("approval_llm", lambda p: LEGAL_MOVE)
        kw.setdefault("ollama_models", lambda host: {"qwen2.5:3b", "nomic-embed-text:latest"})
        app = create_app(make_settings(tmp_path, **(settings_kw or {})), **kw)
        c = TestClient(app, raise_server_exceptions=False)
        clients.append(c)
        return c

    yield _make
    for c in clients:
        c.close()


@pytest.fixture
def client(make_client):
    return make_client()


def wait_for(client: TestClient, run_id: str, statuses=("completed", "failed", "cancelled"), timeout: float = 20.0) -> dict:
    end = time.time() + timeout
    while time.time() < end:
        r = client.get(f"/api/solve/{run_id}").json()
        if r["status"] in statuses:
            return r
        time.sleep(0.02)
    raise AssertionError(f"run {run_id} did not reach {statuses}: {r['status']}")


def start(client: TestClient, mode: str, board=SAMPLE, **extra) -> dict:
    r = client.post(f"/api/solve/{mode}", json={"board": board, **extra})
    assert r.status_code in (200, 202), r.text
    return r.json()


def strip(events):
    return [(e["event"], e["cell"], e["candidate"], e["depth"], e["reason_code"])
            for e in events if e["event"] not in ("search_paused", "search_resumed")]
