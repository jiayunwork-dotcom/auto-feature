from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import EnsembleResult, Task
from app.tasks.celery_app import celery_app

router = APIRouter()


@router.post("/tasks/{task_id}/ensemble")
async def start_ensemble(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status not in ("model_search_done", "model_searched"):
        raise HTTPException(status_code=400, detail="Model search must be completed first")

    task.status = "ensemble"
    await db.commit()

    celery_app.send_task("app.tasks.ensemble.run", args=[task_id])

    return {"task_id": task_id, "status": "ensemble", "message": "Ensemble task started"}


@router.get("/tasks/{task_id}/ensemble/result")
async def get_ensemble_result(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(EnsembleResult).where(EnsembleResult.task_id == task_id).order_by(EnsembleResult.id.desc())
    )
    ensemble = result.scalars().first()

    if not ensemble:
        return {"task_id": task_id, "status": task.status, "result": None}

    return {
        "task_id": task_id,
        "status": task.status,
        "result": {
            "stacking_score": ensemble.stacking_score,
            "blending_score": ensemble.blending_score,
            "single_best_score": ensemble.single_best_score,
            "meta_learner": ensemble.meta_learner,
            "base_models": ensemble.base_models,
        },
    }
