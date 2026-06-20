import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.models import Pipeline, Task
from app.tasks.celery_app import celery_app

router = APIRouter()


@router.get("/tasks/{task_id}/pipeline/download")
async def download_pipeline(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(Pipeline).where(Pipeline.task_id == task_id).order_by(Pipeline.id.desc())
    )
    pipeline = result.scalars().first()

    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if not os.path.exists(pipeline.file_path):
        raise HTTPException(status_code=404, detail="Pipeline file not found on disk")

    return FileResponse(
        path=pipeline.file_path,
        filename=os.path.basename(pipeline.file_path),
        media_type="application/octet-stream",
    )


@router.post("/tasks/{task_id}/predict")
async def predict(
    task_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(Pipeline).where(Pipeline.task_id == task_id).order_by(Pipeline.id.desc())
    )
    pipeline = result.scalars().first()

    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if not os.path.exists(pipeline.file_path):
        raise HTTPException(status_code=404, detail="Pipeline file not found on disk")

    ext = os.path.splitext(file.filename)[1].lower() if file.filename else ".csv"
    content = await file.read()
    predict_dir = os.path.join(settings.UPLOAD_DIR, "predict")
    os.makedirs(predict_dir, exist_ok=True)

    predict_file_id = str(uuid.uuid4())
    predict_path = os.path.join(predict_dir, f"{predict_file_id}{ext}")
    with open(predict_path, "wb") as f:
        f.write(content)

    async_result = celery_app.send_task(
        "app.tasks.predict.run",
        args=[task_id, pipeline.file_path, predict_path],
    )

    try:
        result_data = async_result.get(timeout=120)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")

    predictions = result_data.get("predictions", [])
    shap_top5 = result_data.get("shap_top5", {})

    return {"task_id": task_id, "predictions": predictions, "shap_top5": shap_top5}
