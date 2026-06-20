import json

import redis as redis_lib
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.models import ModelResult, Task
from app.tasks.celery_app import celery_app

router = APIRouter()


@router.post("/tasks/{task_id}/model-search")
async def start_model_search(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status not in ("feature_selection_done", "feature_selected"):
        raise HTTPException(status_code=400, detail="Feature selection must be completed first")

    task.status = "model_search"
    await db.commit()

    celery_app.send_task("app.tasks.model_search.run", args=[task_id])

    return {"task_id": task_id, "status": "model_search", "message": "Model search task started"}


@router.get("/tasks/{task_id}/model-search/result")
async def get_model_search_result(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(ModelResult).where(ModelResult.task_id == task_id).order_by(ModelResult.rank)
    )
    models = result.scalars().all()

    return {
        "task_id": task_id,
        "status": task.status,
        "models": [
            {
                "model_name": m.model_name,
                "best_params": m.best_params,
                "best_score": m.best_score,
                "rank": m.rank,
            }
            for m in models
        ],
    }


@router.get("/tasks/{task_id}/model-search/progress")
async def get_model_search_progress(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    r = redis_lib.from_url(settings.REDIS_URL)
    progress_key = f"model_search:progress:{task_id}"
    progress_data = r.get(progress_key)

    if progress_data:
        return json.loads(progress_data)

    return {
        "task_id": task_id,
        "status": task.status,
        "completed_models": 0,
        "total_models": 0,
        "current_model": None,
    }
