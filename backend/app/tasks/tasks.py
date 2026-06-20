from __future__ import annotations

import datetime
import json
import logging
import os

import numpy as np
import pandas as pd
import redis
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import settings
from app.ml.feature_engineering import FeatureEngineer
from app.ml.feature_selection import FeatureSelector
from app.models.models import (
    ColumnInference,
    FeatureEngineeringLog,
    FeatureSelectionLog,
    ModelResult,
    EnsembleResult,
    SHAPResult,
    Pipeline as PipelineModel,
    Task,
    DataQualityReport,
    DriftComparison,
    DriftWarning,
    DatasetVersion,
    AutoCompareStrategy,
    DriftReportExport,
    FeatureAttribution,
)
from app.services.drift_service import compare_versions
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

SYNC_DB_URL = settings.DATABASE_URL.replace("+asyncpg", "+psycopg2")


def _get_sync_engine():
    from sqlalchemy import create_engine
    return create_engine(SYNC_DB_URL)


def _load_dataframe(task: Task) -> pd.DataFrame:
    upload_dir = settings.UPLOAD_DIR
    for f in os.listdir(upload_dir):
        filepath = os.path.join(upload_dir, f)
        if os.path.isfile(filepath):
            if filepath.endswith(".parquet"):
                return pd.read_parquet(filepath)
            elif filepath.endswith(".csv"):
                return pd.read_csv(filepath)
    raise FileNotFoundError(f"Data file for task {task.id} not found")


def _get_column_types(columns: list[ColumnInference]) -> dict[str, str]:
    return {c.column_name: c.confirmed_type or c.inferred_type for c in columns}


def _publish(task_id, stage, status, progress=None, detail=None):
    try:
        r = redis.from_url(settings.REDIS_URL)
        msg = {"stage": stage, "status": status}
        if progress is not None:
            msg["progress"] = progress
        if detail is not None:
            msg["detail"] = detail
        r.publish(f"task:{task_id}", json.dumps(msg))
        r.close()
    except Exception:
        pass


@celery_app.task(name="app.tasks.feature_engineering.run", bind=True)
def feature_engineering_task(self, task_id: int):
    engine = _get_sync_engine()
    with Session(engine) as session:
        task = session.get(Task, task_id)
        if not task:
            return

        _publish(task_id, "feature_engineering", "started")

        try:
            df = _load_dataframe(task)
            cols = session.query(ColumnInference).filter(
                ColumnInference.task_id == task_id
            ).all()
            column_types = _get_column_types(cols)

            config = {
                "polynomial_top_k": 10,
                "bin_counts": [5, 10, 20],
                "tfidf_max_features": 300,
            }

            fe = FeatureEngineer(config)
            transformed_df, metadata = fe.fit_transform(
                df, column_types, task.target_column
            )

            log_entry = FeatureEngineeringLog(
                task_id=task_id,
                stage="complete",
                original_features=metadata["original_features"],
                transformed_features=metadata["transformed_features"],
                contribution_by_type=metadata["contribution_by_type"],
                config=config,
            )
            session.add(log_entry)

            transformed_path = os.path.join(
                settings.UPLOAD_DIR, f"transformed_{task_id}.parquet"
            )
            transformed_df.to_parquet(transformed_path)

            fe_path = os.path.join(
                settings.PIPELINE_DIR, f"fe_{task_id}.joblib"
            )
            os.makedirs(settings.PIPELINE_DIR, exist_ok=True)
            import joblib
            joblib.dump(fe, fe_path)

            task.status = "feature_engineering_done"
            session.commit()

            _publish(task_id, "feature_engineering", "completed", progress=100,
                     detail=metadata)

        except Exception as e:
            logger.exception(f"Feature engineering failed for task {task_id}")
            task.status = "feature_engineering_failed"
            session.commit()
            _publish(task_id, "feature_engineering", "failed", detail={"error": str(e)})


