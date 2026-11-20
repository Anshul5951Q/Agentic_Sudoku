"""Solve runs, traces, WebSocket, pause/resume/cancel, duplicates, recovery (spec 12.5)."""
import threading
import time

import pytest
from fastapi.testclient import TestClient
from ta2 import sudoku_rules as R
from ta2.checkpointer import build_graph, open_saver, resume_search, start_search
from .conftest import (SAMPLE, SOLUTION, bad_cot, down_cot, make_settings, start, strip, wait_for)
from .test_puzzles_api import assert_envelope

SLOW = dict(step_delay=0.05, chunk_steps=2)
TOT = dict(strategy="first_empty", order="desc")


def reference_events():
    from ta2.search import SearchEngine
    e = SearchEngine()
    return e.run(e.init_state(SAMPLE, strategy="first_empty", order="desc"))["events"]


# ------------------------------------------------------------------ valid runs
def test_tot_run_completes_with_verified_solution_and_real_trace(client):
    run = start(client, "tot", **TOT)
    assert run["run_id"].startswith("run-") and run["thread_id"].startswith("thread-") and run["mode"] == "tot"
    assert run["llm_components"] == [] and "rule checking" in " ".join(run["deterministic_components"])
    done = wait_for(client, run["run_id"])
    assert done["status"] == "completed" and done["live"] is False
    res = done["result"]
    assert res["outcome"] == "solved" and res["verified"] is True and res["solution"] == SOLUTION
    assert R.is_complete_valid(res["solution"], SAMPLE) and res["counters"]["backtracks"] == 2 and res["counters"]["dead_ends"] == 2
    tr = client.get(f"/api/solve/{run['run_id']}/trace").json()
    assert tr["terminal"] and tr["recorded"] and not tr["live"] and tr["last_sequence"] == len(tr["events"]) - 1
    assert [e["sequence"] for e in tr["events"]] == list(range(len(tr["events"])))
    assert strip(tr["events"]) == strip(reference_events())          # the API trace IS the engine trace
    assert tr["events"][-1]["event"] == "search_completed" and len(tr["nodes"]) == res["counters"]["nodes"]
    assert {n["status"] for n in tr["nodes"]} >= {"solution", "dead_end"}
    assert all(e["run_id"] == run["run_id"] for e in tr["events"])


def test_unsolvable_puzzle_ends_exhausted_not_solved(client):
    run = start(client, "tot", board=[[0, 3, 0, 0], [0, 0, 2, 0], [2, 0, 4, 0], [0, 0, 0, 0]], strategy="first_empty")
    done = wait_for(client, run["run_id"])
    assert done["result"]["outcome"] == "exhausted" and done["result"]["verified"] is False and done["result"]["solution"] is None


def test_node_budget_is_a_failed_run_with_code(client):
    done = wait_for(client, start(client, "tot", **TOT, max_nodes=3)["run_id"])
    assert done["status"] == "failed" and done["result"]["failure"]["code"] == "MAX_NODES" and done["result"]["outcome"] == "limit_reached"


def test_multi_agent_run_votes_only_verified_and_labels_variants(client):
    run = start(client, "multi-agent", **TOT)
    done = wait_for(client, run["run_id"])
    res = done["result"]
    assert res["outcome"] == "solved" and res["verified"] and res["vote"]["vote_type"] == "candidate_order_variants"
    assert sum(res["vote"]["votes"].values()) == 3 and res["counters"]["solver_calls"] == 3
    assert "not independent" in res["note"] and res["llm_calls"] == 0
    tr = client.get(f"/api/solve/{run['run_id']}/trace").json()
    assert [e["sequence"] for e in tr["events"]] == list(range(len(tr["events"])))
    variants = {e["data"].get("variant") for e in tr["events"] if e["data"].get("variant")}
    assert variants == {"variant-asc", "variant-desc", "variant-middle"}
    assert any(e["event"] == "route" for e in tr["events"]) and tr["events"][-1]["event"] == "search_completed"


def test_cot_run_correct_answer_is_verified_deterministically(make_client):
    c = make_client()
    done = wait_for(c, start(c, "cot")["run_id"])
    assert done["status"] == "completed" and done["result"]["verified"] and done["result"]["llm_calls"] == 1
    assert done["llm_components"] and "never trusted" in done["deterministic_components"][0]


