from typing import Any

from fastapi import APIRouter, Depends, Query, Response

from ..context import Context, get_ctx
from ..core.errors import check_id, not_found
from ..schemas import EvaluationListItem, EvaluationRequest, EvaluationRun

router = APIRouter(prefix="/api/evaluation", tags=["evaluation"])


@router.post("/run", response_model=EvaluationRun, status_code=202,
             summary="Run the five-case TA1-vs-TA2 evaluation as a background job (poll GET /api/evaluation/{id})")
def run_evaluation(body: EvaluationRequest, ctx: Context = Depends(get_ctx)) -> dict:
    return ctx.evaluation.start(body.model_dump())


@router.get("", response_model=list[EvaluationListItem], summary="Evaluation runs, newest first (running, completed and failed)")
def list_evaluations(limit: int = Query(default=20, ge=1, le=100), ctx: Context = Depends(get_ctx)) -> list[dict]:
    return ctx.db.list_evaluations(limit)


@router.get("/latest", response_model=EvaluationRun, summary="Most recent completed evaluation")
def latest(ctx: Context = Depends(get_ctx)) -> dict:
    ev = ctx.db.latest_evaluation()
    if not ev:
        raise not_found("evaluation", "latest")
    return ctx.evaluation.view(ev)


@router.get("/{evaluation_id}", response_model=EvaluationRun, summary="Evaluation status/result")
def get_evaluation(evaluation_id: str, ctx: Context = Depends(get_ctx)) -> dict:
    check_id(evaluation_id, "evaluation_id")
    return ctx.evaluation.get(evaluation_id)


@router.get("/{evaluation_id}/traces/{trace_key}", summary="The recorded trace behind one evaluation metric (JSON; ?download=true to export)")
def get_evaluation_trace(evaluation_id: str, trace_key: str, response: Response, download: bool = False,
                         ctx: Context = Depends(get_ctx)) -> Any:
    check_id(evaluation_id, "evaluation_id")
    check_id(trace_key, "trace_key")
    data = ctx.evaluation.trace(evaluation_id, trace_key)
    if download:
        response.headers["Content-Disposition"] = f'attachment; filename="{evaluation_id}-{trace_key}.json"'
    return {"evaluation_id": evaluation_id, "trace_key": trace_key, "recorded": True, "data": data}
