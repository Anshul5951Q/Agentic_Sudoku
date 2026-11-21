"""SQLite persistence for sessions, puzzles, runs, trace events, search nodes, approvals and evaluations.

Trace events are the source of truth for replay and the WebSocket: they are written here first and
only then streamed. (run_id, sequence) is the primary key, so replays can never duplicate an event.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from ta2.models import utc_now

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (session_id TEXT PRIMARY KEY, puzzle_id TEXT NOT NULL, title TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS puzzles (puzzle_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, name TEXT, board TEXT NOT NULL,
    source TEXT NOT NULL, created_at TEXT NOT NULL, solution_count INTEGER, unique_flag INTEGER, solvable INTEGER,
    generation TEXT);
CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, session_id TEXT NOT NULL,
    puzzle_id TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, board TEXT NOT NULL, config TEXT NOT NULL,
    created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, result TEXT, progress TEXT,
    idempotency_key TEXT, request_hash TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS ix_runs_idem ON runs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS events (run_id TEXT NOT NULL, sequence INTEGER NOT NULL, event TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (run_id, sequence));
CREATE TABLE IF NOT EXISTS nodes (run_id TEXT NOT NULL, node_id TEXT NOT NULL, parent_node_id TEXT, payload TEXT NOT NULL,
    PRIMARY KEY (run_id, node_id));
CREATE TABLE IF NOT EXISTS approvals (approval_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, status TEXT NOT NULL,
    payload TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT);
CREATE TABLE IF NOT EXISTS evaluations (evaluation_id TEXT PRIMARY KEY, status TEXT NOT NULL, options TEXT, result TEXT,
    error TEXT, created_at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE IF NOT EXISTS evaluation_traces (evaluation_id TEXT NOT NULL, trace_key TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (evaluation_id, trace_key));
"""
RUN_JSON = ("config", "result", "progress")


def _j(v: Any) -> str | None:
    return None if v is None else json.dumps(v)


def _l(v: str | None) -> Any:
    return None if v is None else json.loads(v)


