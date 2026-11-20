from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from .. import __version__
from ..context import Context, get_ctx
from ..schemas import Health, RuntimeStatus
from ..services.runtime import runtime_status

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=Health, summary="Backend liveness")
def health() -> Health:
    return Health(status="ok", version=__version__, time=datetime.now(timezone.utc).isoformat())


@router.get("/runtime/status", response_model=RuntimeStatus, summary="Ollama, models, vector store and database status")
def runtime(ctx: Context = Depends(get_ctx)) -> dict:
    return runtime_status(ctx.settings, ctx.db, ctx.ollama_models)