def test_cot_run_wrong_answer_is_reported_incorrect_not_hidden(make_client):
    c = make_client(cot_runner=bad_cot)
    run = start(c, "cot")
    done = wait_for(c, run["run_id"])
    assert done["status"] == "failed" and done["result"]["outcome"] == "incorrect" and done["result"]["solution"] is None
    assert done["result"]["failure"]["code"] == "COT_INCORRECT" and "not a correctness proof" in done["result"]["note"]
    ev = c.get(f"/api/solve/{run['run_id']}/trace").json()["events"]
    viol = [e for e in ev if e["event"] == "rule_violation"][0]
    assert viol["data"]["conflicts"] and ev[-1]["event"] == "search_failed"


def test_cot_with_ollama_down_fails_cleanly_without_leaking(make_client):
    c = make_client(cot_runner=down_cot)
    run = start(c, "cot")
    done = wait_for(c, run["run_id"])
    assert done["status"] == "failed" and done["result"]["failure"]["code"] == "OLLAMA_UNAVAILABLE"
    assert "secret" not in str(c.get(f"/api/solve/{run['run_id']}/trace").json()) and "secret" not in str(done)


def test_run_on_saved_puzzle_shares_the_session(client):
    p = client.post("/api/puzzles", json={"board": SAMPLE}).json()
    r1 = client.post("/api/solve/tot", json={"puzzle_id": p["puzzle_id"]}).json()
    r2 = client.post("/api/solve/multi-agent", json={"puzzle_id": p["puzzle_id"]}).json()
    assert r1["session_id"] == r2["session_id"] == p["session_id"] and r1["board"] == r2["board"] == SAMPLE
    wait_for(client, r1["run_id"]); wait_for(client, r2["run_id"])
    detail = client.get(f"/api/history/{p['session_id']}").json()
    assert {r["mode"] for r in detail["runs"]} == {"tot", "multi-agent"}


# ------------------------------------------------------------------ unknown ids / state errors
def test_unknown_run_id_everywhere(client):
    for method, path in (("get", "/api/solve/run-nope"), ("get", "/api/solve/run-nope/trace"), ("post", "/api/solve/run-nope/pause"),
                         ("post", "/api/solve/run-nope/resume"), ("post", "/api/solve/run-nope/cancel"),
                         ("get", "/api/agents/run-nope/status")):
        r = getattr(client, method)(path)
        assert r.status_code == 404, path
        assert_envelope(r.json(), "RUN_NOT_FOUND")
    assert_envelope(client.get("/api/solve/" + "z" * 100).json(), "INVALID_ID")


def test_invalid_state_transitions_have_error_codes(client):
    rid = start(client, "tot", **TOT)["run_id"]
    wait_for(client, rid)
    for action, code in (("pause", "INVALID_STATE"), ("resume", "INVALID_STATE"), ("cancel", "INVALID_STATE")):
        r = client.post(f"/api/solve/{rid}/{action}")
        assert r.status_code == 409 and r.json()["error"]["code"] == code
    mid = start(client, "multi-agent")["run_id"]
    wait_for(client, mid)
    assert client.post(f"/api/solve/{mid}/pause").json()["error"]["code"] == "PAUSE_NOT_SUPPORTED"


# ------------------------------------------------------------------ pause / resume / cancel
def test_pause_then_resume_continues_from_checkpoint(make_client):
    c = make_client(settings_kw=SLOW)
    rid = start(c, "tot", **TOT)["run_id"]
    for _ in range(200):
        if c.get(f"/api/solve/{rid}").json()["last_sequence"] >= 3:
            break
        time.sleep(0.02)
    p = c.post(f"/api/solve/{rid}/pause")
    assert p.status_code == 200 and p.json()["status"] == "paused" and p.json()["resumable"] is True
    mid = c.get(f"/api/solve/{rid}/trace").json()
    assert mid["events"][-1]["event"] == "search_paused" and not mid["terminal"] and not mid["live"] and not mid["recorded"]
    paused_len = len(mid["events"])
    assert 0 < paused_len < len(reference_events())                      # genuinely mid-search
    time.sleep(0.3)
    assert len(c.get(f"/api/solve/{rid}/trace").json()["events"]) == paused_len   # nothing runs while paused
    assert c.post(f"/api/solve/{rid}/pause").json()["status"] == "paused"          # duplicate pause is idempotent
    r = c.post(f"/api/solve/{rid}/resume")
    assert r.status_code == 200 and r.json()["status"] in ("running", "completed")
    done = wait_for(c, rid)
    assert done["status"] == "completed" and done["result"]["solution"] == SOLUTION
    ev = c.get(f"/api/solve/{rid}/trace").json()["events"]
    names = [e["event"] for e in ev]
    assert names.count("search_started") == 1 and names.count("search_paused") == 1 and names.count("search_resumed") == 1
    assert [e["sequence"] for e in ev] == list(range(len(ev)))
    assert strip(ev) == strip(reference_events())                      # same decisions as an uninterrupted run


