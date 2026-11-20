from fastapi import APIRouter, Depends

from ..context import Context, get_ctx
from ..core.errors import check_id
from ..schemas import AgentStatusResponse
from ..services import agents as svc

router = APIRouter(prefix="/api/agents", tags=["agents"])


@router.get("/{run_id}/status", response_model=AgentStatusResponse, summary="Per-agent status derived from the stored trace")
def agent_status(run_id: str, ctx: Context = Depends(get_ctx)) -> dict:
    check_id(run_id, "run_id")
    run = ctx.runs.get(run_id)
    return svc.derive(run, ctx.db.get_events(run_id), ctx.runs.is_live(run_id))
