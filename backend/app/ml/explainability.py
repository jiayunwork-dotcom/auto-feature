from __future__ import annotations

import logging

import numpy as np
import pandas as pd
import shap
from sklearn.ensemble import (
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.linear_model import LogisticRegression, Ridge, Lasso
from xgboost import XGBClassifier, XGBRegressor
from lightgbm import LGBMClassifier, LGBMRegressor

try:
    from catboost import CatBoostClassifier, CatBoostRegressor
    HAS_CATBOOST = True
except ImportError:
    HAS_CATBOOST = False

logger = logging.getLogger(__name__)

TREE_MODEL_TYPES = (
    RandomForestClassifier,
    RandomForestRegressor,
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    XGBClassifier,
    XGBRegressor,
    LGBMClassifier,
    LGBMRegressor,
)
if HAS_CATBOOST:
    TREE_MODEL_TYPES = TREE_MODEL_TYPES + (CatBoostClassifier, CatBoostRegressor)

LINEAR_MODEL_TYPES = (LogisticRegression, Ridge, Lasso)


class ExplainabilityAnalyzer:
    def compute_shap(
        self,
        model,
        X,
        task_type: str,
    ) -> dict:
        if len(X) > 5000:
            sample_idx = np.random.RandomState(42).choice(len(X), 1000, replace=False)
            X_sample = X.iloc[sample_idx] if hasattr(X, "iloc") else X[sample_idx]
        else:
            X_sample = X.copy()

        explainer = self._create_explainer(model, X_sample, task_type)
        shap_values = explainer(X_sample)

        feature_names = (
            list(X_sample.columns) if hasattr(X_sample, "columns")
            else [f"feature_{i}" for i in range(X_sample.shape[1])]
        )

        global_results = self._compute_global(shap_values, feature_names)
        beeswarm_data = self._compute_beeswarm(shap_values, X_sample, feature_names)
        local_results = self._compute_local(shap_values, feature_names)

        return {
            "global": global_results,
            "beeswarm": beeswarm_data,
            "local": local_results,
        }

    def _create_explainer(self, model, X_sample, task_type: str):
        if isinstance(model, TREE_MODEL_TYPES):
            return shap.TreeExplainer(model)
        elif isinstance(model, LINEAR_MODEL_TYPES):
            return shap.LinearExplainer(model, X_sample)
        else:
            background = shap.sample(X_sample, min(100, len(X_sample)))
            return shap.KernelExplainer(model.predict, background)

    def _compute_global(self, shap_values, feature_names: list[str]) -> dict:
        values = shap_values.values
        if values.ndim == 3:
            mean_abs = np.abs(values).mean(axis=(0, 2))
        else:
            mean_abs = np.abs(values).mean(axis=0)

        top_k = min(20, len(feature_names))
        top_indices = np.argsort(mean_abs)[::-1][:top_k]

        global_result = {}
        for idx in top_indices:
            global_result[feature_names[idx]] = float(mean_abs[idx])

        return global_result

    def _compute_beeswarm(
        self,
        shap_values,
        X_sample,
        feature_names: list[str],
    ) -> dict:
        values = shap_values.values
        if values.ndim == 3:
            mean_abs = np.abs(values).mean(axis=2)
        else:
            mean_abs = np.abs(values)

        mean_abs_per_feature = mean_abs.mean(axis=0)
        top_k = min(20, len(feature_names))
        top_indices = np.argsort(mean_abs_per_feature)[::-1][:top_k]

        beeswarm: dict[str, list] = {}
        for idx in top_indices:
            fname = feature_names[idx]
            feature_vals = (
                X_sample.iloc[:, idx].values if hasattr(X_sample, "iloc")
                else X_sample[:, idx]
            )
            shap_vals = mean_abs[:, idx]

            beeswarm[fname] = [
                {"feature_value": float(feature_vals[i]), "shap_value": float(shap_vals[i])}
                for i in range(len(feature_vals))
            ]

        return beeswarm

    def _compute_local(
        self,
        shap_values,
        feature_names: list[str],
    ) -> dict:
        values = shap_values.values
        base_values = shap_values.base_values

        if values.ndim == 3:
            values_2d = values[:, :, 0] if values.shape[2] == 1 else values.mean(axis=2)
        else:
            values_2d = values

        if base_values.ndim > 1:
            base_val = float(base_values[0].mean()) if base_values.ndim == 2 else float(base_values[0])
        else:
            base_val = float(base_values) if np.isscalar(base_values) else float(base_values[0])

        samples_data = []
        for i in range(len(values_2d)):
            sample_shap = {
                feature_names[j]: float(values_2d[i, j])
                for j in range(len(feature_names))
            }
            samples_data.append(sample_shap)

        return {
            "base_value": base_val,
            "samples": samples_data,
        }
