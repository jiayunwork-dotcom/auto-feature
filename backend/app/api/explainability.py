from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import SHAPResult, Task
from app.tasks.celery_app import celery_app

router = APIRouter()


@router.post("/tasks/{task_id}/explainability")
async def start_explainability(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status not in ("ensemble_done", "ensemble", "model_search_done", "model_searched"):
        raise HTTPException(status_code=400, detail="Model training must be completed first")

    task.status = "explainability"
    await db.commit()

    celery_app.send_task("app.tasks.explainability.run", args=[task_id])

    return {"task_id": task_id, "status": "explainability", "message": "SHAP calculation task started"}


@router.get("/tasks/{task_id}/explainability/global")
async def get_global_shap(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(SHAPResult).where(SHAPResult.task_id == task_id, SHAPResult.scope == "global")
    )
    shap_result = result.scalars().first()

    if not shap_result:
        raise HTTPException(status_code=404, detail="Global SHAP result not found")

    return {"task_id": task_id, "scope": "global", "data": shap_result.data}


@router.get("/tasks/{task_id}/explainability/local")
async def get_local_shap(
    task_id: int,
    sample_index: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(SHAPResult).where(SHAPResult.task_id == task_id, SHAPResult.scope == "local")
    )
    shap_result = result.scalars().first()

    if not shap_result:
        raise HTTPException(status_code=404, detail="Local SHAP result not found")

    data = shap_result.data or {}
    samples = data.get("samples", [])
    if sample_index >= len(samples):
        raise HTTPException(status_code=400, detail=f"sample_index {sample_index} out of range (0-{len(samples) - 1})")

    return {"task_id": task_id, "scope": "local", "sample_index": sample_index, "data": samples[sample_index]}
