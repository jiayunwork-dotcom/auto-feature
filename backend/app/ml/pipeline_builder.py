from __future__ import annotations

import logging

import numpy as np
import pandas as pd
import shap
import joblib
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.pipeline import Pipeline

from app.ml.explainability import ExplainabilityAnalyzer

logger = logging.getLogger(__name__)


class FeatureEngineeringTransformer(BaseEstimator, TransformerMixin):
    def __init__(self, feature_engineer=None, column_types: dict | None = None, target_column: str | None = None):
        self.feature_engineer = feature_engineer
        self.column_types = column_types or {}
        self.target_column = target_column
        self.metadata_: dict = {}

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        if self.feature_engineer is None:
            return X

        if isinstance(X, pd.DataFrame):
            result_df, metadata = self.feature_engineer.fit_transform(
                X, self.column_types, self.target_column or ""
            )
        else:
            df = pd.DataFrame(X)
            result_df, metadata = self.feature_engineer.fit_transform(
                df, self.column_types, self.target_column or ""
            )

        self.metadata_ = metadata
        return result_df


class FeatureSelectionTransformer(BaseEstimator, TransformerMixin):
    def __init__(self, feature_selector=None, task_type: str = "classification", original_feature_count: int = 0):
        self.feature_selector = feature_selector
        self.task_type = task_type
        self.original_feature_count = original_feature_count
        self.selected_features_: list[str] = []
        self.selection_log_: dict = {}

    def fit(self, X, y=None):
        if self.feature_selector is not None and y is not None:
            _, sel_log = self.feature_selector.fit_transform(
                X, y, self.task_type, self.original_feature_count
            )
            self.selected_features_ = sel_log.get("selected_features", [])
            self.selection_log_ = sel_log
        return self

    def transform(self, X):
        if not self.selected_features_:
            return X

        if isinstance(X, pd.DataFrame):
            existing = [c for c in self.selected_features_ if c in X.columns]
            return X[existing]
        else:
            df = pd.DataFrame(X)
            existing = [c for c in self.selected_features_ if c in df.columns]
            return df[existing]


class PipelineBuilder:
    def build_pipeline(
        self,
        feature_engineer,
        feature_selector,
        best_model,
        task_type: str,
        column_types: dict | None = None,
        target_column: str | None = None,
        original_feature_count: int = 0,
    ) -> Pipeline:
        fe_transformer = FeatureEngineeringTransformer(
            feature_engineer=feature_engineer,
            column_types=column_types,
            target_column=target_column,
        )

        fs_transformer = FeatureSelectionTransformer(
            feature_selector=feature_selector,
            task_type=task_type,
            original_feature_count=original_feature_count,
        )

        pipeline = Pipeline([
            ("feature_engineering", fe_transformer),
            ("feature_selection", fs_transformer),
            ("model", best_model),
        ])

        return pipeline

    def save_pipeline(self, pipeline: Pipeline, filepath: str) -> None:
        joblib.dump(pipeline, filepath)

    def load_pipeline(self, filepath: str) -> Pipeline:
        return joblib.load(filepath)

    def predict(self, pipeline: Pipeline, new_data_df: pd.DataFrame) -> dict:
        fe_step = pipeline.named_steps.get("feature_engineering")
        fs_step = pipeline.named_steps.get("feature_selection")
        model_step = pipeline.named_steps.get("model")

        transformed = fe_step.transform(new_data_df)

        selected = fs_step.transform(transformed)

        is_classification = hasattr(model_step, "predict_proba")

        if is_classification:
            predictions_proba = model_step.predict_proba(selected)
            predictions = model_step.predict(selected)
        else:
            predictions = model_step.predict(selected)
            predictions_proba = None

        shap_top5 = self._compute_shap_top5(model_step, selected)

        result = {
            "predictions": predictions.tolist() if isinstance(predictions, np.ndarray) else list(predictions),
        }

        if predictions_proba is not None:
            result["predictions_proba"] = predictions_proba.tolist() if isinstance(predictions_proba, np.ndarray) else list(predictions_proba)

        result["shap_top5_per_row"] = shap_top5

        return result

    def _compute_shap_top5(self, model, X) -> list[list[dict]]:
        try:
            analyzer = ExplainabilityAnalyzer()
            explainer = analyzer._create_explainer(model, X, "auto")
            shap_values = explainer(X)

            values = shap_values.values
            if values.ndim == 3:
                values = values[:, :, 0] if values.shape[2] == 1 else values.mean(axis=2)

            feature_names = (
                list(X.columns) if hasattr(X, "columns")
                else [f"feature_{i}" for i in range(values.shape[1])]
            )

            results: list[list[dict]] = []
            for i in range(len(values)):
                abs_vals = np.abs(values[i])
                top5_idx = np.argsort(abs_vals)[::-1][:5]
                row_shap = [
                    {
                        "feature": feature_names[idx],
                        "shap_value": float(values[i, idx]),
                        "abs_shap_value": float(abs_vals[idx]),
                    }
                    for idx in top5_idx
                ]
                results.append(row_shap)

            return results

        except Exception as e:
            logger.warning(f"SHAP computation failed during prediction: {e}")
            return []
