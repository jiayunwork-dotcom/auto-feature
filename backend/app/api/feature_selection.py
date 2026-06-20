from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import FeatureSelectionLog, Task
from app.tasks.celery_app import celery_app

router = APIRouter()


@router.post("/tasks/{task_id}/feature-selection")
async def start_feature_selection(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status not in ("feature_engineering_done", "feature_engineered"):
        raise HTTPException(status_code=400, detail="Feature engineering must be completed first")

    task.status = "feature_selection"
    await db.commit()

    celery_app.send_task("app.tasks.feature_selection.run", args=[task_id])

    return {"task_id": task_id, "status": "feature_selection", "message": "Feature selection task started"}


@router.get("/tasks/{task_id}/feature-selection/result")
async def get_feature_selection_result(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(FeatureSelectionLog).where(FeatureSelectionLog.task_id == task_id).order_by(FeatureSelectionLog.id)
    )
    logs = result.scalars().all()

    return {
        "task_id": task_id,
        "status": task.status,
        "logs": [
            {
                "stage": log.stage,
                "remaining_count": log.remaining_count,
                "removed_features": log.removed_features,
                "importance_top30": log.importance_top30,
            }
            for log in logs
        ],
    }
