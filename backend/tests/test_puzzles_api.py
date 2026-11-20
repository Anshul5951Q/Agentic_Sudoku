"""Puzzle endpoints: create/validate/count/generate, invalid payloads, error envelope."""
import pytest
from ta2 import sudoku_rules as R
from .conftest import SAMPLE, SOLUTION


def assert_envelope(body: dict, code: str | None = None):
    err = body["error"]
    assert set(err) == {"code", "message", "recoverable", "retryable", "details"}
    if code:
        assert err["code"] == code
    text = str(body)
    assert "Traceback" not in text and "C:\\" not in text and "/Users/" not in text


def test_health_and_runtime_status(client):
    assert client.get("/api/health").json()["status"] == "ok"
    rt = client.get("/api/runtime/status").json()
    assert rt["backend"]["status"] == "up" and rt["ollama"]["status"] == "up" and rt["ready_for_llm"] and rt["ready_for_rag"]
    assert {m["name"] for m in rt["models"]} == {"qwen2.5:3b", "nomic-embed-text"} and rt["database"]["status"] == "up"
    assert rt["vector_store"]["status"] in ("up", "not_initialized")


def test_runtime_status_when_ollama_is_down(make_client):
    c = make_client(ollama_models=lambda host: None)
    rt = c.get("/api/runtime/status").json()
    assert rt["ollama"]["status"] == "down" and not rt["ready_for_llm"] and not rt["ready_for_rag"]
    assert all(m["status"] == "down" for m in rt["models"])
    assert rt["backend"]["status"] == "up"                      # backend status is separate from Ollama status
    assert_envelope({"error": {"code": "x", "message": rt["ollama"]["detail"], "recoverable": True, "retryable": True, "details": {}}})


def test_runtime_status_when_model_missing(make_client):
    c = make_client(ollama_models=lambda host: {"qwen2.5:3b"})
    rt = c.get("/api/runtime/status").json()
    assert rt["ollama"]["status"] == "up" and rt["ready_for_llm"] and not rt["ready_for_rag"]
    assert "ollama pull nomic-embed-text" in [m for m in rt["models"] if m["name"] == "nomic-embed-text"][0]["detail"]


def test_create_and_get_puzzle(client):
    r = client.post("/api/puzzles", json={"board": SAMPLE, "name": "sample", "source": "sample"})
    assert r.status_code == 201
    p = r.json()
    assert p["puzzle_id"].startswith("puzzle-") and p["session_id"].startswith("session-")
    assert p["board"] == SAMPLE and p["unique"] is True and p["solution_count"] == 1 and p["solvable"] is True
    assert client.get(f"/api/puzzles/{p['puzzle_id']}").json()["board"] == SAMPLE


def test_validate_endpoint(client):
    ok = client.post("/api/puzzles/validate", json={"board": SAMPLE}).json()
    assert ok["valid"] and not ok["complete"] and not ok["solved"] and ok["empties"] == 8 and ok["conflicts"] == []
    done = client.post("/api/puzzles/validate", json={"board": SOLUTION}).json()
    assert done["valid"] and done["complete"] and done["solved"]
    bad = client.post("/api/puzzles/validate", json={"board": [[1, 1, 0, 0]] + [[0] * 4] * 3}).json()
    assert not bad["valid"] and not bad["solved"] and "row" in {c["kind"] for c in bad["conflicts"]}
    full_bad = [r[:] for r in SOLUTION]
    full_bad[0][0], full_bad[0][1] = full_bad[0][1], full_bad[0][0]
    fb = client.post("/api/puzzles/validate", json={"board": full_bad}).json()
    assert fb["complete"] and not fb["solved"]                 # a complete but wrong grid is never "solved"


def test_count_solutions_none_unique_multiple(client):
    count = lambda b: client.post("/api/puzzles/count-solutions", json={"board": b}).json()
    assert count(SAMPLE) == {"count": 1, "limit": 2, "classification": "unique", "solvable": True, "unique": True}
    assert count([[0] * 4 for _ in range(4)])["classification"] == "multiple" and count([[0] * 4] * 4)["count"] == 2
    none = count([[0, 3, 0, 0], [0, 0, 2, 0], [2, 0, 4, 0], [0, 0, 0, 0]])
    assert none["classification"] == "none" and not none["solvable"]
    assert count([[1, 1, 0, 0]] + [[0] * 4] * 3)["count"] == 0