@celery_app.task(name="app.tasks.feature_selection.run", bind=True)
def feature_selection_task(self, task_id: int):
    engine = _get_sync_engine()
    with Session(engine) as session:
        task = session.get(Task, task_id)
        if not task:
            return

        _publish(task_id, "feature_selection", "started")

        try:
            transformed_path = os.path.join(
                settings.UPLOAD_DIR, f"transformed_{task_id}.parquet"
            )
            X = pd.read_parquet(transformed_path)

            df = _load_dataframe(task)
            y = df[task.target_column].values

            if task.task_type == "classification":
                from sklearn.preprocessing import LabelEncoder
                le = LabelEncoder()
                y = le.fit_transform(y)

            fs = FeatureSelector()
            selected_X, selection_log = fs.fit_transform(
                X, y, task.task_type, X.shape[1]
            )

            for stage_log in selection_log.get("stages", []):
                log_entry = FeatureSelectionLog(
                    task_id=task_id,
                    stage=stage_log["stage"],
                    remaining_count=stage_log["remaining_count"],
                    removed_features=stage_log["removed_features"],
                )
                session.add(log_entry)

            importance_log = FeatureSelectionLog(
                task_id=task_id,
                stage="importance",
                remaining_count=len(selection_log.get("selected_features", [])),
                importance_top30=selection_log.get("importance_top30", {}),
            )
            session.add(importance_log)

            selected_path = os.path.join(
                settings.UPLOAD_DIR, f"selected_{task_id}.parquet"
            )
            selected_X.to_parquet(selected_path)

            fs_path = os.path.join(
                settings.PIPELINE_DIR, f"fs_{task_id}.joblib"
            )
            import joblib
            joblib.dump(fs, fs_path)

            task.status = "feature_selection_done"
            session.commit()

            _publish(task_id, "feature_selection", "completed", progress=100,
                     detail={"selected_features": len(selection_log.get("selected_features", [])),
                             "importance_top30": selection_log.get("importance_top30", {})})

        except Exception as e:
            logger.exception(f"Feature selection failed for task {task_id}")
            task.status = "feature_selection_failed"
            session.commit()
            _publish(task_id, "feature_selection", "failed", detail={"error": str(e)})


@celery_app.task(name="app.tasks.model_search.run", bind=True)
def model_search_task(self, task_id: int):
    engine = _get_sync_engine()
    with Session(engine) as session:
        task = session.get(Task, task_id)
        if not task:
            return

        _publish(task_id, "model_search", "started")

        try:
            selected_path = os.path.join(
                settings.UPLOAD_DIR, f"selected_{task_id}.parquet"
            )
            X = pd.read_parquet(selected_path)

            df = _load_dataframe(task)
            y = df[task.target_column].values

            if task.task_type == "classification":
                from sklearn.preprocessing import LabelEncoder
                le = LabelEncoder()
                y = le.fit_transform(y)

            from app.ml.model_search import ModelSearcher
            searcher = ModelSearcher(task_id=task_id)
            results = searcher.search(X, y, task.task_type, n_trials=50)

            for rank, r in enumerate(results, 1):
                model_result = ModelResult(
                    task_id=task_id,
                    model_name=r["model_name"],
                    best_params=r["best_params"],
                    best_score=r["best_score"],
                    rank=rank,
                )
                session.add(model_result)

            best_models_path = os.path.join(
                settings.PIPELINE_DIR, f"best_models_{task_id}.joblib"
            )
            import joblib

            from sklearn.base import clone
            from sklearn.linear_model import LogisticRegression
            from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
            from sklearn.neural_network import MLPClassifier, MLPRegressor
            from xgboost import XGBClassifier, XGBRegressor
            from lightgbm import LGBMClassifier, LGBMRegressor

            model_classes = {
                "LogisticRegression": (LogisticRegression, LogisticRegression),
                "RandomForest": (RandomForestClassifier, RandomForestRegressor),
                "XGBoost": (XGBClassifier, XGBRegressor),
                "LightGBM": (LGBMClassifier, LGBMRegressor),
                "MLP": (MLPClassifier, MLPRegressor),
            }

            try:
                from catboost import CatBoostClassifier, CatBoostRegressor
                model_classes["CatBoost"] = (CatBoostClassifier, CatBoostRegressor)
            except ImportError:
                pass

            trained_models = {}
            for r in results[:3]:
                name = r["model_name"]
                params = r["best_params"]
                is_cls = task.task_type == "classification"
                if name in model_classes:
                    cls = model_classes[name][0 if is_cls else 1]
                    model = cls(**params)
                    model.fit(X, y)
                    trained_models[name] = model

            joblib.dump(trained_models, best_models_path)

            task.status = "model_search_done"
            session.commit()

            _publish(task_id, "model_search", "completed", progress=100,
                     detail={"best_score": results[0]["best_score"] if results else None})

        except Exception as e:
            logger.exception(f"Model search failed for task {task_id}")
            task.status = "model_search_failed"
            session.commit()
            _publish(task_id, "model_search", "failed", detail={"error": str(e)})


@celery_app.task(name="app.tasks.ensemble.run", bind=True)
def ensemble_task(self, task_id: int):
    engine = _get_sync_engine()
    with Session(engine) as session:
        task = session.get(Task, task_id)
        if not task:
            return

        _publish(task_id, "ensemble", "started")

        try:
            import joblib

            selected_path = os.path.join(
                settings.UPLOAD_DIR, f"selected_{task_id}.parquet"
            )
            X = pd.read_parquet(selected_path)

            df = _load_dataframe(task)
            y = df[task.target_column].values

            if task.task_type == "classification":
                from sklearn.preprocessing import LabelEncoder
                le = LabelEncoder()
                y = le.fit_transform(y)

            best_models_path = os.path.join(
                settings.PIPELINE_DIR, f"best_models_{task_id}.joblib"
            )
            trained_models = joblib.load(best_models_path)

            from app.ml.ensemble import EnsembleBuilder
            builder = EnsembleBuilder()
            result = builder.build(X, y, trained_models, task.task_type)

            ensemble_result = EnsembleResult(
                task_id=task_id,
                stacking_score=result.get("stacking_score"),
                blending_score=result.get("blending_score"),
                single_best_score=result.get("single_best_score"),
                meta_learner=result.get("meta_learner_name"),
                base_models=result.get("base_model_names"),
            )
            session.add(ensemble_result)

            task.status = "ensemble_done"
            session.commit()

            _publish(task_id, "ensemble", "completed", progress=100, detail=result)

        except Exception as e:
            logger.exception(f"Ensemble failed for task {task_id}")
            task.status = "ensemble_failed"
            session.commit()
            _publish(task_id, "ensemble", "failed", detail={"error": str(e)})


