import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.models import ColumnInference, Task
from app.services.inference_service import auto_detect_target, infer_column_types

router = APIRouter()

os.makedirs(settings.UPLOAD_DIR, exist_ok=True)


class ColumnTypeUpdate(BaseModel):
    name: str
    type: str


class ColumnsUpdateRequest(BaseModel):
    columns: list[ColumnTypeUpdate]


class TargetRequest(BaseModel):
    target_column: str


@router.post("/upload")
async def upload_file(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in (".csv", ".parquet"):
        raise HTTPException(status_code=400, detail="Only CSV and Parquet files are supported")

    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File size exceeds 200MB limit")

    file_id = str(uuid.uuid4())
    save_path = os.path.join(settings.UPLOAD_DIR, f"{file_id}{ext}")
    with open(save_path, "wb") as f:
        f.write(content)

    import pandas as pd

    try:
        if ext == ".csv":
            df = pd.read_csv(save_path)
        else:
            df = pd.read_parquet(save_path)
    except Exception as e:
        os.remove(save_path)
        raise HTTPException(status_code=400, detail=f"Failed to read file: {str(e)}")

    task = Task(
        filename=file.filename,
        total_rows=len(df),
        total_columns=len(df.columns),
        status="uploaded",
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    inference_results = infer_column_types(df)
    detected_target = auto_detect_target(list(df.columns))

    for inf in inference_results:
        col_inf = ColumnInference(
            task_id=task.id,
            column_name=inf["column_name"],
            inferred_type=inf["inferred_type"],
            unique_count=inf["unique_count"],
            missing_ratio=inf["missing_ratio"],
            is_target=(inf["column_name"] == detected_target) if detected_target else False,
        )
        db.add(col_inf)

    await db.commit()

    return {"task_id": task.id, "filename": task.filename, "total_rows": task.total_rows, "total_columns": task.total_columns}


@router.get("/tasks/{task_id}/inference")
async def get_inference(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(select(ColumnInference).where(ColumnInference.task_id == task_id))
    columns = result.scalars().all()

    return {
        "task_id": task_id,
        "columns": [
            {
                "column_name": c.column_name,
                "inferred_type": c.inferred_type,
                "confirmed_type": c.confirmed_type,
                "unique_count": c.unique_count,
                "missing_ratio": c.missing_ratio,
                "is_target": c.is_target,
            }
            for c in columns
        ],
    }


@router.put("/tasks/{task_id}/inference")
async def update_inference(task_id: int, body: ColumnsUpdateRequest, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(select(ColumnInference).where(ColumnInference.task_id == task_id))
    columns = result.scalars().all()
    col_map = {c.column_name: c for c in columns}

    for update in body.columns:
        if update.name in col_map:
            col_map[update.name].confirmed_type = update.type

    await db.commit()

    return {"message": "Column types updated successfully"}


@router.post("/tasks/{task_id}/target")
async def set_target(task_id: int, body: TargetRequest, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(select(ColumnInference).where(ColumnInference.task_id == task_id))
    columns = result.scalars().all()

    target_col = None
    for c in columns:
        if c.column_name == body.target_column:
            c.is_target = True
            target_col = c
        else:
            c.is_target = False

    if not target_col:
        raise HTTPException(status_code=404, detail="Target column not found in inference results")

    import pandas as pd

    file_path = _get_task_file_path(task)
    df = _load_dataframe(file_path)

    nunique = df[body.target_column].nunique()
    if nunique <= 20:
        task.task_type = "classification"
    else:
        task.task_type = "regression"

    task.target_column = body.target_column
    task.status = "target_set"
    await db.commit()

    return {
        "task_id": task_id,
        "target_column": task.target_column,
        "task_type": task.task_type,
    }


@router.get("/tasks/{task_id}/overview")
async def get_overview(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    file_path = _get_task_file_path(task)
    df = _load_dataframe(file_path)

    type_counts = {}
    for col in df.columns:
        dtype_str = str(df[col].dtype)
        category = "numeric" if "int" in dtype_str or "float" in dtype_str else "categorical"
        type_counts[category] = type_counts.get(category, 0) + 1

    missing = df.isnull().sum()
    missing_top10 = missing[missing > 0].sort_values(ascending=False).head(10).to_dict()
    missing_top10 = {k: float(v) for k, v in missing_top10.items()}

    numeric_histograms = {}
    for col in df.select_dtypes(include="number").columns:
        series = df[col].dropna()
        if len(series) > 0:
            hist, bin_edges = _compute_histogram(series)
            numeric_histograms[col] = {"bins": bin_edges, "counts": hist}

    categorical_top5 = {}
    for col in df.select_dtypes(exclude="number").columns:
        value_counts = df[col].value_counts().head(5)
        categorical_top5[col] = {str(k): int(v) for k, v in value_counts.items()}

    return {
        "total_rows": task.total_rows,
        "total_columns": task.total_columns,
        "type_counts": type_counts,
        "missing_top10": missing_top10,
        "numeric_histograms": numeric_histograms,
        "categorical_top5": categorical_top5,
    }


def _get_task_file_path(task: Task) -> str:
    upload_dir = settings.UPLOAD_DIR
    for ext in (".csv", ".parquet"):
        for f in os.listdir(upload_dir):
            if task.filename and f.endswith(ext):
                possible = os.path.join(upload_dir, f)
                return possible
    raise FileNotFoundError(f"Data file for task {task.id} not found")


def _load_dataframe(file_path: str):
    import pandas as pd

    if file_path.endswith(".parquet"):
        return pd.read_parquet(file_path)
    return pd.read_csv(file_path)


def _compute_histogram(series, bins=20):
    import numpy as np

    values = series.values
    counts, bin_edges = np.histogram(values, bins=bins)
    return counts.tolist(), bin_edges.tolist()
