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
    quality_reports = relationship("DataQualityReport", back_populates="task", cascade="all, delete-orphan")
    dataset_versions = relationship("DatasetVersion", back_populates="task", cascade="all, delete-orphan")
    drift_comparisons = relationship("DriftComparison", back_populates="task", cascade="all, delete-orphan")
    drift_warnings = relationship("DriftWarning", back_populates="task", cascade="all, delete-orphan")
    auto_compare_strategy = relationship("AutoCompareStrategy", back_populates="task", uselist=False, cascade="all, delete-orphan")
    drift_report_exports = relationship("DriftReportExport", back_populates="task", cascade="all, delete-orphan")
    feature_attributions = relationship("FeatureAttribution", back_populates="task", cascade="all, delete-orphan")


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


class DataQualityReport(Base):
    __tablename__ = "data_quality_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    report_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.datetime.utcnow
    )

    task = relationship("Task", back_populates="quality_reports")


class DatasetVersion(Base):
    __tablename__ = "dataset_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    filename: Mapped[str] = mapped_column(String(256), nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False)
    column_count: Mapped[int] = mapped_column(Integer, nullable=False)
    file_hash_md5: Mapped[str] = mapped_column(String(32), nullable=False)
    columns_info: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.datetime.utcnow
    )

    task = relationship("Task", back_populates="dataset_versions")


class DriftComparison(Base):
    __tablename__ = "drift_comparisons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    version_a_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("dataset_versions.id"), nullable=True)
    version_b_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("dataset_versions.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    column_results: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    added_columns: Mapped[list | None] = mapped_column(JSON, nullable=True)
    removed_columns: Mapped[list | None] = mapped_column(JSON, nullable=True)
    overall_warning: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    significant_drift_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.datetime.utcnow
    )
    completed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    task = relationship("Task", back_populates="drift_comparisons")


class DriftWarning(Base):
    __tablename__ = "drift_warnings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    comparison_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("drift_comparisons.id"), nullable=True)
    warning_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    significant_columns: Mapped[list | None] = mapped_column(JSON, nullable=True)
    drift_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.datetime.utcnow
    )
    acknowledged_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)

    task = relationship("Task", back_populates="drift_warnings")


class AutoCompareStrategy(Base):
    __tablename__ = "auto_compare_strategies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, unique=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    trigger_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="on_upload")
    baseline_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="first_version")
    custom_p_value_threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    custom_psi_threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    custom_drift_ratio_threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    poll_interval_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True, default=60)
    last_triggered_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.datetime.utcnow
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )

    task = relationship("Task", back_populates="auto_compare_strategy")


class DriftReportExport(Base):
    __tablename__ = "drift_report_exports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    comparison_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("drift_comparisons.id", ondelete="CASCADE"), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.datetime.utcnow
    )
    completed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)

    task = relationship("Task", back_populates="drift_report_exports")
    comparison = relationship("DriftComparison")


class FeatureAttribution(Base):
    __tablename__ = "feature_attributions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    shap_values: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    interaction_matrix: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    feature_dag: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.datetime.utcnow
    )
    completed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)

    task = relationship("Task", back_populates="feature_attributions")
