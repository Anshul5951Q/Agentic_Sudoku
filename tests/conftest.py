import json
import urllib.request
import pytest


def _ollama_models() -> set[str]:
    try:
        with urllib.request.urlopen("http://localhost:11434/api/tags", timeout=2) as r:
            return {m["name"] for m in json.load(r)["models"]}
    except Exception:
        return set()


def pytest_collection_modifyitems(config, items):
    have = _ollama_models()
    ok = any(m.startswith("qwen2.5:3b") for m in have) and any(m.startswith("nomic-embed-text") for m in have)
    if ok:
        return
    skip = pytest.mark.skip(reason="local Ollama with qwen2.5:3b + nomic-embed-text not available")
    for it in items:
        if "ollama" in it.keywords:
            it.add_marker(skip)