@celery_app.task(name="app.tasks.explainability.run", bind=True)
def explainability_task(self, task_id: int):
    engine = _get_sync_engine()
    with Session(engine) as session:
        task = session.get(Task, task_id)
        if not task:
            return

        _publish(task_id, "explainability", "started")

        try:
            import joblib

            selected_path = os.path.join(
                settings.UPLOAD_DIR, f"selected_{task_id}.parquet"
            )
            X = pd.read_parquet(selected_path)

            best_models_path = os.path.join(
                settings.PIPELINE_DIR, f"best_models_{task_id}.joblib"
            )
            trained_models = joblib.load(best_models_path)
            best_model_name = list(trained_models.keys())[0]
            best_model = trained_models[best_model_name]

            from app.ml.explainability import ExplainabilityAnalyzer
            analyzer = ExplainabilityAnalyzer()
            shap_result = analyzer.compute_shap(best_model, X, task.task_type)

            global_shap = SHAPResult(
                task_id=task_id,
                scope="global",
                data=shap_result.get("global", {}),
            )
            session.add(global_shap)

            beeswarm_shap = SHAPResult(
                task_id=task_id,
                scope="beeswarm",
                data=shap_result.get("beeswarm", {}),
            )
            session.add(beeswarm_shap)

            local_shap = SHAPResult(
                task_id=task_id,
                scope="local",
                data=shap_result.get("local", {}),
            )
            session.add(local_shap)

            from app.ml.pipeline_builder import PipelineBuilder
            from app.ml.feature_engineering import FeatureEngineer
            from app.ml.feature_selection import FeatureSelector

            fe_path = os.path.join(settings.PIPELINE_DIR, f"fe_{task_id}.joblib")
            fs_path = os.path.join(settings.PIPELINE_DIR, f"fs_{task_id}.joblib")

            fe = joblib.load(fe_path) if os.path.exists(fe_path) else None
            fs = joblib.load(fs_path) if os.path.exists(fs_path) else None

            cols = session.query(ColumnInference).filter(
                ColumnInference.task_id == task_id
            ).all()
            column_types = _get_column_types(cols)

            pb = PipelineBuilder()
            pipeline = pb.build_pipeline(
                feature_engineer=fe,
                feature_selector=fs,
                best_model=best_model,
                task_type=task.task_type,
                column_types=column_types,
                target_column=task.target_column,
                original_feature_count=X.shape[1],
            )

            pipeline_path = os.path.join(
                settings.PIPELINE_DIR, f"pipeline_{task_id}.joblib"
            )
            pb.save_pipeline(pipeline, pipeline_path)

            pipeline_record = PipelineModel(
                task_id=task_id,
                file_path=pipeline_path,
            )
            session.add(pipeline_record)

            task.status = "completed"
            session.commit()

            _publish(task_id, "explainability", "completed", progress=100)

        except Exception as e:
            logger.exception(f"Explainability failed for task {task_id}")
            task.status = "explainability_failed"
            session.commit()
            _publish(task_id, "explainability", "failed", detail={"error": str(e)})