def test_duplicate_resume_does_not_start_a_second_worker(make_client):
    c = make_client(settings_kw=SLOW)
    rid = start(c, "tot", **TOT)["run_id"]
    time.sleep(0.15)
    c.post(f"/api/solve/{rid}/pause")
    r1, r2 = c.post(f"/api/solve/{rid}/resume"), c.post(f"/api/solve/{rid}/resume")
    assert r1.status_code == 200 and r2.status_code == 200
    wait_for(c, rid)
    ev = c.get(f"/api/solve/{rid}/trace").json()["events"]
    assert [e["event"] for e in ev].count("search_resumed") == 1 and [e["sequence"] for e in ev] == list(range(len(ev)))


def test_cancel_running_run(make_client):
    c = make_client(settings_kw=SLOW)
    rid = start(c, "tot", **TOT)["run_id"]
    time.sleep(0.2)
    r = c.post(f"/api/solve/{rid}/cancel")
    assert r.status_code == 200 and r.json()["status"] == "cancelled" and r.json()["result"]["outcome"] == "cancelled"
    tr = c.get(f"/api/solve/{rid}/trace").json()
    assert tr["events"][-1]["event"] == "search_cancelled" and tr["terminal"]
    assert sum(e["event"] in ("search_cancelled", "search_completed", "search_failed") for e in tr["events"]) == 1
    assert c.post(f"/api/solve/{rid}/cancel").json()["status"] == "cancelled"        # duplicate cancel
    assert c.post(f"/api/solve/{rid}/resume").status_code == 409                        # cancelled never restarts


def test_cancel_a_paused_run(make_client):
    c = make_client(settings_kw=SLOW)
    rid = start(c, "tot", **TOT)["run_id"]
    time.sleep(0.15)
    c.post(f"/api/solve/{rid}/pause")
    r = c.post(f"/api/solve/{rid}/cancel")
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert c.get(f"/api/solve/{rid}/trace").json()["events"][-1]["event"] == "search_cancelled"


def test_solver_timeout_fails_run_with_explicit_terminal_event(make_client):
    c = make_client(settings_kw=dict(step_delay=0.1, chunk_steps=1))
    rid = start(c, "tot", **TOT, timeout_s=0.3)["run_id"]
    done = wait_for(c, rid)
    assert done["status"] == "failed" and done["result"]["failure"]["code"] == "TIMEOUT"
    ev = c.get(f"/api/solve/{rid}/trace").json()["events"]
    assert ev[-1]["event"] == "search_failed" and ev[-1]["reason_code"] == "TIMEOUT"


# ------------------------------------------------------------------ duplicates (idempotency)
def test_idempotency_key_returns_same_run(client):
    h = {"Idempotency-Key": "demo-key-1"}
    a = client.post("/api/solve/tot", json={"board": SAMPLE, **TOT}, headers=h)
    b = client.post("/api/solve/tot", json={"board": SAMPLE, **TOT}, headers=h)
    assert a.status_code == 202 and b.status_code == 200
    assert a.json()["run_id"] == b.json()["run_id"] and b.json()["duplicate"] is True and a.json()["duplicate"] is False
    wait_for(client, a.json()["run_id"])
    assert client.get("/api/analytics/summary").json()["runs_total"] == 1       # the duplicate did not create a 2nd run


def test_idempotency_key_with_different_body_conflicts(client):
    h = {"Idempotency-Key": "k-2"}
    client.post("/api/solve/tot", json={"board": SAMPLE}, headers=h)
    r = client.post("/api/solve/tot", json={"board": SAMPLE, "order": "desc"}, headers=h)
    assert r.status_code == 409 and r.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    assert client.post("/api/solve/tot", json={"board": SAMPLE}, headers={"Idempotency-Key": "bad key!"}).status_code == 422


