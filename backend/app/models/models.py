import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    JSON,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    filename: Mapped[str] = mapped_column(String(256), nullable=False)
    total_rows: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_columns: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_column: Mapped[str | None] = mapped_column(String(128), nullable=True)
    task_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="uploaded")
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.datetime.utcnow
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )

    column_inferences = relationship("ColumnInference", back_populates="task", cascade="all, delete-orphan")
    feature_engineering_logs = relationship("FeatureEngineeringLog", back_populates="task", cascade="all, delete-orphan")
    feature_selection_logs = relationship("FeatureSelectionLog", back_populates="task", cascade="all, delete-orphan")
    model_results = relationship("ModelResult", back_populates="task", cascade="all, delete-orphan")
    ensemble_results = relationship("EnsembleResult", back_populates="task", cascade="all, delete-orphan")
    shap_results = relationship("SHAPResult", back_populates="task", cascade="all, delete-orphan")
    pipelines = relationship("Pipeline", back_populates="task", cascade="all, delete-orphan")


class ColumnInference(Base):
    __tablename__ = "column_inferences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    column_name: Mapped[str] = mapped_column(String(128), nullable=False)
    inferred_type: Mapped[str] = mapped_column(String(32), nullable=False)
    confirmed_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    unique_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    missing_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_target: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    task = relationship("Task", back_populates="column_inferences")


class FeatureEngineeringLog(Base):
    __tablename__ = "feature_engineering_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    stage: Mapped[str] = mapped_column(String(64), nullable=False)
    original_features: Mapped[int | None] = mapped_column(Integer, nullable=True)
    transformed_features: Mapped[int | None] = mapped_column(Integer, nullable=True)
    contribution_by_type: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    config: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    task = relationship("Task", back_populates="feature_engineering_logs")


class FeatureSelectionLog(Base):
    __tablename__ = "feature_selection_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    stage: Mapped[str] = mapped_column(String(64), nullable=False)
    remaining_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    removed_features: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    importance_top30: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    task = relationship("Task", back_populates="feature_selection_logs")


class ModelResult(Base):
    __tablename__ = "model_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    model_name: Mapped[str] = mapped_column(String(128), nullable=False)
    best_params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    best_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    rank: Mapped[int | None] = mapped_column(Integer, nullable=True)

    task = relationship("Task", back_populates="model_results")


class EnsembleResult(Base):
    __tablename__ = "ensemble_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    stacking_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    blending_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    single_best_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    meta_learner: Mapped[str | None] = mapped_column(String(128), nullable=True)
    base_models: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    task = relationship("Task", back_populates="ensemble_results")


class SHAPResult(Base):
    __tablename__ = "shap_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    scope: Mapped[str] = mapped_column(String(32), nullable=False)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    task = relationship("Task", back_populates="shap_results")


class Pipeline(Base):
    __tablename__ = "pipelines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.datetime.utcnow
    )

    task = relationship("Task", back_populates="pipelines")