@celery_app.task(name="app.tasks.quality_report.run", bind=True)
def quality_report_task(self, task_id: int):
    engine = _get_sync_engine()
    with Session(engine) as session:
        task = session.get(Task, task_id)
        if not task:
            return

        report_record = DataQualityReport(
            task_id=task_id,
            status="running",
        )
        session.add(report_record)
        session.commit()
        session.refresh(report_record)

        report_id = report_record.id
        channel = f"quality_report:{task_id}"

        def _publish_report(stage: str, progress: int, data: dict | None = None):
            try:
                r = redis.from_url(settings.REDIS_URL)
                msg = {"stage": stage, "progress": progress, "report_id": report_id}
                if data is not None:
                    msg["data"] = data
                r.publish(channel, json.dumps(msg))
                r.close()
            except Exception:
                pass

        _publish_report("started", 0)

        try:
            df = _load_dataframe(task)
            cols = session.query(ColumnInference).filter(
                ColumnInference.task_id == task_id
            ).all()
            column_types = _get_column_types(cols)

            from app.services.quality_report_service import (
                analyze_missing_values,
                detect_outliers,
                check_consistency,
                analyze_uniqueness,
                compute_correlations,
            )

            _publish_report("missing_values", 10)
            missing_result = analyze_missing_values(df)

            _publish_report("missing_values", 20, {"missing_values": missing_result})

            numeric_cols = [col for col in df.columns if column_types.get(col) == "numeric" and pd.api.types.is_numeric_dtype(df[col])]
            categorical_cols = [col for col in df.columns if column_types.get(col) == "categorical"]

            _publish_report("outliers", 30)
            outlier_result = detect_outliers(df, numeric_cols)

            _publish_report("outliers", 45, {"outliers": outlier_result})

            _publish_report("consistency", 50)
            consistency_result = check_consistency(df, categorical_cols)

            _publish_report("consistency", 65, {"consistency": consistency_result})

            _publish_report("uniqueness", 70)
            uniqueness_result = analyze_uniqueness(df)

            _publish_report("uniqueness", 80, {"uniqueness": uniqueness_result})

            _publish_report("correlations", 85)
            correlation_result = compute_correlations(df, numeric_cols)

            report_data = {
                "missing_values": missing_result,
                "outliers": outlier_result,
                "consistency": consistency_result,
                "uniqueness": uniqueness_result,
                "correlations": correlation_result,
            }

            report_record = session.get(DataQualityReport, report_id)
            report_record.report_data = report_data
            report_record.status = "completed"
            session.commit()

            _publish_report("completed", 100, report_data)

        except Exception as e:
            logger.exception(f"Quality report generation failed for task {task_id}")
            report_record = session.get(DataQualityReport, report_id)
            if report_record:
                report_record.status = "failed"
                session.commit()
            _publish_report("failed", 0, {"error": str(e)})


@celery_app.task(name="app.tasks.drift_comparison.run", bind=True)
def drift_comparison_task(
    self,
    comparison_id: int,
    p_value_threshold: float | None = None,
    psi_threshold: float | None = None,
    drift_ratio_threshold: float | None = None,
):
    engine = _get_sync_engine()
    with Session(engine) as session:
        comparison = session.get(DriftComparison, comparison_id)
        if not comparison:
            return

        comparison.status = "running"
        session.commit()
        session.refresh(comparison)

        task_id = comparison.task_id
        channel = f"drift_comparison:{comparison_id}"

        def _publish_drift(stage: str, progress: int, data: dict | None = None):
            try:
                r = redis.from_url(settings.REDIS_URL)
                msg = {"stage": stage, "progress": progress, "comparison_id": comparison_id}
                if data is not None:
                    msg["data"] = data
                r.publish(channel, json.dumps(msg))
                r.close()
            except Exception:
                pass

        _publish_drift("started", 0)

        try:
            strategy = (
                session.query(AutoCompareStrategy)
                .filter(AutoCompareStrategy.task_id == task_id)
                .first()
            )

            if strategy:
                if p_value_threshold is None and strategy.custom_p_value_threshold is not None:
                    p_value_threshold = strategy.custom_p_value_threshold
                if psi_threshold is None and strategy.custom_psi_threshold is not None:
                    psi_threshold = strategy.custom_psi_threshold
                if drift_ratio_threshold is None and strategy.custom_drift_ratio_threshold is not None:
                    drift_ratio_threshold = strategy.custom_drift_ratio_threshold

            p_value_threshold = p_value_threshold if p_value_threshold is not None else 0.05
            psi_threshold_significant = psi_threshold if psi_threshold is not None else 0.2
            psi_threshold_mild = psi_threshold / 2 if psi_threshold is not None else 0.1
            drift_ratio_threshold = drift_ratio_threshold if drift_ratio_threshold is not None else 0.2

            version_a = session.get(DatasetVersion, comparison.version_a_id)
            version_b = session.get(DatasetVersion, comparison.version_b_id)

            if not version_a or not version_b:
                raise ValueError("Dataset version not found")

            _publish_drift("loading_data", 5)

            df_a = pd.read_csv(version_a.file_path)
            df_b = pd.read_csv(version_b.file_path)

            columns_info_a = version_a.columns_info or {}
            columns_info_b = version_b.columns_info or {}

            _publish_drift("comparing", 10)

            def _progress_cb(current: int, total: int):
                if total > 0:
                    pct = int(10 + (current / total) * 85)
                    _publish_drift("comparing", pct, {"current": current, "total": total})

            result = compare_versions(
                df_a,
                df_b,
                columns_info_a,
                columns_info_b,
                progress_callback=_progress_cb,
                p_value_threshold=p_value_threshold,
                psi_threshold_mild=psi_threshold_mild,
                psi_threshold_significant=psi_threshold_significant,
            )

            column_results = result["column_results"]
            added_columns = result["added_columns"]
            removed_columns = result["removed_columns"]

            common_count = len(column_results)
            significant_count = sum(1 for r in column_results if r["verdict"] == "显著漂移")
            significant_drift_ratio = significant_count / common_count if common_count > 0 else 0.0
            overall_warning = significant_drift_ratio > drift_ratio_threshold

            comparison = session.get(DriftComparison, comparison_id)
            comparison.column_results = {"columns": column_results}
            comparison.added_columns = added_columns
            comparison.removed_columns = removed_columns
            comparison.significant_drift_ratio = significant_drift_ratio
            comparison.overall_warning = overall_warning

            if overall_warning:
                significant_cols = [r["column_name"] for r in column_results if r["verdict"] == "显著漂移"]
                warning = DriftWarning(
                    task_id=task_id,
                    comparison_id=comparison_id,
                    warning_message="检测到显著数据漂移，建议重新训练模型",
                    significant_columns=significant_cols,
                    drift_ratio=significant_drift_ratio,
                    is_active=True,
                )
                session.add(warning)

            comparison.status = "completed"
            comparison.completed_at = datetime.datetime.utcnow()
            session.commit()

            _publish_drift("completed", 100, {
                "significant_drift_ratio": significant_drift_ratio,
                "overall_warning": overall_warning,
                "added_columns": added_columns,
                "removed_columns": removed_columns,
            })

        except Exception as e:
            logger.exception(f"Drift comparison failed for comparison {comparison_id}")
            comparison = session.get(DriftComparison, comparison_id)
            if comparison:
                comparison.status = "failed"
                comparison.error_message = str(e)
                session.commit()
            _publish_drift("failed", 0, {"error": str(e)})


