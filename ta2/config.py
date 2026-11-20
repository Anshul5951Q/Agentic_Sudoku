"""Paths and model names. Data locations can be overridden with SUDOKU_DATA_DIR (no hardcoded machine paths)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("SUDOKU_DATA_DIR", ROOT))
TRACE_DIR = Path(os.environ.get("SUDOKU_TRACE_DIR", ROOT / "traces"))
CHECKPOINT_DB = DATA_DIR / "checkpoints.sqlite3"
MEMORY_DB = DATA_DIR / "sudoku_memory.sqlite3"
CHROMA_DIR = DATA_DIR / "chroma_db"
CORPUS = Path(__file__).resolve().parent / "corpus" / "sudoku_knowledge.txt"

LLM_MODEL = "qwen2.5:3b"          # the only chat model permitted
EMBED_MODEL = "nomic-embed-text"  # the only embedding model permitted
