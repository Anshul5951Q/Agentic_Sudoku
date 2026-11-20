from fastapi import APIRouter, Depends, Query

from ..context import Context, get_ctx
from ..core.errors import check_id, not_found
from ..schemas import Approval, ApprovalDecision, ApprovalRequest

router = APIRouter(prefix="/api/approvals", tags=["oversight"])


@router.post("", response_model=Approval, status_code=201,
             summary="Ask the proposer for a move; it is guarded and held for human approval (never auto-applied)")
def request_approval(body: ApprovalRequest, ctx: Context = Depends(get_ctx)) -> dict:
    return ctx.approvals.request(body.board, body.user_text)


@router.get("", response_model=list[Approval], summary="List approval records")
def list_approvals(limit: int = Query(default=50, ge=1, le=200), ctx: Context = Depends(get_ctx)) -> list[dict]:
    return ctx.db.list_approvals(limit)


@router.get("/{approval_id}", response_model=Approval, summary="Get one approval record")
def get_approval(approval_id: str, ctx: Context = Depends(get_ctx)) -> dict:
    check_id(approval_id, "approval_id")
    a = ctx.db.get_approval(approval_id)
    if not a:
        raise not_found("approval", approval_id)
    return a


@router.post("/{approval_id}/decision", response_model=Approval, summary="Approve or reject the held suggestion")
def decide(approval_id: str, body: ApprovalDecision, ctx: Context = Depends(get_ctx)) -> dict:
    check_id(approval_id, "approval_id")
    return ctx.approvals.decide(approval_id, body.approved)