@celery_app.task(name="app.tasks.auto_compare.poll")
def auto_compare_poll_task():
    engine = _get_sync_engine()
    with Session(engine) as session:
        strategies = session.query(AutoCompareStrategy).filter(
            AutoCompareStrategy.is_enabled == True,
            AutoCompareStrategy.trigger_mode == "scheduled"
        ).all()

        now = datetime.datetime.utcnow()

        for strategy in strategies:
            task_id = strategy.task_id
            interval_minutes = strategy.poll_interval_minutes or 60

            if strategy.last_triggered_at:
                elapsed = (now - strategy.last_triggered_at).total_seconds() / 60.0
                if elapsed < interval_minutes:
                    continue

            versions = session.query(DatasetVersion).filter(
                DatasetVersion.task_id == task_id
            ).order_by(DatasetVersion.version_number.asc()).all()

            if len(versions) < 2:
                continue

            latest_version = versions[-1]

            existing_comparison = session.query(DriftComparison).filter(
                DriftComparison.task_id == task_id,
                DriftComparison.version_b_id == latest_version.id
            ).first()

            if existing_comparison:
                strategy.last_triggered_at = now
                session.commit()
                continue

            if strategy.baseline_mode == "first_version":
                baseline_version = versions[0]
            else:
                baseline_version = versions[-2]

            if baseline_version.id == latest_version.id:
                strategy.last_triggered_at = now
                session.commit()
                continue

            comparison = DriftComparison(
                task_id=task_id,
                version_a_id=baseline_version.id,
                version_b_id=latest_version.id,
                status="pending",
            )
            session.add(comparison)
            strategy.last_triggered_at = now
            session.commit()
            session.refresh(comparison)

            drift_comparison_task.delay(comparison.id)


@celery_app.task(name="app.tasks.drift_report.export", bind=True)
def generate_drift_report_task(self, export_id: int):
    engine = _get_sync_engine()
    with Session(engine) as session:
        export_record = session.get(DriftReportExport, export_id)
        if not export_record:
            return

        export_record.status = "running"
        session.commit()
        session.refresh(export_record)

        channel = f"drift_report_export:{export_id}"

        try:
            from app.services.pdf_report_service import DriftPDFReportService
            result = DriftPDFReportService.generate_report(comparison_id=export_record.comparison_id)

            export_record = session.get(DriftReportExport, export_id)
            export_record.status = "completed"
            export_record.file_path = result.get("file_path")
            export_record.file_name = result.get("file_name")
            export_record.file_size = result.get("file_size")
            export_record.completed_at = datetime.datetime.utcnow()
            session.commit()

            download_url = f"/api/tasks/{export_record.task_id}/exports/{export_id}/download"
            try:
                r = redis.from_url(settings.REDIS_URL)
                msg = {
                    "status": "completed",
                    "download_url": download_url,
                    "export_id": export_id,
                }
                r.publish(channel, json.dumps(msg))
                r.close()
            except Exception:
                pass

        except Exception as e:
            logger.exception(f"Drift report export failed for export {export_id}")
            export_record = session.get(DriftReportExport, export_id)
            if export_record:
                export_record.status = "failed"
                export_record.error_message = str(e)
                session.commit()
            try:
                r = redis.from_url(settings.REDIS_URL)
                msg = {
                    "status": "failed",
                    "error_message": str(e),
                    "export_id": export_id,
                }
                r.publish(channel, json.dumps(msg))
                r.close()
            except Exception:
                pass


