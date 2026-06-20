from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery_app = Celery(
    "autofeature",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    beat_schedule={
        "auto-compare-poll": {
            "task": "app.tasks.auto_compare.poll",
            "schedule": 60.0,
        },
    },
)

celery_app.autodiscover_tasks(["app.tasks"])
