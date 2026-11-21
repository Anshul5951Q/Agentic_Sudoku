"""Recovery / hardening tests (spec 11.3): checkpoint corruption, SQLite and Chroma errors, duplicate concurrent
pause/resume, backend restart mid-run. Every failure must be explicit; nothing may be reported as a verified success."""
import sqlite3
import threading
import time

from fastapi.testclient import TestClient

from backend.app.main import create_app
from ta2.checkpointer import build_graph, open_saver

from .conftest import SAMPLE, SOLUTION, fake_rag, good_cot, make_settings, start, wait_for

SLOW = dict(step_delay=0.05, chunk_steps=2)
TOT = dict(strategy="first_empty", order="desc")


def _paused_run(c) -> dict:
    rid = start(c, "tot", **TOT)["run_id"]
    time.sleep(0.15)
    assert c.post(f"/api/solve/{rid}/pause").json()["status"] == "paused"
    return c.get(f"/api/solve/{rid}").json()


def test_corrupted_checkpoint_state_fails_the_resumed_run_explicitly(make_client, tmp_path):
    c = make_client(settings_kw=SLOW)
    run = _paused_run(c)
    with open_saver(tmp_path / "cp.sqlite3") as saver:                     # tamper with the saved search state
        build_graph(saver).update_state({"configurable": {"thread_id": run["thread_id"]}}, {"board": [[9, 9, 9, 9]] * 4})
    assert c.post(f"/api/solve/{run['run_id']}/resume").status_code == 200
    done = wait_for(c, run["run_id"])
    assert done["status"] == "failed" and done["result"]["verified"] is False and done["result"]["solution"] is None
    assert done["result"]["failure"]["code"] == "CHECKPOINT_INVALID"
    ev = c.get(f"/api/solve/{run['run_id']}/trace").json()["events"]
    assert ev[-1]["event"] == "search_failed" and ev[-1]["reason_code"] == "CHECKPOINT_INVALID"


def test_unreadable_checkpoint_database_makes_resume_unavailable_not_a_fake_success(make_client, tmp_path):
    c = make_client(settings_kw=SLOW)
    run = _paused_run(c)
    c.close()
    for suffix in ("", "-wal", "-shm"):
        p = tmp_path / f"cp.sqlite3{suffix}"
        if p.exists():
            p.unlink()
    (tmp_path / "cp.sqlite3").write_bytes(b"this is not a sqlite database" * 64)
    c2 = TestClient(create_app(make_settings(tmp_path, **SLOW), rag_answer=fake_rag, cot_runner=good_cot,
                               ollama_models=lambda h: set()), raise_server_exceptions=False)
    r = c2.get(f"/api/solve/{run['run_id']}").json()
    assert r["status"] == "paused" and r["resumable"] is False
    res = c2.post(f"/api/solve/{run['run_id']}/resume")
    assert res.status_code == 409 and res.json()["error"]["code"] == "CHECKPOINT_UNAVAILABLE"
    assert c2.get(f"/api/solve/{run['run_id']}/checkpoint").json()["resumable"] is False
    c2.close()


def test_api_database_error_is_a_retryable_503_without_leaks(client, monkeypatch):
    ctx = client.app.state.ctx

    def locked(*a, **k):
        raise sqlite3.OperationalError("database is locked: C:\\private\\api.sqlite3")
    monkeypatch.setattr(ctx.db, "list_sessions", locked)
    r = client.get("/api/history")
    body = r.json()["error"]
    assert r.status_code == 503 and body["code"] == "DATABASE_UNAVAILABLE" and body["retryable"] is True
    assert "private" not in r.text and "locked" not in r.text


def test_broken_memory_database_fails_a_memory_run_cleanly(make_client, tmp_path):
    bad = tmp_path / "memdir"
    bad.mkdir()                                                            # a directory cannot be opened as SQLite
    c = make_client(settings_kw={"memory_db": bad})
    rid = start(c, "tot", use_memory=True, **TOT)["run_id"]
    done = wait_for(c, rid)
    assert done["status"] == "failed" and done["result"]["verified"] is False and done["result"]["outcome"] == "failed"
    assert c.get(f"/api/solve/{rid}/trace").json()["events"][-1]["event"] == "search_failed"


