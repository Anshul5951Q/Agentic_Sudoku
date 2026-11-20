"""Namespaced long-term memory in SQLite, plus validated dead-end pattern recall.

Namespaces are ``(user_id, kind)`` pairs, e.g. ``("alice", "profile")``, ``("alice", "puzzle_history")``,
``("alice", "dead_ends")``. Everything is stored in a file, so it survives process restarts.

Dead-end patterns are structured and are *never trusted*: a pattern applies to a board only if the
board contains all of the pattern's givens, and the search engine still re-confirms the dead end
deterministically before pruning (see ``search.confirm_dead_end``).
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from . import config
from . import sudoku_rules as R

DB_PATH = config.MEMORY_DB
KINDS = ("profile", "puzzle_history", "dead_ends")
DEFAULT_USER = "demo-user"


def _now() -> str:
    from .models import utc_now
    return utc_now()


class SudokuMemory:
    def __init__(self, db_path: str | Path = DB_PATH, user_id: str = DEFAULT_USER):
        self.db_path, self.user_id = str(db_path), user_id
        with self._con() as con:
            con.execute("""CREATE TABLE IF NOT EXISTS memory_records (
                memory_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL, kind TEXT NOT NULL, memory_key TEXT NOT NULL,
                payload TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT, use_count INTEGER NOT NULL DEFAULT 0,
                UNIQUE(user_id, kind, memory_key))""")

    @contextmanager
    def _con(self):
        """Commit on success, roll back on error, and ALWAYS close (avoids locked files on Windows)."""
        con = sqlite3.connect(self.db_path, timeout=10)
        con.row_factory = sqlite3.Row
        try:
            with con:
                yield con
        finally:
            con.close()

    # ---------------------------------------------------------------- generic CRUD
    def put(self, kind: str, key: str, payload: Any, user_id: str | None = None) -> int:
        uid = user_id or self.user_id
        if kind not in KINDS:
            raise ValueError(f"unknown memory kind {kind!r}")
        with self._con() as con:
            con.execute("INSERT INTO memory_records(user_id,kind,memory_key,payload,created_at) VALUES(?,?,?,?,?) "
                        "ON CONFLICT(user_id,kind,memory_key) DO UPDATE SET payload=excluded.payload",
                        (uid, kind, key, json.dumps(payload), _now()))
            return con.execute("SELECT memory_id FROM memory_records WHERE user_id=? AND kind=? AND memory_key=?",
                               (uid, kind, key)).fetchone()[0]

    def get(self, kind: str, key: str, user_id: str | None = None, touch: bool = True) -> Any | None:
        uid = user_id or self.user_id
        with self._con() as con:
            row = con.execute("SELECT memory_id,payload FROM memory_records WHERE user_id=? AND kind=? AND memory_key=?",
                              (uid, kind, key)).fetchone()
            if not row:
                return None
            if touch:
                con.execute("UPDATE memory_records SET last_used_at=?, use_count=use_count+1 WHERE memory_id=?",
                            (_now(), row["memory_id"]))
        return json.loads(row["payload"])

    def list(self, kind: str | None = None, user_id: str | None = None) -> list[dict]:
        uid = user_id or self.user_id
        q, args = "SELECT * FROM memory_records WHERE user_id=?", [uid]
        if kind:
            q, args = q + " AND kind=?", args + [kind]
        with self._con() as con:
            rows = con.execute(q + " ORDER BY memory_id", args).fetchall()
        return [{**dict(r), "payload": json.loads(r["payload"])} for r in rows]

    def delete(self, memory_id: int, user_id: str | None = None) -> bool:
        with self._con() as con:
            return con.execute("DELETE FROM memory_records WHERE memory_id=? AND user_id=?",
                               (memory_id, user_id or self.user_id)).rowcount > 0

    def clear(self, user_id: str | None = None, kind: str | None = None) -> int:
        q, args = "DELETE FROM memory_records WHERE user_id=?", [user_id or self.user_id]
        if kind:
            q, args = q + " AND kind=?", args + [kind]
        with self._con() as con:
            return con.execute(q, args).rowcount

    # ---------------------------------------------------------------- dead-end patterns
    @staticmethod
    def make_pattern(board_before: R.Board, cell: list[int], value: int, reason_code: str) -> dict:
        givens = [[r, c, board_before[r][c]] for r in range(4) for c in range(4) if board_before[r][c]]
        return {"givens": givens, "cell": list(cell), "value": value, "reason_code": reason_code}

    @staticmethod
    def pattern_key(p: dict) -> str:
        g = "".join(f"{r}{c}{v}" for r, c, v in sorted(p["givens"]))
        return f"{g}@{p['cell'][0]}{p['cell'][1]}={p['value']}"

    def learn(self, board_before: R.Board, cell: list[int], value: int, reason_code: str) -> None:
        p = self.make_pattern(board_before, cell, value, reason_code)
        self.put("dead_ends", self.pattern_key(p), p)

    @staticmethod
    def pattern_applies(p: dict, board: R.Board, cell: list[int], value: int) -> bool:
        """Structural match only: same cell/value, and every given of the pattern is on the board."""
        try:
            if p["cell"] != list(cell) or p["value"] != value:
                return False
            return all(board[r][c] == v for r, c, v in p["givens"])
        except (KeyError, TypeError, IndexError, ValueError):
            return False

    def lookup(self, board: R.Board, cell: list[int], value: int) -> dict | None:
        """Return a matching remembered pattern (with its id) or None. Caller must still re-verify it."""
        for rec in self.list("dead_ends"):
            if self.pattern_applies(rec["payload"], board, cell, value):
                with self._con() as con:
                    con.execute("UPDATE memory_records SET last_used_at=?, use_count=use_count+1 WHERE memory_id=?",
                                (_now(), rec["memory_id"]))
                return {"id": rec["memory_id"], **rec["payload"]}
        return None

    def relevant(self, board: R.Board) -> list[dict]:
        """Dead-end memories whose givens are all present on the board (for display)."""
        out = []
        for rec in self.list("dead_ends"):
            p = rec["payload"]
            try:
                if all(board[r][c] == v for r, c, v in p["givens"]):
                    out.append(rec)
            except (KeyError, TypeError, IndexError):
                continue
        return out

    def save_puzzle_session(self, puzzle: R.Board, summary: dict) -> int:
        key = R.board_key(puzzle) + f"#{_now()}"
        return self.put("puzzle_history", key, {"puzzle": puzzle, **summary})

    def all(self, kind: str = "dead_ends") -> list[tuple[str, str]]:
        """Compatibility view: (key, json-payload) pairs."""
        return [(r["memory_key"], json.dumps(r["payload"])) for r in self.list(kind)]
