"""FastAPI application factory. The backend only orchestrates and persists; Sudoku logic stays in ta2/."""
from __future__ import annotations

import logging
from typing import Callable

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse

from . import __version__
from .api import agents, analytics, approvals, chat, evaluation, health, history, memory, puzzles, rag, solve, ws
from .context import Context
from .core import errors
from .core.config import Settings
from .persistence.db import Database
from .schemas import APIError as APIErrorSchema
from .services.approvals import ApprovalService
from .services.chat import ChatService
from .services.evaluation import EvaluationService
from .services.runs import RunManager
from .services.runtime import probe_ollama

logging.basicConfig(level=logging.INFO)

TAGS = [{"name": "health", "description": "Liveness and local runtime status"},
        {"name": "puzzles", "description": "Create, validate, count solutions, generate verified puzzles"},
        {"name": "solve", "description": "CoT / ToT / multi-agent runs, traces, pause/resume/cancel"},
        {"name": "websocket", "description": "WS /ws/solve/{run_id} live trace (see docs/API.md)"},
        {"name": "oversight", "description": "Human approval of AI-suggested moves"}]


# Error codes each route can actually return (500 is possible everywhere). Used to keep the OpenAPI schema precise.
ROUTE_ERRORS: dict[tuple[str, str], tuple[int, ...]] = {
    ("get", "/api/health"): (), ("get", "/api/runtime/status"): (),
    ("post", "/api/puzzles"): (413, 422), ("get", "/api/puzzles/{puzzle_id}"): (404, 422),
    ("post", "/api/puzzles/validate"): (413, 422), ("post", "/api/puzzles/count-solutions"): (413, 422),
    ("post", "/api/puzzles/generate"): (413, 422),
    ("post", "/api/solve/cot"): (404, 409, 413, 422), ("post", "/api/solve/tot"): (404, 409, 413, 422),
    ("post", "/api/solve/multi-agent"): (404, 409, 413, 422), ("get", "/api/solve/{run_id}"): (404, 422),
    ("get", "/api/solve/{run_id}/trace"): (404, 422), ("get", "/api/solve/{run_id}/checkpoint"): (404, 422),
    ("post", "/api/solve/{run_id}/pause"): (404, 408, 409, 422), ("post", "/api/solve/{run_id}/resume"): (404, 409, 422),
    ("post", "/api/solve/{run_id}/cancel"): (404, 408, 409, 422), ("get", "/api/agents/{run_id}/status"): (404, 422),
    ("get", "/api/memory"): (422,), ("post", "/api/memory"): (413, 422), ("delete", "/api/memory/{memory_id}"): (404, 422),
    ("delete", "/api/memory"): (422,), ("post", "/api/rag/query"): (413, 422, 503),
    ("get", "/api/history"): (422,), ("get", "/api/history/{session_id}"): (404, 422), ("get", "/api/analytics/summary"): (),
    ("post", "/api/evaluation/run"): (409, 413, 422), ("get", "/api/evaluation/latest"): (404,),
    ("get", "/api/evaluation/{evaluation_id}"): (404, 422), ("post", "/api/approvals"): (413, 422), ("get", "/api/approvals"): (422,),
    ("get", "/api/approvals/{approval_id}"): (404, 422), ("post", "/api/approvals/{approval_id}/decision"): (404, 409, 413, 422),
}
ERROR_CODES = (404, 408, 409, 413, 422, 503)


def _install_openapi(app: FastAPI) -> None:
    def custom():
        if app.openapi_schema:
            return app.openapi_schema
        spec = get_openapi(title=app.title, version=app.version, description=app.description, routes=app.routes, tags=TAGS)
        for path, ops in spec["paths"].items():
            for method, op in ops.items():
                allowed = set(ROUTE_ERRORS.get((method, path), ())) | {500}
                for code in ERROR_CODES:
                    if str(code) in op["responses"] and code not in allowed:
                        del op["responses"][str(code)]
        app.openapi_schema = spec
        return spec
    app.openapi = custom


def _default_rag(settings: Settings) -> Callable[[str, int], dict]:
    def answer(query: str, k: int) -> dict:
        from ta2 import rag as ta2_rag
        return ta2_rag.answer(query, k, store=ta2_rag.get_vectorstore(settings.chroma_dir))
    return answer


def create_app(settings: Settings | None = None, *, rag_answer=None, cot_runner=None, evaluation_runner=None,
               approval_llm=None, ollama_models=None, chat_llm=None, rag_retrieve=None) -> FastAPI:
    """Dependencies can be injected so tests run without Ollama (fake RAG/LLM/CoT) or with Ollama 'down'."""
    s = settings or Settings.from_env()
    db = Database(s.db_path)
    ctx = Context(settings=s, db=db, runs=RunManager(db, s, cot_runner, rag_retrieve), approvals=ApprovalService(db, s, approval_llm),
                  evaluation=EvaluationService(db, evaluation_runner), chat=ChatService(s, chat_llm), ollama_models=ollama_models or probe_ollama,
                  rag_answer=rag_answer or _default_rag(s))
    ctx.runs.recover()
    app = FastAPI(title="SudokuMind AI API", version=__version__, openapi_tags=TAGS,
                  description="Local backend for the SudokuMind AI Android app. Deterministic Sudoku validation is authoritative; "
                              "LLM output is advisory. Boards are 4x4 lists of ints (0 = empty); coordinates are zero-based [row, col].")
    app.state.ctx = ctx
    errors.install(app)
    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origins, allow_origin_regex=s.cors_origin_regex,
                       allow_methods=["*"], allow_headers=["*"], expose_headers=["Content-Disposition"])

    @app.middleware("http")
    async def limit_body(request: Request, call_next):
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > s.max_body_bytes:
            return JSONResponse(errors.APIError(413, "PAYLOAD_TOO_LARGE", "The request body is too large.").body(), status_code=413)
        return await call_next(request)

    for r in (health.router, puzzles.router, solve.router, agents.router, memory.router, rag.router, history.router,
              analytics.router, evaluation.router, approvals.router, chat.router, ws.router):
        app.include_router(r, responses={c: {"model": APIErrorSchema, "description": "Error envelope (spec 8.5)"}
                                         for c in (404, 408, 409, 413, 422, 500, 503)})
    _install_openapi(app)
    return app