class Database:
    def __init__(self, path: str | Path):
        self.path = str(path)
        with self.conn() as c:
            c.execute("PRAGMA journal_mode=WAL")
            c.executescript(SCHEMA)

    @contextmanager
    def conn(self):
        con = sqlite3.connect(self.path, timeout=15)
        con.row_factory = sqlite3.Row
        try:
            with con:
                yield con
        finally:
            con.close()

    def ping(self) -> bool:
        with self.conn() as c:
            return c.execute("SELECT 1").fetchone()[0] == 1

    # ------------------------------------------------------------ puzzles / sessions
    def create_puzzle(self, puzzle_id: str, session_id: str, board, name, source, solution_count=None, unique=None,
                      solvable=None, generation=None) -> dict:
        now = utc_now()
        with self.conn() as c:
            c.execute("INSERT INTO sessions VALUES(?,?,?,?,?)", (session_id, puzzle_id, name, now, now))
            c.execute("INSERT INTO puzzles VALUES(?,?,?,?,?,?,?,?,?,?)",
                      (puzzle_id, session_id, name, _j(board), source, now, solution_count,
                       None if unique is None else int(unique), None if solvable is None else int(solvable), _j(generation)))
        return self.get_puzzle(puzzle_id)

    @staticmethod
    def _puzzle(r) -> dict:
        return {"puzzle_id": r["puzzle_id"], "session_id": r["session_id"], "name": r["name"], "board": _l(r["board"]),
                "source": r["source"], "created_at": r["created_at"], "solution_count": r["solution_count"],
                "unique": None if r["unique_flag"] is None else bool(r["unique_flag"]),
                "solvable": None if r["solvable"] is None else bool(r["solvable"]), "generation": _l(r["generation"])}

    def get_puzzle(self, puzzle_id: str) -> dict | None:
        with self.conn() as c:
            r = c.execute("SELECT * FROM puzzles WHERE puzzle_id=?", (puzzle_id,)).fetchone()
        return self._puzzle(r) if r else None

    def update_puzzle_check(self, puzzle_id: str, count: int) -> None:
        with self.conn() as c:
            c.execute("UPDATE puzzles SET solution_count=?, unique_flag=?, solvable=? WHERE puzzle_id=?",
                      (count, int(count == 1), int(count >= 1), puzzle_id))

    def get_session(self, session_id: str) -> dict | None:
        with self.conn() as c:
            r = c.execute("SELECT * FROM sessions WHERE session_id=?", (session_id,)).fetchone()
        return dict(r) if r else None

    def touch_session(self, session_id: str) -> None:
        with self.conn() as c:
            c.execute("UPDATE sessions SET updated_at=? WHERE session_id=?", (utc_now(), session_id))

    def list_sessions(self, limit: int = 50, offset: int = 0) -> tuple[list[dict], int]:
        with self.conn() as c:
            total = c.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
            rows = c.execute("SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?", (limit, offset)).fetchall()
        return [dict(r) for r in rows], total

    # ------------------------------------------------------------ runs
    @staticmethod
    def _run(r) -> dict:
        d = dict(r)
        d["board"] = _l(d["board"])
        for k in RUN_JSON:
            d[k] = _l(d[k])
        return d

    def create_run(self, run: dict) -> dict:
        with self.conn() as c:
            c.execute("INSERT INTO runs(run_id,thread_id,session_id,puzzle_id,mode,status,board,config,created_at,progress,"
                      "idempotency_key,request_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                      (run["run_id"], run["thread_id"], run["session_id"], run["puzzle_id"], run["mode"], run["status"],
                       _j(run["board"]), _j(run["config"]), run["created_at"], _j({}), run.get("idempotency_key"),
                       run.get("request_hash")))
        return self.get_run(run["run_id"])

    def get_run(self, run_id: str) -> dict | None:
        with self.conn() as c:
            r = c.execute("SELECT * FROM runs WHERE run_id=?", (run_id,)).fetchone()
        return self._run(r) if r else None

    def find_by_idempotency(self, key: str) -> dict | None:
        with self.conn() as c:
            r = c.execute("SELECT * FROM runs WHERE idempotency_key=?", (key,)).fetchone()
        return self._run(r) if r else None

    def update_run(self, run_id: str, **fields: Any) -> None:
        cols, vals = [], []
        for k, v in fields.items():
            cols.append(f"{k}=?")
            vals.append(_j(v) if k in RUN_JSON else v)
        with self.conn() as c:
            c.execute(f"UPDATE runs SET {', '.join(cols)} WHERE run_id=?", (*vals, run_id))

    def set_status_if(self, run_id: str, new: str, allowed_from: tuple[str, ...]) -> bool:
        """Atomic compare-and-set used to make pause/resume/cancel idempotent and race-free."""
        marks = ",".join("?" * len(allowed_from))
        with self.conn() as c:
            return c.execute(f"UPDATE runs SET status=? WHERE run_id=? AND status IN ({marks})",
                             (new, run_id, *allowed_from)).rowcount == 1

    def list_runs(self, session_id: str | None = None, limit: int = 500) -> list[dict]:
        q, a = "SELECT * FROM runs", []
        if session_id:
            q, a = q + " WHERE session_id=?", [session_id]
        with self.conn() as c:
            rows = c.execute(q + " ORDER BY created_at DESC LIMIT ?", (*a, limit)).fetchall()
        return [self._run(r) for r in rows]

    def runs_with_status(self, *statuses: str) -> list[dict]:
        marks = ",".join("?" * len(statuses))
        with self.conn() as c:
            return [self._run(r) for r in c.execute(f"SELECT * FROM runs WHERE status IN ({marks})", statuses).fetchall()]

    # ------------------------------------------------------------ events / nodes
    def insert_events(self, run_id: str, events: list[dict]) -> int:
        with self.conn() as c:
            n = 0
            for e in events:
                n += c.execute("INSERT OR IGNORE INTO events VALUES(?,?,?,?)",
                               (run_id, e["sequence"], e["event"], json.dumps(e))).rowcount
        return n

    def get_events(self, run_id: str, after: int = -1, limit: int = 100000) -> list[dict]:
        with self.conn() as c:
            rows = c.execute("SELECT payload FROM events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT ?",
                             (run_id, after, limit)).fetchall()
        return [json.loads(r["payload"]) for r in rows]

    def last_sequence(self, run_id: str) -> int:
        with self.conn() as c:
            v = c.execute("SELECT MAX(sequence) FROM events WHERE run_id=?", (run_id,)).fetchone()[0]
        return -1 if v is None else v

    def upsert_nodes(self, run_id: str, nodes: dict[str, dict]) -> None:
        with self.conn() as c:
            for nid, n in nodes.items():
                c.execute("INSERT INTO nodes VALUES(?,?,?,?) ON CONFLICT(run_id,node_id) DO UPDATE SET payload=excluded.payload",
                          (run_id, nid, n.get("parent_node_id"), json.dumps(n)))

    def get_nodes(self, run_id: str) -> list[dict]:
        with self.conn() as c:
            rows = c.execute("SELECT payload FROM nodes WHERE run_id=? ORDER BY node_id", (run_id,)).fetchall()
        return [json.loads(r["payload"]) for r in rows]

    # ------------------------------------------------------------ approvals
    def save_approval(self, approval_id: str, thread_id: str, status: str, payload: dict, decided: bool = False) -> None:
        now = utc_now()
        with self.conn() as c:
            c.execute("INSERT INTO approvals VALUES(?,?,?,?,?,?) ON CONFLICT(approval_id) DO UPDATE SET "
                      "status=excluded.status, payload=excluded.payload, decided_at=COALESCE(excluded.decided_at, decided_at)",
                      (approval_id, thread_id, status, json.dumps(payload), now, now if decided else None))

    def get_approval(self, approval_id: str) -> dict | None:
        with self.conn() as c:
            r = c.execute("SELECT * FROM approvals WHERE approval_id=?", (approval_id,)).fetchone()
        if not r:
            return None
        return {**json.loads(r["payload"]), "approval_id": r["approval_id"], "thread_id": r["thread_id"], "status": r["status"],
                "created_at": r["created_at"], "decided_at": r["decided_at"]}

    def list_approvals(self, limit: int = 100) -> list[dict]:
        with self.conn() as c:
            ids = [r[0] for r in c.execute("SELECT approval_id FROM approvals ORDER BY created_at DESC LIMIT ?", (limit,))]
        return [self.get_approval(i) for i in ids]

    # ------------------------------------------------------------ evaluations
    def create_evaluation(self, eid: str, options: dict) -> None:
        with self.conn() as c:
            c.execute("INSERT INTO evaluations(evaluation_id,status,options,created_at) VALUES(?,?,?,?)",
                      (eid, "running", _j(options), utc_now()))

    def finish_evaluation(self, eid: str, status: str, result: dict | None = None, error: str | None = None) -> None:
        with self.conn() as c:
            c.execute("UPDATE evaluations SET status=?, result=?, error=?, finished_at=? WHERE evaluation_id=?",
                      (status, _j(result), error, utc_now(), eid))

    def get_evaluation(self, eid: str) -> dict | None:
        with self.conn() as c:
            r = c.execute("SELECT * FROM evaluations WHERE evaluation_id=?", (eid,)).fetchone()
        if not r:
            return None
        d = dict(r)
        d["options"], d["result"] = _l(d["options"]), _l(d["result"])
        return d

    def list_evaluations(self, limit: int = 20) -> list[dict]:
        with self.conn() as c:
            rows = c.execute("SELECT evaluation_id, status, options, error, created_at, finished_at FROM evaluations "
                             "ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [{**dict(r), "options": _l(r["options"])} for r in rows]

    def save_evaluation_traces(self, eid: str, traces: dict[str, Any]) -> None:
        with self.conn() as c:
            c.executemany("INSERT OR REPLACE INTO evaluation_traces VALUES(?,?,?)",
                          [(eid, k, json.dumps(v, default=str)) for k, v in traces.items()])

    def evaluation_trace_keys(self, eid: str) -> list[str]:
        with self.conn() as c:
            return [r[0] for r in c.execute("SELECT trace_key FROM evaluation_traces WHERE evaluation_id=? ORDER BY trace_key", (eid,))]

    def get_evaluation_trace(self, eid: str, key: str) -> Any:
        with self.conn() as c:
            r = c.execute("SELECT payload FROM evaluation_traces WHERE evaluation_id=? AND trace_key=?", (eid, key)).fetchone()
        return None if r is None else json.loads(r[0])

    def latest_evaluation(self) -> dict | None:
        with self.conn() as c:
            r = c.execute("SELECT evaluation_id FROM evaluations WHERE status='completed' ORDER BY finished_at DESC LIMIT 1").fetchone()
        return self.get_evaluation(r[0]) if r else None
