from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import FeatureEngineeringLog, Task
from app.tasks.celery_app import celery_app

router = APIRouter()


@router.post("/tasks/{task_id}/feature-engineering")
async def start_feature_engineering(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if not task.target_column:
        raise HTTPException(status_code=400, detail="Target column not set")

    task.status = "feature_engineering"
    await db.commit()

    celery_app.send_task("app.tasks.feature_engineering.run", args=[task_id])

    return {"task_id": task_id, "status": "feature_engineering", "message": "Feature engineering task started"}


@router.get("/tasks/{task_id}/feature-engineering/result")
async def get_feature_engineering_result(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(FeatureEngineeringLog).where(FeatureEngineeringLog.task_id == task_id).order_by(FeatureEngineeringLog.id)
    )
    logs = result.scalars().all()

    return {
        "task_id": task_id,
        "status": task.status,
        "logs": [
            {
                "stage": log.stage,
                "original_features": log.original_features,
                "transformed_features": log.transformed_features,
                "contribution_by_type": log.contribution_by_type,
                "config": log.config,
            }
            for log in logs
        ],
    }