def trigger_auto_compare_on_upload(task_id: int, new_version_id: int):
    engine = _get_sync_engine()
    with Session(engine) as session:
        strategy = session.query(AutoCompareStrategy).filter(
            AutoCompareStrategy.task_id == task_id,
            AutoCompareStrategy.is_enabled == True,
            AutoCompareStrategy.trigger_mode == "on_upload"
        ).first()

        if not strategy:
            return

        versions = session.query(DatasetVersion).filter(
            DatasetVersion.task_id == task_id
        ).order_by(DatasetVersion.version_number.asc()).all()

        if len(versions) < 2:
            return

        if strategy.baseline_mode == "first_version":
            baseline_version = versions[0]
        else:
            baseline_version = versions[-2] if len(versions) >= 2 else versions[0]

        if baseline_version.id == new_version_id:
            return

        comparison = DriftComparison(
            task_id=task_id,
            version_a_id=baseline_version.id,
            version_b_id=new_version_id,
            status="pending",
        )
        session.add(comparison)
        strategy.last_triggered_at = datetime.datetime.utcnow()
        session.commit()
        session.refresh(comparison)

        drift_comparison_task.delay(comparison.id)


def _parse_feature_origin(feature_name: str, original_columns: list[str]) -> dict:
    for orig_col in original_columns:
        if feature_name == orig_col:
            return {"type": "original", "source": orig_col, "parents": [orig_col]}

    for orig_col in original_columns:
        if feature_name == f"{orig_col}_sq":
            return {"type": "polynomial_square", "source": orig_col, "parents": [orig_col], "operation": "square"}
        if feature_name == f"{orig_col}_log1p":
            return {"type": "log_transform", "source": orig_col, "parents": [orig_col], "operation": "log1p"}
        if feature_name == f"{orig_col}_zscore":
            return {"type": "standardization", "source": orig_col, "parents": [orig_col], "operation": "z-score"}
        if feature_name == f"{orig_col}_target_enc":
            return {"type": "target_encoding", "source": orig_col, "parents": [orig_col], "operation": "target_encode"}
        if feature_name == f"{orig_col}_freq":
            return {"type": "frequency_encoding", "source": orig_col, "parents": [orig_col], "operation": "frequency"}
        if feature_name.startswith(f"{orig_col}_bin"):
            return {"type": "binning", "source": orig_col, "parents": [orig_col], "operation": "quantile_bin"}
        if feature_name in [f"{orig_col}_year", f"{orig_col}_month", f"{orig_col}_day",
                            f"{orig_col}_dayofweek", f"{orig_col}_is_weekend",
                            f"{orig_col}_weekofyear", f"{orig_col}_hour", f"{orig_col}_days_from_max"]:
            part = feature_name[len(orig_col) + 1:]
            return {"type": "datetime_extract", "source": orig_col, "parents": [orig_col], "operation": f"extract_{part}"}
        if feature_name.startswith(f"{orig_col}_tfidf_"):
            return {"type": "tfidf", "source": orig_col, "parents": [orig_col], "operation": "tfidf_vectorizer"}
        if feature_name.startswith(f"{orig_col}_"):
            suffix = feature_name[len(orig_col) + 1:]
            if not any(c.isdigit() for c in suffix) and "_" not in suffix:
                return {"type": "one_hot", "source": orig_col, "parents": [orig_col], "operation": f"one_hot[{suffix}]"}

    for orig_a in original_columns:
        for orig_b in original_columns:
            if orig_a >= orig_b:
                continue
            if feature_name == f"{orig_a}_x_{orig_b}":
                return {"type": "cross_multiply", "source": None, "parents": [orig_a, orig_b], "operation": "multiply"}
            if feature_name == f"{orig_a}_div_{orig_b}":
                return {"type": "cross_divide", "source": None, "parents": [orig_a, orig_b], "operation": "divide"}

    return {"type": "unknown", "source": None, "parents": [], "operation": "unknown"}