def test_requests_without_key_create_separate_runs(client):
    a, b = start(client, "tot"), start(client, "tot")
    assert a["run_id"] != b["run_id"] and a["thread_id"] != b["thread_id"]
    wait_for(client, a["run_id"]); wait_for(client, b["run_id"])


# ------------------------------------------------------------------ trace / history / export / analytics / agents
def test_trace_after_parameter_and_export(client):
    rid = start(client, "tot", **TOT)["run_id"]
    wait_for(client, rid)
    full = client.get(f"/api/solve/{rid}/trace").json()
    part = client.get(f"/api/solve/{rid}/trace?after=9").json()
    assert [e["sequence"] for e in part["events"]] == list(range(10, len(full["events"])))
    assert client.get(f"/api/solve/{rid}/trace?after=99999").json()["events"] == []
    assert client.get(f"/api/solve/{rid}/trace?after=-2").status_code == 422
    dl = client.get(f"/api/solve/{rid}/trace?download=true")
    assert dl.headers["content-disposition"] == f'attachment; filename="{rid}-trace.json"' and dl.json()["run_id"] == rid


def test_history_list_detail_and_pagination(client):
    ids = []
    for mode in ("tot", "multi-agent"):
        r = start(client, mode, **TOT)
        wait_for(client, r["run_id"])
        ids.append(r["session_id"])
    h = client.get("/api/history").json()
    assert h["total"] == 2 and {s["session_id"] for s in h["sessions"]} == set(ids)
    s0 = h["sessions"][0]
    assert s0["runs_count"] == 1 and s0["last_run"]["verified"] is True and s0["board"] == SAMPLE and s0["last_run"]["nodes"]
    assert client.get("/api/history?limit=1").json()["sessions"].__len__() == 1
    assert client.get("/api/history?limit=0").status_code == 422
    d = client.get(f"/api/history/{ids[0]}").json()
    assert d["puzzle"]["board"] == SAMPLE and len(d["runs"]) == 1
    assert_envelope(client.get("/api/history/session-nope").json(), "SESSION_NOT_FOUND")


def test_analytics_are_computed_from_stored_runs(client):
    empty = client.get("/api/analytics/summary").json()
    assert empty["runs_total"] == 0 and empty["average_solve_seconds"] is None and empty["puzzles_solved"] == 0
    wait_for(client, start(client, "tot", **TOT)["run_id"])
    wait_for(client, start(client, "multi-agent", **TOT)["run_id"])
    s = client.get("/api/analytics/summary").json()
    assert s["runs_total"] == 2 and s["verified_runs"] == 2 and s["puzzles_solved"] == 2 and s["sessions_saved"] == 2
    assert s["average_solve_seconds"] > 0 and s["search_nodes_explored"] >= 11 and s["dead_end_branches"] == 2
    assert s["runs_by_mode"] == {"tot": 1, "multi-agent": 1} and "nothing is hardcoded" in s["source"]


def test_agent_status_is_derived_from_the_trace(client):
    rid = start(client, "multi-agent", **TOT)["run_id"]
    wait_for(client, rid)
    a = client.get(f"/api/agents/{rid}/status").json()
    by = {x["agent"]: x for x in a["agents"]}
    assert {"Proposer", "RuleChecker", "Verifier", "Backtracker", "Supervisor"} <= set(by)
    assert all(by[n]["status"] == "completed" for n in ("Proposer", "RuleChecker", "Verifier", "Supervisor"))
    assert by["Supervisor"]["latest_message"]["event"] == "search_completed" and by["Proposer"]["event_count"] > 0
    assert a["routing_trace"] and [h["hop"] for h in a["routing_trace"]] == sorted(h["hop"] for h in a["routing_trace"])
    assert "not independent" in a["note"]
    fail = start(client, "tot", **TOT, max_nodes=3)["run_id"]
    wait_for(client, fail)
    assert {x["agent"]: x for x in client.get(f"/api/agents/{fail}/status").json()["agents"]}["Supervisor"]["status"] == "failed"