def test_generate_verifies_solvable_and_unique(client):
    r = client.post("/api/puzzles/generate", json={"clues": 5, "seed": 7})
    assert r.status_code == 201
    p = r.json()
    assert R.count_solutions(p["board"], 2) == 1                   # re-verified independently of the service
    assert sum(v != 0 for row in p["board"] for v in row) == 5
    assert p["unique"] and p["solvable"] and p["generation"]["verified"] == {"solvable": True, "unique": True, "solution_count": 1}
    again = client.post("/api/puzzles/generate", json={"clues": 5, "seed": 7}).json()
    assert again["board"] == p["board"] and again["generation"]["seed"] == 7      # reproducible
    assert client.get(f"/api/puzzles/{p['puzzle_id']}").status_code == 200


def test_generate_unsaved_and_failure_and_limits(client):
    p = client.post("/api/puzzles/generate", json={"clues": 8, "seed": 1, "save": False}).json()
    assert client.get(f"/api/puzzles/{p['puzzle_id']}").status_code == 404
    fail = client.post("/api/puzzles/generate", json={"clues": 4, "seed": 3, "max_attempts": 1})
    if fail.status_code == 422:
        assert_envelope(fail.json(), "GENERATION_FAILED")
    assert client.post("/api/puzzles/generate", json={"clues": 3}).status_code == 422
    assert client.post("/api/puzzles/generate", json={"clues": 17}).status_code == 422


@pytest.mark.parametrize("bad", [
    [[0] * 4] * 3, [[0] * 3] * 4, "x", None, [[0, 0, 0, 5]] + [[0] * 4] * 3, [[0, 0, 0, -1]] + [[0] * 4] * 3,
    [[0, 0, 0, True]] + [[0] * 4] * 3, [[0, 0, 0, "1"]] + [[0] * 4] * 3, [[0, 0, 0, 1.5]] + [[0] * 4] * 3,
    [[0, 0, 0, None]] + [[0] * 4] * 3, [[]] * 4])
def test_invalid_board_payloads_are_rejected_with_envelope(client, bad):
    for path in ("/api/puzzles/validate", "/api/puzzles/count-solutions", "/api/puzzles", "/api/solve/tot"):
        r = client.post(path, json={"board": bad})
        assert r.status_code == 422, (path, r.text)
        # board:null on /solve reports "exactly one of puzzle_id or board" instead of a board-shape error
        assert_envelope(r.json(), None if (bad is None and path == "/api/solve/tot") else "INVALID_BOARD")


def test_other_invalid_requests(client):
    assert_envelope(client.post("/api/puzzles/validate", content="not json", headers={"content-type": "application/json"}).json())
    assert client.post("/api/puzzles/validate", json={"board": SAMPLE, "extra": 1}).status_code == 422
    r = client.post("/api/solve/tot", json={"board": SAMPLE, "puzzle_id": "puzzle-abc"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_REQUEST"
    assert client.post("/api/solve/tot", json={}).status_code == 422
    assert client.post("/api/solve/tot", json={"board": SAMPLE, "strategy": "magic"}).status_code == 422
    assert client.post("/api/solve/tot", json={"board": SAMPLE, "max_nodes": 0}).status_code == 422
    assert_envelope(client.post("/api/solve/tot", json={"board": SAMPLE, "timeout_s": 9999}).json(), "INVALID_REQUEST")


def test_unknown_ids_and_bad_id_format(client):
    assert_envelope(client.get("/api/puzzles/puzzle-doesnotexist").json(), "PUZZLE_NOT_FOUND")
    assert client.get("/api/puzzles/bad id!").status_code in (404, 422)
    assert_envelope(client.get("/api/puzzles/" + "x" * 80).json(), "INVALID_ID")
    r = client.post("/api/solve/tot", json={"puzzle_id": "puzzle-nope"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "PUZZLE_NOT_FOUND"


def test_contradictory_puzzle_cannot_be_solved(client):
    r = client.post("/api/solve/tot", json={"board": [[1, 1, 0, 0]] + [[0] * 4] * 3})
    assert r.status_code == 422 and r.json()["error"]["code"] == "PUZZLE_CONTRADICTORY"
    assert "row" in {c["kind"] for c in r.json()["error"]["details"]["conflicts"]}


def test_oversized_body_rejected(client):
    r = client.post("/api/puzzles/validate", content=b"x" * 70000, headers={"content-type": "application/json"})
    assert r.status_code == 413 and r.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_unknown_route_and_method_use_envelope(client):
    assert_envelope(client.get("/api/nope").json(), "NOT_FOUND")
    assert_envelope(client.put("/api/health").json(), "METHOD_NOT_ALLOWED")