def _build_feature_dag(
    selected_features: list[str],
    original_columns: list[str],
    feature_shap_means: dict[str, float],
) -> dict:
    nodes: list[dict] = []
    edges: list[dict] = []
    node_ids: set[str] = set()

    def _add_node(node_id: str, kind: str, label: str, weight: float | None = None):
        if node_id not in node_ids:
            node = {"id": node_id, "type": kind, "label": label}
            if weight is not None:
                node["weight"] = weight
            nodes.append(node)
            node_ids.add(node_id)

    def _add_edge(source: str, target: str, operation: str, weight: float | None = None):
        edge = {"source": source, "target": target, "operation": operation}
        if weight is not None:
            edge["weight"] = weight
        edges.append(edge)

    for feat in selected_features:
        feat_shap_val = abs(feature_shap_means.get(feat, 0.0))
        _add_node(feat, "selected_feature", feat, weight=feat_shap_val)

        origin = _parse_feature_origin(feat, original_columns)
        parents = origin.get("parents", [])
        operation = origin.get("operation", "transform")

        if len(parents) == 1:
            parent = parents[0]
            _add_node(parent, "original", parent)
            _add_edge(parent, feat, operation)
        elif len(parents) > 1:
            total_shap = feat_shap_val
            if total_shap > 0:
                parent_shaps = [abs(feature_shap_means.get(p, 0.0)) for p in parents]
                parent_sum = sum(parent_shaps) if sum(parent_shaps) > 0 else len(parents)
                weights = [s / parent_sum for s in parent_shaps]
            else:
                weights = [1.0 / len(parents) for _ in parents]

            for i, parent in enumerate(parents):
                _add_node(parent, "original", parent)
                _add_edge(parent, feat, operation, weight=weights[i])

    tree_data: dict[str, dict] = {}
    for feat in selected_features:
        origin = _parse_feature_origin(feat, original_columns)
        parents = origin.get("parents", [])
        feat_shap_val = abs(feature_shap_means.get(feat, 0.0))

        children = []
        if len(parents) > 1:
            total_shap = feat_shap_val
            if total_shap > 0:
                parent_shaps = [abs(feature_shap_means.get(p, 0.0)) for p in parents]
                parent_sum = sum(parent_shaps) if sum(parent_shaps) > 0 else len(parents)
                weights = [s / parent_sum for s in parent_shaps]
            else:
                weights = [1.0 / len(parents) for _ in parents]

            for i, p in enumerate(parents):
                children.append({
                    "name": p,
                    "type": "original",
                    "contribution_weight": weights[i],
                })
        elif len(parents) == 1:
            children.append({
                "name": parents[0],
                "type": "original",
                "contribution_weight": 1.0,
            })

        tree_data[feat] = {
            "name": feat,
            "type": "selected_feature",
            "operation": origin.get("operation", "transform"),
            "shap_importance": feat_shap_val,
            "children": children,
        }

    return {
        "nodes": nodes,
        "edges": edges,
        "tree": tree_data,
    }


