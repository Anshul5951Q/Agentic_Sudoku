"""Runtime availability probes (Ollama, models, Chroma, database). Detail strings never include local paths."""
from __future__ import annotations

import json
import urllib.request

from ta2 import config as ta2_config

REQUIRED_MODELS = (ta2_config.LLM_MODEL, ta2_config.EMBED_MODEL)


def probe_ollama(host: str, timeout: float = 2.0) -> set[str] | None:
    """Return installed model names, or None if Ollama is unreachable."""
    try:
        with urllib.request.urlopen(f"{host}/api/tags", timeout=timeout) as r:
            return {m["name"] for m in json.load(r)["models"]}
    except Exception:
        return None


def probe_vector_store(chroma_dir) -> tuple[str, str | None]:
    try:
        if not chroma_dir.exists():
            return "not_initialized", "vector store has not been built yet (first RAG query builds it)"
        import chromadb
        n = chromadb.PersistentClient(path=str(chroma_dir)).get_collection("sudoku_knowledge").count()
        return "up", f"{n} chunks indexed"
    except Exception:
        return "not_initialized", "collection not found or unreadable"


def runtime_status(settings, db, ollama_models=probe_ollama) -> dict:
    installed = ollama_models(settings.ollama_host)
    ollama_up = installed is not None
    models = []
    for m in REQUIRED_MODELS:
        have = ollama_up and any(n == m or n == m + ":latest" for n in installed)
        models.append({"name": m, "status": "up" if have else "down",
                       "detail": None if have else ("not installed (run: ollama pull %s)" % m if ollama_up else "Ollama unreachable")})
    vs, vs_detail = probe_vector_store(settings.chroma_dir)
    try:
        db_ok, db_detail = db.ping(), None
    except Exception:
        db_ok, db_detail = False, "database error"
    ready_llm = ollama_up and models[0]["status"] == "up"
    ready_rag = ollama_up and models[1]["status"] == "up" and ready_llm
    return {
        "backend": {"name": "backend", "status": "up", "detail": None},
        "ollama": {"name": "ollama", "status": "up" if ollama_up else "down",
                   "detail": None if ollama_up else "The local Ollama service could not be reached."},
        "models": models,
        "vector_store": {"name": "chromadb", "status": vs, "detail": vs_detail},
        "database": {"name": "sqlite", "status": "up" if db_ok else "down", "detail": db_detail},
        "ready_for_llm": ready_llm, "ready_for_rag": ready_rag,
    }
