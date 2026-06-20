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
)
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
def drift_comparison_task(self, comparison_id: int):
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

            from app.services.drift_service import compare_versions

            result = compare_versions(
                df_a, df_b, columns_info_a, columns_info_b, progress_callback=_progress_cb
            )

            column_results = result["column_results"]
            added_columns = result["added_columns"]
            removed_columns = result["removed_columns"]

            common_count = len(column_results)
            significant_count = sum(1 for r in column_results if r["verdict"] == "显著漂移")
            significant_drift_ratio = significant_count / common_count if common_count > 0 else 0.0
            overall_warning = significant_drift_ratio > 0.2

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
