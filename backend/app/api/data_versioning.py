import datetime
import hashlib
import json
import os
import uuid
from typing import Optional

import pandas as pd
import redis as redis_lib
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.models import (
    DatasetVersion,
    DriftComparison,
    DriftWarning,
    Task,
    AutoCompareStrategy,
    DriftReportExport,
)

router = APIRouter()

os.makedirs(settings.UPLOAD_DIR, exist_ok=True)


def _compute_md5(content: bytes) -> str:
    md5_hash = hashlib.md5()
    md5_hash.update(content)
    return md5_hash.hexdigest()


def _infer_column_type(series: pd.Series) -> str:
    if pd.api.types.is_numeric_dtype(series):
        return "numeric"
    elif pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"
    elif pd.api.types.is_bool_dtype(series):
        return "boolean"
    else:
        return "categorical"


def _get_default_strategy() -> dict:
    return {
        "is_enabled": False,
        "trigger_mode": "on_upload",
        "baseline_mode": "first_version",
        "custom_p_value_threshold": None,
        "custom_psi_threshold": None,
        "custom_drift_ratio_threshold": None,
        "poll_interval_minutes": 60,
        "last_triggered_at": None,
        "created_at": None,
        "updated_at": None,
    }


def _update_celery_beat_schedule():
    try:
        r = redis_lib.from_url(settings.REDIS_URL)
        schedule_data = {}
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session
        SYNC_DB_URL = settings.DATABASE_URL.replace("+asyncpg", "+psycopg2")
        engine = create_engine(SYNC_DB_URL)
        with Session(engine) as session:
            strategies = session.query(AutoCompareStrategy).filter(
                AutoCompareStrategy.is_enabled == True,
                AutoCompareStrategy.trigger_mode == "scheduled"
            ).all()
            for s in strategies:
                schedule_data[str(s.task_id)] = {
                    "task_id": s.task_id,
                    "poll_interval_minutes": s.poll_interval_minutes or 60,
                    "baseline_mode": s.baseline_mode,
                }
        r.set("auto_compare_schedule", json.dumps(schedule_data))
        r.close()
    except Exception:
        pass


class AutoCompareStrategyRequest(BaseModel):
    is_enabled: bool
    trigger_mode: str = Field(pattern=r'^(on_upload|scheduled)$')
    baseline_mode: str = Field(pattern=r'^(first_version|previous_version)$')
    custom_p_value_threshold: Optional[float] = None
    custom_psi_threshold: Optional[float] = None
    custom_drift_ratio_threshold: Optional[float] = None
    poll_interval_minutes: int = Field(ge=5, le=1440)

    @field_validator('poll_interval_minutes')
    @classmethod
    def check_poll_interval(cls, v: int) -> int:
        if v < 5 or v > 1440:
            raise ValueError('poll_interval_minutes must be between 5 and 1440')
        return v


class AutoCompareStrategyResponse(BaseModel):
    task_id: int
    is_enabled: bool
    trigger_mode: str
    baseline_mode: str
    custom_p_value_threshold: Optional[float]
    custom_psi_threshold: Optional[float]
    custom_drift_ratio_threshold: Optional[float]
    poll_interval_minutes: int
    last_triggered_at: Optional[str]
    created_at: Optional[str]
    updated_at: Optional[str]


class DriftReportExportResponse(BaseModel):
    id: int
    task_id: int
    comparison_id: Optional[int]
    status: str
    file_path: Optional[str]
    file_name: Optional[str]
    file_size: Optional[int]
    error_message: Optional[str]
    created_at: Optional[str]
    completed_at: Optional[str]


