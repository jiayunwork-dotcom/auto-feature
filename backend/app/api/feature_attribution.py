import os

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.models import FeatureAttribution, Task, Pipeline as PipelineModel
from app.tasks.celery_app import celery_app

router = APIRouter()


@router.post("/tasks/{task_id}/feature-attribution")
async def start_feature_attribution(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status not in (
        "feature_selection_done",
        "explainability_done",
        "model_search_done",
        "ensemble_done",
        "completed",
    ):
        raise HTTPException(
            status_code=400,
            detail="Feature selection must be completed before running attribution analysis",
        )

    selected_path = os.path.join(
        settings.UPLOAD_DIR, f"selected_{task_id}.parquet"
    )
    if not os.path.exists(selected_path):
        raise HTTPException(
            status_code=400,
            detail="selected_features is empty. Please complete feature selection first.",
        )

    best_models_path = os.path.join(
        settings.PIPELINE_DIR, f"best_models_{task_id}.joblib"
    )
    if not os.path.exists(best_models_path):
        raise HTTPException(
            status_code=400,
            detail="Trained model not found. Please complete model search first.",
        )

    celery_app.send_task("app.tasks.feature_attribution.run", args=[task_id])

    return {
        "task_id": task_id,
        "status": "started",
        "message": "Feature attribution task started",
    }


@router.get("/tasks/{task_id}/feature-attribution/latest")
async def get_latest_attribution(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(FeatureAttribution)
        .where(FeatureAttribution.task_id == task_id)
        .order_by(FeatureAttribution.id.desc())
    )
    attribution = result.scalars().first()

    if not attribution:
        raise HTTPException(status_code=404, detail="Feature attribution result not found")

    return {
        "id": attribution.id,
        "task_id": attribution.task_id,
        "status": attribution.status,
        "shap_values": attribution.shap_values,
        "interaction_matrix": attribution.interaction_matrix,
        "feature_dag": attribution.feature_dag,
        "error_message": attribution.error_message,
        "created_at": attribution.created_at.isoformat() if attribution.created_at else None,
        "completed_at": attribution.completed_at.isoformat() if attribution.completed_at else None,
    }


@router.get("/tasks/{task_id}/feature-attribution/{attribution_id}")
async def get_attribution(
    task_id: int,
    attribution_id: int,
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    attribution = await db.get(FeatureAttribution, attribution_id)
    if not attribution or attribution.task_id != task_id:
        raise HTTPException(status_code=404, detail="Feature attribution not found")

    return {
        "id": attribution.id,
        "task_id": attribution.task_id,
        "status": attribution.status,
        "shap_values": attribution.shap_values,
        "interaction_matrix": attribution.interaction_matrix,
        "feature_dag": attribution.feature_dag,
        "error_message": attribution.error_message,
        "created_at": attribution.created_at.isoformat() if attribution.created_at else None,
        "completed_at": attribution.completed_at.isoformat() if attribution.completed_at else None,
    }


@router.websocket("/ws/tasks/{task_id}/feature-attribution")
async def ws_feature_attribution(task_id: int, websocket: WebSocket):
    await websocket.accept()
    import json
    import redis.asyncio as aioredis

    try:
        r = aioredis.from_url(settings.REDIS_URL)
        channel = f"feature_attribution:{task_id}"
        pubsub = r.pubsub()
        await pubsub.subscribe(channel)

        try:
            async for message in pubsub.listen():
                if message["type"] == "message":
                    data = json.loads(message["data"])
                    await websocket.send_json(data)
        finally:
            await pubsub.unsubscribe(channel)
            await r.close()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