@celery_app.task(name="app.tasks.feature_attribution.run", bind=True)
def feature_attribution_task(self, task_id: int):
    engine = _get_sync_engine()
    with Session(engine) as session:
        task = session.get(Task, task_id)
        if not task:
            return

        attribution_record = FeatureAttribution(
            task_id=task_id,
            status="running",
        )
        session.add(attribution_record)
        session.commit()
        session.refresh(attribution_record)

        attribution_id = attribution_record.id
        channel = f"feature_attribution:{task_id}"

        def _publish_attr(stage: str, progress: int, data: dict | None = None):
            try:
                r = redis.from_url(settings.REDIS_URL)
                msg = {"stage": stage, "progress": progress, "attribution_id": attribution_id}
                if data is not None:
                    msg["data"] = data
                r.publish(channel, json.dumps(msg))
                r.close()
            except Exception:
                pass

        _publish_attr("started", 0)

        try:
            selected_path = os.path.join(
                settings.UPLOAD_DIR, f"selected_{task_id}.parquet"
            )
            if not os.path.exists(selected_path):
                raise ValueError("Selected features dataset not found. Please complete feature selection first.")

            X_selected = pd.read_parquet(selected_path)
            selected_features = list(X_selected.columns)

            if len(selected_features) == 0:
                raise ValueError("selected_features is empty. Please complete feature selection first.")

            _publish_attr("loading_model", 10)

            best_models_path = os.path.join(
                settings.PIPELINE_DIR, f"best_models_{task_id}.joblib"
            )
            if not os.path.exists(best_models_path):
                raise ValueError(f"Model file not found at {best_models_path}")

            import joblib
            try:
                trained_models = joblib.load(best_models_path)
            except Exception as e:
                raise ValueError(f"Failed to load model: {str(e)}")

            if not trained_models:
                raise ValueError("No trained models found in pipeline")

            best_model_name = list(trained_models.keys())[0]
            best_model = trained_models[best_model_name]

            _publish_attr("loading_data", 20)

            df = _load_dataframe(task)
            y = df[task.target_column].values

            if task.task_type == "classification":
                from sklearn.preprocessing import LabelEncoder
                le = LabelEncoder()
                y = le.fit_transform(y)

            n_samples = len(X_selected)
            if n_samples > 5000:
                rng = np.random.RandomState(42)
                sample_idx = rng.choice(n_samples, 5000, replace=False)
                X_sample = X_selected.iloc[sample_idx]
            else:
                X_sample = X_selected.copy()

            _publish_attr("computing_shap", 30)

            import shap
            from sklearn.ensemble import (
                GradientBoostingClassifier, GradientBoostingRegressor,
                RandomForestClassifier, RandomForestRegressor,
            )
            from xgboost import XGBClassifier, XGBRegressor
            from lightgbm import LGBMClassifier, LGBMRegressor
            try:
                from catboost import CatBoostClassifier, CatBoostRegressor
                HAS_CATBOOST = True
            except ImportError:
                HAS_CATBOOST = False

            TREE_TYPES = (
                RandomForestClassifier, RandomForestRegressor,
                GradientBoostingClassifier, GradientBoostingRegressor,
                XGBClassifier, XGBRegressor,
                LGBMClassifier, LGBMRegressor,
            )
            if HAS_CATBOOST:
                TREE_TYPES = TREE_TYPES + (CatBoostClassifier, CatBoostRegressor)

            if isinstance(best_model, TREE_TYPES):
                explainer = shap.TreeExplainer(best_model)
            else:
                background = shap.sample(X_sample, min(100, len(X_sample)), random_state=42)
                explainer = shap.KernelExplainer(best_model.predict, background)

            shap_values_obj = explainer(X_sample)
            shap_values_raw = shap_values_obj.values

            if shap_values_raw.ndim == 3:
                shap_values_2d = shap_values_raw.mean(axis=2)
            else:
                shap_values_2d = shap_values_raw

            feature_names = list(X_sample.columns)
            shap_abs_mean = np.abs(shap_values_2d).mean(axis=0)

            sorted_indices = np.argsort(shap_abs_mean)[::-1]
            global_importance = [
                {"feature": feature_names[i], "shap_value": float(shap_abs_mean[i])}
                for i in sorted_indices
            ]

            per_feature_shap: dict[str, list[float]] = {}
            for j, fname in enumerate(feature_names):
                per_feature_shap[fname] = [float(v) for v in shap_values_2d[:, j]]

            shap_values_result = {
                "global_importance": global_importance,
                "feature_names": feature_names,
                "sample_count": len(X_sample),
                "per_feature_mean": {fname: float(shap_abs_mean[j]) for j, fname in enumerate(feature_names)},
            }

            _publish_attr("computing_interactions", 60)

            interaction_matrix_result: dict = {}
            try:
                if isinstance(best_model, TREE_TYPES):
                    interaction_values = explainer.shap_interaction_values(X_sample)
                    if isinstance(interaction_values, list):
                        iv = np.mean(np.stack(interaction_values), axis=0)
                    else:
                        iv = interaction_values

                    if iv.ndim == 4:
                        iv = iv.mean(axis=3)

                    n_feat = len(feature_names)
                    interaction_strength = np.zeros((n_feat, n_feat))
                    for i in range(n_feat):
                        for j in range(n_feat):
                            if i != j:
                                interaction_strength[i, j] = np.abs(iv[:, i, j]).mean()

                    top_k = min(5, n_feat)
                    top_indices = np.argsort(shap_abs_mean)[::-1][:top_k]

                    top_matrix = []
                    for i in top_indices:
                        row = []
                        for j in top_indices:
                            row.append(float(interaction_strength[i, j]))
                        top_matrix.append(row)

                    pairs: list[tuple[int, int, float]] = []
                    for i in range(n_feat):
                        for j in range(i + 1, n_feat):
                            pairs.append((i, j, float(interaction_strength[i, j])))
                    pairs.sort(key=lambda x: x[2], reverse=True)
                    top_5_pairs = [
                        {
                            "feature_a": feature_names[p[0]],
                            "feature_b": feature_names[p[1]],
                            "strength": p[2],
                        }
                        for p in pairs[:5]
                    ]

                    interaction_matrix_result = {
                        "top_features": [feature_names[i] for i in top_indices],
                        "matrix": top_matrix,
                        "top_5_pairs": top_5_pairs,
                    }
                else:
                    interaction_matrix_result = {
                        "top_features": feature_names[:min(5, len(feature_names))],
                        "matrix": [],
                        "top_5_pairs": [],
                        "note": "Interaction values only supported for tree-based models (TreeExplainer)",
                    }
            except Exception as e:
                logger.warning(f"Interaction computation failed: {e}")
                interaction_matrix_result = {
                    "top_features": feature_names[:min(5, len(feature_names))],
                    "matrix": [],
                    "top_5_pairs": [],
                    "error": str(e),
                }

            _publish_attr("building_dag", 85)

            cols = session.query(ColumnInference).filter(
                ColumnInference.task_id == task_id
            ).all()
            original_columns = [c.column_name for c in cols if c.column_name != task.target_column]

            feature_shap_means = {fname: float(shap_abs_mean[j]) for j, fname in enumerate(feature_names)}
            dag_result = _build_feature_dag(selected_features, original_columns, feature_shap_means)

            attribution_record = session.get(FeatureAttribution, attribution_id)
            attribution_record.shap_values = shap_values_result
            attribution_record.interaction_matrix = interaction_matrix_result
            attribution_record.feature_dag = dag_result
            attribution_record.status = "completed"
            attribution_record.completed_at = datetime.datetime.utcnow()
            session.commit()

            _publish_attr("completed", 100, {
                "attribution_id": attribution_id,
            })

        except Exception as e:
            logger.exception(f"Feature attribution failed for task {task_id}")
            attribution_record = session.get(FeatureAttribution, attribution_id)
            if attribution_record:
                attribution_record.status = "failed"
                attribution_record.error_message = str(e)
                session.commit()
            _publish_attr("failed", 0, {"error": str(e)})