# ------------------------------------------------------------------ restart / recovery
def test_paused_run_survives_backend_restart_and_resumes(make_client, tmp_path):
    c1 = make_client(settings_kw=SLOW)
    rid = start(c1, "tot", **TOT)["run_id"]
    time.sleep(0.2)
    c1.post(f"/api/solve/{rid}/pause")
    paused_len = len(c1.get(f"/api/solve/{rid}/trace").json()["events"])
    c1.close()
    c2 = TestClient(__import__("backend.app.main", fromlist=["create_app"]).create_app(make_settings(tmp_path, **SLOW),
                    rag_answer=None or (lambda q, k: {}), cot_runner=None), raise_server_exceptions=False)
    r = c2.get(f"/api/solve/{rid}").json()
    assert r["status"] == "paused" and r["resumable"] and r["live"] is False
    assert len(c2.get(f"/api/solve/{rid}/trace").json()["events"]) == paused_len
    assert c2.post(f"/api/solve/{rid}/resume").status_code == 200
    done = wait_for(c2, rid)
    assert done["result"]["solution"] == SOLUTION
    ev = c2.get(f"/api/solve/{rid}/trace").json()["events"]
    assert strip(ev) == strip(reference_events()) and [e["sequence"] for e in ev] == list(range(len(ev)))


def test_orphaned_running_run_is_marked_interrupted_and_is_resumable(make_client, tmp_path):
    from backend.app.main import create_app
    # Build a checkpointed run state directly, then pretend the server died while it was "running".
    c1 = make_client()
    rid = start(c1, "tot", **TOT)["run_id"]
    wait_for(c1, rid)
    row = c1.app.state.ctx.db.get_run(rid)
    with open_saver(tmp_path / "cp.sqlite3") as saver:                  # a mid-search checkpoint for a fresh thread
        start_search(build_graph(saver), SAMPLE, row["thread_id"] + "-x", "first_empty", "desc", max_steps=6, silent=True)
    db = c1.app.state.ctx.db
    db.update_run(rid, status="running", thread_id=row["thread_id"] + "-x", finished_at=None, result=None)
    c2 = TestClient(create_app(make_settings(tmp_path), rag_answer=lambda q, k: {}), raise_server_exceptions=False)
    r = c2.get(f"/api/solve/{rid}").json()
    assert r["status"] == "interrupted" and r["resumable"] is True and r["live"] is False
    assert c2.post(f"/api/solve/{rid}/resume").status_code == 200
    assert wait_for(c2, rid)["status"] == "completed"


def test_missing_checkpoint_resume_is_a_recoverable_error(client):
    rid = start(client, "tot", **TOT)["run_id"]
    wait_for(client, rid)
    ctx = client.app.state.ctx
    ctx.db.update_run(rid, status="interrupted", thread_id="thread-missing")
    r = client.post(f"/api/solve/{rid}/resume")
    assert r.status_code == 409 and r.json()["error"]["code"] == "CHECKPOINT_UNAVAILABLE" and r.json()["error"]["recoverable"]
    assert client.get(f"/api/solve/{rid}").json()["resumable"] is False


# ------------------------------------------------------------------ websocket
def read_until_terminal(ws, limit=2000):
    msgs = []
    for _ in range(limit):
        m = ws.receive_json()
        msgs.append(m)
        if m["type"] in ("terminal", "error"):
            return msgs
    raise AssertionError("no terminal message")


def test_ws_streams_persisted_events_in_order_then_terminal(client):
    rid = start(client, "tot", **TOT)["run_id"]
    with client.websocket_connect(f"/ws/solve/{rid}") as ws:
        msgs = read_until_terminal(ws)
    ev = [m["event"] for m in msgs if m["type"] == "event"]
    assert [e["sequence"] for e in ev] == list(range(len(ev)))
    term = msgs[-1]
    assert term["type"] == "terminal" and term["status"] == "completed" and term["outcome"] == "solved" and term["verified"]
    assert term["last_sequence"] == ev[-1]["sequence"] and ev[-1]["event"] == "search_completed"
    assert [m["status"] for m in msgs if m["type"] == "status"][-1] == "completed"
    assert ev == client.get(f"/api/solve/{rid}/trace").json()["events"]          # WS == persisted trace


