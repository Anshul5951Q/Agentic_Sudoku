from fastapi import APIRouter, Depends, Response

from ..context import Context, get_ctx
from ..core.errors import check_id, not_found
from ..schemas import EvaluationRequest, EvaluationRun

router = APIRouter(prefix="/api/evaluation", tags=["evaluation"])


@router.post("/run", response_model=EvaluationRun, status_code=202,
             summary="Run the five-case TA1-vs-TA2 evaluation as a background job (poll GET /api/evaluation/{id})")
def run_evaluation(body: EvaluationRequest, ctx: Context = Depends(get_ctx)) -> dict:
    return ctx.evaluation.start(body.model_dump())


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
