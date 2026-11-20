"""Persistent long-term memory for reusable Sudoku dead-end patterns."""
from __future__ import annotations
import sqlite3
from pathlib import Path
from typing import Iterable

DB_PATH = Path(__file__).resolve().parent.parent / "sudoku_memory.sqlite3"

class SudokuMemory:
    def __init__(self, db_path: str | Path = DB_PATH):
        self.db_path = str(db_path)
        with sqlite3.connect(self.db_path) as con:
            con.execute("""CREATE TABLE IF NOT EXISTS memories (
                namespace TEXT NOT NULL, memory_key TEXT NOT NULL,
                content TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(namespace, memory_key))""")

    def put(self, namespace: str, key: str, content: str) -> None:
        with sqlite3.connect(self.db_path) as con:
            con.execute("INSERT INTO memories(namespace,memory_key,content) VALUES(?,?,?) "
                        "ON CONFLICT(namespace,memory_key) DO UPDATE SET content=excluded.content",
                        (namespace, key, content))

    def get(self, namespace: str, key: str) -> str | None:
        with sqlite3.connect(self.db_path) as con:
            row = con.execute("SELECT content FROM memories WHERE namespace=? AND memory_key=?",
                              (namespace, key)).fetchone()
        return row[0] if row else None

    def all(self, namespace: str = "dead_ends") -> list[tuple[str, str]]:
        with sqlite3.connect(self.db_path) as con:
            return con.execute("SELECT memory_key,content FROM memories WHERE namespace=? ORDER BY memory_key",
                               (namespace,)).fetchall()

    def seed(self) -> None:
        patterns = {
            "branch_r1c1_eq_2": "For the supplied sample puzzle, trying (1,1)=2 leads to no candidates at (1,2). Prune and backtrack.",
            "branch_r2c3_eq_2": "For the supplied sample puzzle after (1,1)=1 and (1,2)=2, trying (2,3)=2 leads to no candidates at (2,4). Prune and backtrack.",
            "empty_candidate_set": "Any empty cell with zero candidates proves the current partial assignment cannot be completed. Restore the most recent decision."
        }
        for key, value in patterns.items():
            self.put("dead_ends", key, value)
