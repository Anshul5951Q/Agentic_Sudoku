from fastapi import APIRouter, Depends

from ..context import Context, get_ctx
from ..core.errors import APIError, check_id
from ..schemas import ChatHistory, ChatRequest, ChatResponse
from .rag import _is_ollama_error

router = APIRouter(prefix="/api/chat", tags=["memory"])


@router.post("", response_model=ChatResponse, summary="One chat turn with short-term memory ON (thread_id) or OFF (amnesia)")
def chat(body: ChatRequest, ctx: Context = Depends(get_ctx)) -> dict:
    if body.thread_id:
        check_id(body.thread_id, "thread_id")
    try:
        return ctx.chat.send(body.message, body.thread_id, body.memory, body.puzzle)
    except Exception as e:
        if _is_ollama_error(e):
            raise APIError(503, "OLLAMA_UNAVAILABLE", "The local Ollama service could not be reached.", recoverable=True, retryable=True) from None
        raise


@router.get("/{thread_id}", response_model=ChatHistory, summary="Restore a thread's conversation from its checkpoint")
def history(thread_id: str, ctx: Context = Depends(get_ctx)) -> dict:
    check_id(thread_id, "thread_id")
    return ctx.chat.history(thread_id)