@router.post("/tasks/{task_id}/versions")
async def create_version(task_id: int, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext != ".csv":
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File size exceeds 200MB limit")

    file_hash_md5 = _compute_md5(content)

    hash_result = await db.execute(
        select(DatasetVersion.file_hash_md5).where(DatasetVersion.task_id == task_id)
    )
    existing_hashes = [row[0] for row in hash_result.fetchall()]
    if file_hash_md5 in existing_hashes:
        raise HTTPException(status_code=409, detail="文件内容未变化")

    version_dir = os.path.join(settings.UPLOAD_DIR, "versions", str(task_id))
    os.makedirs(version_dir, exist_ok=True)

    vn_result = await db.execute(
        select(func.max(DatasetVersion.version_number)).where(DatasetVersion.task_id == task_id)
    )
    max_version = vn_result.scalar_one_or_none()
    new_version_number = (max_version or 0) + 1

    file_uuid = str(uuid.uuid4())
    save_filename = f"{new_version_number}_{file_uuid}.csv"
    save_path = os.path.join(version_dir, save_filename)
    with open(save_path, "wb") as f:
        f.write(content)

    try:
        df = pd.read_csv(save_path)
    except Exception as e:
        os.remove(save_path)
        raise HTTPException(status_code=400, detail=f"Failed to read CSV: {str(e)}")

    row_count = len(df)
    column_count = len(df.columns)
    columns_info = {}
    for col in df.columns:
        columns_info[col] = _infer_column_type(df[col])

    dataset_version = DatasetVersion(
        task_id=task_id,
        version_number=new_version_number,
        filename=file.filename,
        file_path=save_path,
        row_count=row_count,
        column_count=column_count,
        file_hash_md5=file_hash_md5,
        columns_info=columns_info,
    )
    db.add(dataset_version)
    await db.commit()
    await db.refresh(dataset_version)

    from app.tasks.tasks import trigger_auto_compare_on_upload
    trigger_auto_compare_on_upload(task_id, dataset_version.id)

    return {
        "id": dataset_version.id,
        "task_id": dataset_version.task_id,
        "version_number": dataset_version.version_number,
        "filename": dataset_version.filename,
        "file_path": dataset_version.file_path,
        "row_count": dataset_version.row_count,
        "column_count": dataset_version.column_count,
        "file_hash_md5": dataset_version.file_hash_md5,
        "columns_info": dataset_version.columns_info,
        "created_at": dataset_version.created_at.isoformat() if dataset_version.created_at else None,
    }


@router.get("/tasks/{task_id}/versions")
async def list_versions(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(DatasetVersion)
        .where(DatasetVersion.task_id == task_id)
        .order_by(DatasetVersion.version_number.desc())
    )
    versions = result.scalars().all()

    return {
        "versions": [
            {
                "id": v.id,
                "task_id": v.task_id,
                "version_number": v.version_number,
                "filename": v.filename,
                "row_count": v.row_count,
                "column_count": v.column_count,
                "file_hash_md5": v.file_hash_md5,
                "created_at": v.created_at.isoformat() if v.created_at else None,
            }
            for v in versions
        ]
    }


@router.get("/tasks/{task_id}/versions/{version_id}")
async def get_version(task_id: int, version_id: int, db: AsyncSession = Depends(get_db)):
    version = await db.get(DatasetVersion, version_id)
    if not version or version.task_id != task_id:
        raise HTTPException(status_code=404, detail="Version not found")

    return {
        "id": version.id,
        "task_id": version.task_id,
        "version_number": version.version_number,
        "filename": version.filename,
        "file_path": version.file_path,
        "row_count": version.row_count,
        "column_count": version.column_count,
        "file_hash_md5": version.file_hash_md5,
        "columns_info": version.columns_info,
        "created_at": version.created_at.isoformat() if version.created_at else None,
    }


@router.delete("/tasks/{task_id}/versions/{version_id}")
async def delete_version(task_id: int, version_id: int, db: AsyncSession = Depends(get_db)):
    version = await db.get(DatasetVersion, version_id)
    if not version or version.task_id != task_id:
        raise HTTPException(status_code=404, detail="Version not found")

    file_path = version.file_path
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except OSError:
            pass

    await db.delete(version)
    await db.commit()

    return {"message": "Version deleted successfully", "version_id": version_id}


class DriftCompareRequest(BaseModel):
    version_a_id: int
    version_b_id: int


@router.post("/tasks/{task_id}/compare")
async def create_drift_comparison(
    task_id: int,
    req: DriftCompareRequest,
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    version_a = await db.get(DatasetVersion, req.version_a_id)
    if not version_a or version_a.task_id != task_id:
        raise HTTPException(status_code=404, detail="Version A not found or does not belong to this task")

    version_b = await db.get(DatasetVersion, req.version_b_id)
    if not version_b or version_b.task_id != task_id:
        raise HTTPException(status_code=404, detail="Version B not found or does not belong to this task")

    comparison = DriftComparison(
        task_id=task_id,
        version_a_id=req.version_a_id,
        version_b_id=req.version_b_id,
        status="pending",
    )
    db.add(comparison)
    await db.commit()
    await db.refresh(comparison)

    from app.tasks.tasks import drift_comparison_task
    drift_comparison_task.delay(comparison.id)

    return {"comparison_id": comparison.id, "status": "pending"}


@router.get("/tasks/{task_id}/comparisons")
async def list_comparisons(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(DriftComparison)
        .where(DriftComparison.task_id == task_id)
        .order_by(DriftComparison.created_at.desc())
    )
    comparisons = result.scalars().all()

    version_ids = set()
    for c in comparisons:
        if c.version_a_id:
            version_ids.add(c.version_a_id)
        if c.version_b_id:
            version_ids.add(c.version_b_id)

    version_map: dict[int, int] = {}
    if version_ids:
        vr = await db.execute(
            select(DatasetVersion.id, DatasetVersion.version_number)
            .where(DatasetVersion.id.in_(version_ids))
        )
        for row in vr.fetchall():
            version_map[row[0]] = row[1]

    return {
        "comparisons": [
            {
                "id": c.id,
                "task_id": c.task_id,
                "version_a_id": c.version_a_id,
                "version_b_id": c.version_b_id,
                "version_a_number": version_map.get(c.version_a_id) if c.version_a_id else None,
                "version_b_number": version_map.get(c.version_b_id) if c.version_b_id else None,
                "status": c.status,
                "overall_warning": c.overall_warning,
                "significant_drift_ratio": c.significant_drift_ratio,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "completed_at": c.completed_at.isoformat() if c.completed_at else None,
                "error_message": c.error_message,
            }
            for c in comparisons
        ]
    }


@router.get("/tasks/{task_id}/comparisons/{comparison_id}")
async def get_comparison(task_id: int, comparison_id: int, db: AsyncSession = Depends(get_db)):
    comparison = await db.get(DriftComparison, comparison_id)
    if not comparison or comparison.task_id != task_id:
        raise HTTPException(status_code=404, detail="Comparison not found")

    version_a_number = None
    version_b_number = None
    if comparison.version_a_id:
        va = await db.get(DatasetVersion, comparison.version_a_id)
        if va:
            version_a_number = va.version_number
    if comparison.version_b_id:
        vb = await db.get(DatasetVersion, comparison.version_b_id)
        if vb:
            version_b_number = vb.version_number

    return {
        "id": comparison.id,
        "task_id": comparison.task_id,
        "version_a_id": comparison.version_a_id,
        "version_b_id": comparison.version_b_id,
        "version_a_number": version_a_number,
        "version_b_number": version_b_number,
        "status": comparison.status,
        "column_results": comparison.column_results.get("columns", []) if comparison.column_results else [],
        "added_columns": comparison.added_columns or [],
        "removed_columns": comparison.removed_columns or [],
        "overall_warning": comparison.overall_warning,
        "significant_drift_ratio": comparison.significant_drift_ratio,
        "created_at": comparison.created_at.isoformat() if comparison.created_at else None,
        "completed_at": comparison.completed_at.isoformat() if comparison.completed_at else None,
        "error_message": comparison.error_message,
    }


@router.get("/tasks/{task_id}/warnings")
async def list_warnings(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(DriftWarning)
        .where(DriftWarning.task_id == task_id, DriftWarning.is_active == True)
        .order_by(DriftWarning.created_at.desc())
    )
    warnings = result.scalars().all()

    return {
        "warnings": [
            {
                "id": w.id,
                "task_id": w.task_id,
                "comparison_id": w.comparison_id,
                "warning_message": w.warning_message,
                "significant_columns": w.significant_columns or [],
                "drift_ratio": w.drift_ratio,
                "is_active": w.is_active,
                "created_at": w.created_at.isoformat() if w.created_at else None,
                "acknowledged_at": w.acknowledged_at.isoformat() if w.acknowledged_at else None,
            }
            for w in warnings
        ]
    }


@router.get("/tasks/{task_id}/warnings/latest")
async def get_latest_warning(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(DriftWarning)
        .where(DriftWarning.task_id == task_id, DriftWarning.is_active == True)
        .order_by(DriftWarning.created_at.desc())
        .limit(1)
    )
    warning = result.scalars().first()

    if not warning:
        return {"warning": None}

    return {
        "warning": {
            "id": warning.id,
            "task_id": warning.task_id,
            "comparison_id": warning.comparison_id,
            "warning_message": warning.warning_message,
            "significant_columns": warning.significant_columns or [],
            "drift_ratio": warning.drift_ratio,
            "is_active": warning.is_active,
            "created_at": warning.created_at.isoformat() if warning.created_at else None,
            "acknowledged_at": warning.acknowledged_at.isoformat() if warning.acknowledged_at else None,
        }
    }


@router.post("/tasks/{task_id}/warnings/{warning_id}/acknowledge")
async def acknowledge_warning(task_id: int, warning_id: int, db: AsyncSession = Depends(get_db)):
    warning = await db.get(DriftWarning, warning_id)
    if not warning or warning.task_id != task_id:
        raise HTTPException(status_code=404, detail="Warning not found")

    warning.is_active = False
    warning.acknowledged_at = datetime.datetime.utcnow()
    await db.commit()

    return {"message": "Warning acknowledged successfully", "warning_id": warning_id}


@router.get("/tasks/{task_id}/auto-compare-strategy", response_model=AutoCompareStrategyResponse)
async def get_auto_compare_strategy(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(AutoCompareStrategy).where(AutoCompareStrategy.task_id == task_id)
    )
    strategy = result.scalars().first()

    if not strategy:
        default = _get_default_strategy()
        default["task_id"] = task_id
        return AutoCompareStrategyResponse(**default)

    return AutoCompareStrategyResponse(
        task_id=strategy.task_id,
        is_enabled=strategy.is_enabled,
        trigger_mode=strategy.trigger_mode,
        baseline_mode=strategy.baseline_mode,
        custom_p_value_threshold=strategy.custom_p_value_threshold,
        custom_psi_threshold=strategy.custom_psi_threshold,
        custom_drift_ratio_threshold=strategy.custom_drift_ratio_threshold,
        poll_interval_minutes=strategy.poll_interval_minutes or 60,
        last_triggered_at=strategy.last_triggered_at.isoformat() if strategy.last_triggered_at else None,
        created_at=strategy.created_at.isoformat() if strategy.created_at else None,
        updated_at=strategy.updated_at.isoformat() if strategy.updated_at else None,
    )


@router.put("/tasks/{task_id}/auto-compare-strategy", response_model=AutoCompareStrategyResponse)
async def update_auto_compare_strategy(
    task_id: int,
    req: AutoCompareStrategyRequest,
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(AutoCompareStrategy).where(AutoCompareStrategy.task_id == task_id)
    )
    strategy = result.scalars().first()

    if not strategy:
        strategy = AutoCompareStrategy(task_id=task_id)
        db.add(strategy)

    strategy.is_enabled = req.is_enabled
    strategy.trigger_mode = req.trigger_mode
    strategy.baseline_mode = req.baseline_mode
    strategy.custom_p_value_threshold = req.custom_p_value_threshold
    strategy.custom_psi_threshold = req.custom_psi_threshold
    strategy.custom_drift_ratio_threshold = req.custom_drift_ratio_threshold
    strategy.poll_interval_minutes = req.poll_interval_minutes

    await db.commit()
    await db.refresh(strategy)

    if req.trigger_mode == "scheduled":
        _update_celery_beat_schedule()

    return AutoCompareStrategyResponse(
        task_id=strategy.task_id,
        is_enabled=strategy.is_enabled,
        trigger_mode=strategy.trigger_mode,
        baseline_mode=strategy.baseline_mode,
        custom_p_value_threshold=strategy.custom_p_value_threshold,
        custom_psi_threshold=strategy.custom_psi_threshold,
        custom_drift_ratio_threshold=strategy.custom_drift_ratio_threshold,
        poll_interval_minutes=strategy.poll_interval_minutes or 60,
        last_triggered_at=strategy.last_triggered_at.isoformat() if strategy.last_triggered_at else None,
        created_at=strategy.created_at.isoformat() if strategy.created_at else None,
        updated_at=strategy.updated_at.isoformat() if strategy.updated_at else None,
    )


@router.delete("/tasks/{task_id}/auto-compare-strategy")
async def delete_auto_compare_strategy(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(AutoCompareStrategy).where(AutoCompareStrategy.task_id == task_id)
    )
    strategy = result.scalars().first()

    if strategy:
        await db.delete(strategy)
        await db.commit()
        _update_celery_beat_schedule()

    return {"message": "Strategy deleted successfully"}


@router.post("/tasks/{task_id}/comparisons/{comparison_id}/export")
async def create_drift_report_export(
    task_id: int,
    comparison_id: int,
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    comparison = await db.get(DriftComparison, comparison_id)
    if not comparison or comparison.task_id != task_id:
        raise HTTPException(status_code=404, detail="Comparison not found")

    if comparison.status != "completed":
        raise HTTPException(status_code=400, detail="Only completed comparisons can be exported")

    export_record = DriftReportExport(
        task_id=task_id,
        comparison_id=comparison_id,
        status="pending",
    )
    db.add(export_record)
    await db.commit()
    await db.refresh(export_record)

    from app.tasks.tasks import generate_drift_report_task
    generate_drift_report_task.delay(export_record.id)

    return {"export_id": export_record.id, "status": "pending"}


@router.get("/tasks/{task_id}/exports")
async def list_exports(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(DriftReportExport)
        .where(DriftReportExport.task_id == task_id)
        .order_by(DriftReportExport.created_at.desc())
    )
    exports = result.scalars().all()

    return {
        "exports": [
            {
                "id": e.id,
                "task_id": e.task_id,
                "comparison_id": e.comparison_id,
                "status": e.status,
                "file_path": e.file_path,
                "file_name": e.file_name,
                "file_size": e.file_size,
                "error_message": e.error_message,
                "created_at": e.created_at.isoformat() if e.created_at else None,
                "completed_at": e.completed_at.isoformat() if e.completed_at else None,
            }
            for e in exports
        ]
    }


@router.get("/tasks/{task_id}/exports/{export_id}", response_model=DriftReportExportResponse)
async def get_export(task_id: int, export_id: int, db: AsyncSession = Depends(get_db)):
    export_record = await db.get(DriftReportExport, export_id)
    if not export_record or export_record.task_id != task_id:
        raise HTTPException(status_code=404, detail="Export not found")

    return DriftReportExportResponse(
        id=export_record.id,
        task_id=export_record.task_id,
        comparison_id=export_record.comparison_id,
        status=export_record.status,
        file_path=export_record.file_path,
        file_name=export_record.file_name,
        file_size=export_record.file_size,
        error_message=export_record.error_message,
        created_at=export_record.created_at.isoformat() if export_record.created_at else None,
        completed_at=export_record.completed_at.isoformat() if export_record.completed_at else None,
    )


@router.get("/tasks/{task_id}/exports/{export_id}/download")
async def download_export(task_id: int, export_id: int, db: AsyncSession = Depends(get_db)):
    export_record = await db.get(DriftReportExport, export_id)
    if not export_record or export_record.task_id != task_id:
        raise HTTPException(status_code=404, detail="Export not found")

    if export_record.status != "completed":
        raise HTTPException(status_code=400, detail="Export is not completed yet")

    if not export_record.file_path or not os.path.exists(export_record.file_path):
        raise HTTPException(status_code=404, detail="Export file not found")

    file_name = export_record.file_name or f"drift_report_{export_id}.pdf"
    return FileResponse(
        path=export_record.file_path,
        filename=file_name,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{file_name}"},
    )