def test_ws_reconnect_fetches_only_missed_events_without_duplicates(make_client):
    c = make_client(settings_kw=SLOW)
    rid = start(c, "tot", **TOT)["run_id"]
    first = []
    with c.websocket_connect(f"/ws/solve/{rid}") as ws:                   # client drops after a few events
        while len([m for m in first if m["type"] == "event"]) < 5:
            first.append(ws.receive_json())
    seen = [m["event"] for m in first if m["type"] == "event"]
    last = seen[-1]["sequence"]
    time.sleep(0.2)                                                       # events keep being produced while disconnected
    with c.websocket_connect(f"/ws/solve/{rid}?after={last}") as ws:
        rest = read_until_terminal(ws)
    new = [m["event"] for m in rest if m["type"] == "event"]
    assert new and new[0]["sequence"] == last + 1                        # picks up exactly where it left off
    allev = seen + new
    assert [e["sequence"] for e in allev] == list(range(len(allev)))      # no gaps, no duplicates
    assert len({e["event_id"] for e in allev}) == len(allev)
    assert strip(allev) == strip(reference_events()) and rest[-1]["type"] == "terminal"


def test_ws_replay_of_a_finished_run_is_identical_and_not_duplicated(client):
    rid = start(client, "tot", **TOT)["run_id"]
    wait_for(client, rid)
    runs = []
    for _ in range(2):
        with client.websocket_connect(f"/ws/solve/{rid}?after=-1") as ws:
            runs.append([m["event"] for m in read_until_terminal(ws) if m["type"] == "event"])
    assert runs[0] == runs[1] and len({e["sequence"] for e in runs[0]}) == len(runs[0])
    with client.websocket_connect(f"/ws/solve/{rid}?after={runs[0][-1]['sequence']}") as ws:   # nothing missed -> only terminal
        m = read_until_terminal(ws)
    assert [x["type"] for x in m if x["type"] == "event"] == [] and m[-1]["type"] == "terminal"


def test_ws_terminal_event_for_failure_and_cancel(make_client):
    c = make_client(settings_kw=SLOW)
    f = start(c, "tot", **TOT, max_nodes=3)["run_id"]
    with c.websocket_connect(f"/ws/solve/{f}") as ws:
        m = read_until_terminal(ws)
    assert m[-1]["type"] == "terminal" and m[-1]["status"] == "failed" and m[-1]["outcome"] == "limit_reached"
    k = start(c, "tot", **TOT)["run_id"]
    time.sleep(0.2)
    c.post(f"/api/solve/{k}/cancel")
    with c.websocket_connect(f"/ws/solve/{k}") as ws:
        m = read_until_terminal(ws)
    assert m[-1]["status"] == "cancelled" and [x for x in m if x["type"] == "event"][-1]["event"]["event"] == "search_cancelled"


def test_ws_unknown_run_gets_error_message_and_close(client):
    with client.websocket_connect("/ws/solve/run-nope") as ws:
        m = ws.receive_json()
        assert m["type"] == "error" and m["error"]["code"] == "RUN_NOT_FOUND"
    with client.websocket_connect("/ws/solve/bad%20id") as ws:
        assert ws.receive_json()["type"] == "error"


def test_ws_shows_pause_as_status_and_keeps_stream_open(make_client):
    c = make_client(settings_kw=SLOW)
    rid = start(c, "tot", **TOT)["run_id"]
    with c.websocket_connect(f"/ws/solve/{rid}") as ws:
        got = []
        while len([m for m in got if m["type"] == "event"]) < 3:
            got.append(ws.receive_json())
        threading.Thread(target=lambda: c.post(f"/api/solve/{rid}/pause"), daemon=True).start()
        for _ in range(500):
            m = ws.receive_json()
            got.append(m)
            if m["type"] == "status" and m["status"] == "paused":
                break
        else:
            raise AssertionError("never saw paused status")
        assert not any(m["type"] == "terminal" for m in got)
    c.post(f"/api/solve/{rid}/cancel")


def test_checkpoint_summary_endpoint(make_client):
    c = make_client(settings_kw=SLOW)
    rid = start(c, "tot", **TOT)["run_id"]
    time.sleep(0.2)
    c.post(f"/api/solve/{rid}/pause")
    cp = c.get(f"/api/solve/{rid}/checkpoint").json()
    assert cp["thread_id"].startswith("thread-") and cp["status"] == "running" and cp["resumable"] is True
    assert cp["search_steps"] > 0 and cp["events"] > 0 and cp["depth"] >= 0
    c.post(f"/api/solve/{rid}/cancel")
    assert c.get(f"/api/solve/{rid}/checkpoint").json()["resumable"] is False
    mid = start(c, "multi-agent")["run_id"]
    assert "only tree-of-thought" in c.get(f"/api/solve/{mid}/checkpoint").json()["detail"]
    assert c.get("/api/solve/run-nope/checkpoint").status_code == 404
