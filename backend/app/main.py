import json

import redis as redis_lib
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.core.config import settings
from app.core.database import close_db, init_db

app = FastAPI(title="AutoFeature", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")

redis_client: redis_lib.Redis | None = None


@app.on_event("startup")
async def startup():
    global redis_client
    redis_client = redis_lib.from_url(settings.REDIS_URL)
    await init_db()


@app.on_event("shutdown")
async def shutdown():
    global redis_client
    if redis_client:
        redis_client.close()
    await close_db()


@app.websocket("/ws/tasks/{task_id}")
async def websocket_task_updates(websocket: WebSocket, task_id: int):
    await websocket.accept()
    if not redis_client:
        await websocket.close()
        return

    pubsub = redis_client.pubsub()
    channel = f"task_updates:{task_id}"
    pubsub.subscribe(channel)

    try:
        while True:
            message = pubsub.get_message(timeout=1.0)
            if message and message["type"] == "message":
                data = message["data"]
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                await websocket.send_text(data)
    except WebSocketDisconnect:
        pass
    finally:
        pubsub.unsubscribe(channel)
        pubsub.close()


@app.websocket("/ws/quality-report/{task_id}")
async def websocket_quality_report(websocket: WebSocket, task_id: int):
    await websocket.accept()
    if not redis_client:
        await websocket.close()
        return

    pubsub = redis_client.pubsub()
    channel = f"quality_report:{task_id}"
    pubsub.subscribe(channel)

    try:
        while True:
            message = pubsub.get_message(timeout=1.0)
            if message and message["type"] == "message":
                data = message["data"]
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                await websocket.send_text(data)
    except WebSocketDisconnect:
        pass
    finally:
        pubsub.unsubscribe(channel)
        pubsub.close()


@app.websocket("/ws/drift-comparison/{comparison_id}")
async def websocket_drift_comparison(websocket: WebSocket, comparison_id: int):
    await websocket.accept()
    if not redis_client:
        await websocket.close()
        return

    pubsub = redis_client.pubsub()
    channel = f"drift_comparison:{comparison_id}"
    pubsub.subscribe(channel)

    try:
        while True:
            message = pubsub.get_message(timeout=1.0)
            if message and message["type"] == "message":
                data = message["data"]
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                await websocket.send_text(data)
    except WebSocketDisconnect:
        pass
    finally:
        pubsub.unsubscribe(channel)
        pubsub.close()
