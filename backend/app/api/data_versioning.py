import datetime
import hashlib
import os
import uuid

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.models import DatasetVersion, DriftComparison, DriftWarning, Task

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