def test_chroma_unavailable_is_a_503_vector_store_error(make_client):
    def broken_store(q, k):
        raise RuntimeError("chromadb: no such table: collections (C:\\private\\chroma)")
    c = make_client(rag_answer=broken_store)
    r = c.post("/api/rag/query", json={"query": "What does backtracking restore?", "k": 3})
    assert r.status_code == 503 and r.json()["error"]["code"] == "VECTOR_STORE_UNAVAILABLE" and "private" not in r.text


def test_rag_context_tool_failure_in_a_multi_agent_run_degrades_without_wrong_answers(make_client):
    def broken():
        raise RuntimeError("chroma unavailable")
    c = make_client(rag_retrieve=broken)
    rid = start(c, "multi-agent", inject_tool_failure={"tool": "rag_retrieve", "times": 1})["run_id"]
    done = wait_for(c, rid)
    assert done["result"]["verified"] is True and done["result"]["solution"] == SOLUTION
    assert done["result"]["counters"]["tool_failures"] >= 2                  # injected + the real outage, both traced
    names = [e["event"] for e in c.get(f"/api/solve/{rid}/trace").json()["events"]]
    assert "tool_failure" in names


def test_concurrent_duplicate_pause_and_resume_requests_are_idempotent(make_client):
    c = make_client(settings_kw=SLOW)
    rid = start(c, "tot", **TOT)["run_id"]
    time.sleep(0.15)
    out: list = []
    ts = [threading.Thread(target=lambda: out.append(c.post(f"/api/solve/{rid}/pause"))) for _ in range(3)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert all(r.status_code == 200 and r.json()["status"] == "paused" for r in out)
    out.clear()
    ts = [threading.Thread(target=lambda: out.append(c.post(f"/api/solve/{rid}/resume"))) for _ in range(3)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert all(r.status_code == 200 for r in out)
    done = wait_for(c, rid)
    assert done["result"]["solution"] == SOLUTION
    ev = c.get(f"/api/solve/{rid}/trace").json()["events"]
    names = [e["event"] for e in ev]
    assert names.count("search_paused") == 1 and names.count("search_resumed") == 1
    assert [e["sequence"] for e in ev] == list(range(len(ev)))


def test_backend_restart_during_a_running_search_resumes_from_the_checkpoint(make_client, tmp_path):
    c1 = make_client(settings_kw=dict(step_delay=0.1, chunk_steps=2))
    rid = start(c1, "tot", **TOT)["run_id"]
    time.sleep(0.35)
    before = len(c1.get(f"/api/solve/{rid}/trace").json()["events"])
    # simulate a crash: a new app on the same files while the old worker is abandoned mid-run
    ctx1 = c1.app.state.ctx
    ctx1.runs.controls[rid].pause.set()                                    # stop the old worker at its next boundary
    deadline = time.time() + 5
    while ctx1.runs.is_live(rid) and time.time() < deadline:
        time.sleep(0.02)
    ctx1.db.update_run(rid, status="running")                              # the crash left it marked running
    c1.close()
    c2 = TestClient(create_app(make_settings(tmp_path), rag_answer=fake_rag, cot_runner=good_cot,
                               ollama_models=lambda h: set()), raise_server_exceptions=False)
    r = c2.get(f"/api/solve/{rid}").json()
    assert r["status"] == "interrupted" and r["live"] is False and r["resumable"] is True
    assert c2.post(f"/api/solve/{rid}/resume").status_code == 200
    done = wait_for(c2, rid)
    assert done["result"]["verified"] and done["result"]["solution"] == SOLUTION
    ev = c2.get(f"/api/solve/{rid}/trace").json()["events"]
    assert len(ev) > before and [e["event"] for e in ev].count("search_started") == 1     # continued, not restarted
    assert "search_resumed" in [e["event"] for e in ev]
    c2.close()


def test_ws_disconnect_mid_run_does_not_stop_the_run(make_client):
    c = make_client(settings_kw=SLOW)
    rid = start(c, "tot", **TOT)["run_id"]
    with c.websocket_connect(f"/ws/solve/{rid}") as ws:
        ws.receive_json()                                                  # client vanishes after one message
    done = wait_for(c, rid)
    assert done["status"] == "completed" and done["result"]["solution"] == SOLUTION
