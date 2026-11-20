"""Backend settings, read from environment variables (and an optional git-ignored .env). No hardcoded hosts."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from ta2 import config as ta2_config

# Origins used by Expo web/dev tooling on the dev machine. Native Android apps do not use CORS at all.
DEFAULT_CORS_REGEX = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


@dataclass
class Settings:
    host: str = "127.0.0.1"
    port: int = 8000
    db_path: Path = field(default_factory=lambda: ta2_config.DATA_DIR / "api.sqlite3")
    checkpoint_db: Path = field(default_factory=lambda: ta2_config.CHECKPOINT_DB)
    memory_db: Path = field(default_factory=lambda: ta2_config.MEMORY_DB)
    chroma_dir: Path = field(default_factory=lambda: ta2_config.CHROMA_DIR)
    cors_origins: list[str] = field(default_factory=list)
    cors_origin_regex: str = DEFAULT_CORS_REGEX
    ollama_host: str = "http://localhost:11434"
    max_body_bytes: int = 64 * 1024
    chunk_steps: int = 4              # search decisions per checkpointed chunk (pause/cancel granularity)
    step_delay: float = 0.0           # seconds between chunks (pacing; tests use it to make runs pausable)
    default_timeout_s: float = 30.0
    max_hops: int = 8

    @classmethod
    def from_env(cls) -> "Settings":
        _load_dotenv(ta2_config.ROOT / ".env")
        e = os.environ
        s = cls()
        s.host = e.get("SUDOKU_API_HOST", s.host)
        s.port = int(e.get("SUDOKU_API_PORT", s.port))
        if e.get("SUDOKU_API_DB"):
            s.db_path = Path(e["SUDOKU_API_DB"])
        s.cors_origins = [o.strip() for o in e.get("SUDOKU_CORS_ORIGINS", "").split(",") if o.strip()]
        s.ollama_host = e.get("OLLAMA_HOST", s.ollama_host).rstrip("/")
        s.step_delay = float(e.get("SUDOKU_STEP_DELAY", s.step_delay))
        return s
