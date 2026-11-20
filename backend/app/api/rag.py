from fastapi import APIRouter, Depends

from ..context import Context, get_ctx
from ..core.errors import APIError
from ..schemas import RAGQuery, RAGResponse

router = APIRouter(prefix="/api/rag", tags=["rag"])
_OLLAMA_MODULES = ("httpx", "httpcore", "ollama", "urllib3", "requests")


def _is_ollama_error(e: Exception) -> bool:
    return isinstance(e, (ConnectionError, TimeoutError)) or any(
        (getattr(c, "__module__", "") or "").split(".")[0] in _OLLAMA_MODULES for c in type(e).__mro__)


@router.post("/query", response_model=RAGResponse, summary="Retrieve k chunks and answer from them, or say \"I don't know.\"")
def rag_query(body: RAGQuery, ctx: Context = Depends(get_ctx)) -> dict:
    try:
        return ctx.rag_answer(body.query, body.k)
    except Exception as e:
        if _is_ollama_error(e):
            raise APIError(503, "OLLAMA_UNAVAILABLE", "The local Ollama service could not be reached.",
                           recoverable=True, retryable=True) from None
        raise APIError(503, "VECTOR_STORE_UNAVAILABLE", "The knowledge store is unavailable.", recoverable=True, retryable=True) from None
