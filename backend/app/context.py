"""Application context: everything routers need, injectable for tests (fake Ollama, fake RAG, fake CoT)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from fastapi import Request

from .core.config import Settings
from .persistence.db import Database
from .services.approvals import ApprovalService
from .services.chat import ChatService
from .services.evaluation import EvaluationService
from .services.runs import RunManager


@dataclass
class Context:
    settings: Settings
    db: Database
    runs: RunManager
    approvals: ApprovalService
    evaluation: EvaluationService
    chat: ChatService
    ollama_models: Callable[[str], set[str] | None]
    rag_answer: Callable[[str, int], dict]
    extras: dict[str, Any] = field(default_factory=dict)


def get_ctx(request: Request) -> Context:
    return request.app.state.ctx
