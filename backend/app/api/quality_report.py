from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import DataQualityReport, Task
from app.tasks.tasks import quality_report_task

router = APIRouter()


@router.post("/tasks/{task_id}/quality-report")
async def generate_quality_report(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    quality_report_task.delay(task_id)

    return {"status": "started", "task_id": task_id}


@router.get("/tasks/{task_id}/quality-report/latest")
async def get_latest_quality_report(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(DataQualityReport)
        .where(DataQualityReport.task_id == task_id)
        .order_by(DataQualityReport.created_at.desc())
        .limit(1)
    )
    report = result.scalar_one_or_none()

    if not report:
        return {"report": None}

    return {
        "report": {
            "id": report.id,
            "task_id": report.task_id,
            "status": report.status,
            "report_data": report.report_data,
            "created_at": report.created_at.isoformat() if report.created_at else None,
        }
    }


@router.get("/tasks/{task_id}/quality-report/{report_id}")
async def get_quality_report(task_id: int, report_id: int, db: AsyncSession = Depends(get_db)):
    report = await db.get(DataQualityReport, report_id)
    if not report or report.task_id != task_id:
        raise HTTPException(status_code=404, detail="Report not found")

    return {
        "id": report.id,
        "task_id": report.task_id,
        "status": report.status,
        "report_data": report.report_data,
        "created_at": report.created_at.isoformat() if report.created_at else None,
    }


@router.get("/tasks/{task_id}/quality-reports")
async def list_quality_reports(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(DataQualityReport)
        .where(DataQualityReport.task_id == task_id)
        .order_by(DataQualityReport.created_at.desc())
    )
    reports = result.scalars().all()

    return {
        "reports": [
            {
                "id": r.id,
                "task_id": r.task_id,
                "status": r.status,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in reports
        ]
    }
