from __future__ import annotations

import math

import numpy as np
import pandas as pd
from sklearn.feature_selection import RFE, VarianceThreshold
from sklearn.linear_model import Lasso, LogisticRegression
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.feature_selection import mutual_info_classif, mutual_info_regression


class FeatureSelector:
    def fit_transform(
        self,
        X,
        y,
        task_type: str,
        original_feature_count: int,
    ) -> tuple:
        selection_log: list[dict] = []
        feature_names = list(X.columns)
        X_current = X.copy()

        X_current, feature_names, log_entry = self._filter_stage(
            X_current, y, task_type, feature_names
        )
        selection_log.append(log_entry)

        X_current, feature_names, log_entry = self._wrapper_stage(
            X_current, y, task_type, feature_names, original_feature_count
        )
        selection_log.append(log_entry)

        X_current, feature_names, log_entry, final_model = self._embedded_stage(
            X_current, y, task_type, feature_names
        )
        selection_log.append(log_entry)

        importance_top30 = self._get_importance_top30(final_model, feature_names, task_type)

        return X_current, {
            "stages": selection_log,
            "importance_top30": importance_top30,
            "selected_features": feature_names,
        }

    def _filter_stage(
        self,
        X,
        y,
        task_type: str,
        feature_names: list[str],
    ) -> tuple:
        removed: list[str] = []

        vt = VarianceThreshold(threshold=0.0)
        vt.fit(X)
        zero_var_mask = vt.get_support()
        zero_var_removed = [
            name for name, kept in zip(feature_names, zero_var_mask) if not kept
        ]
        removed.extend(zero_var_removed)

        X_filtered = vt.transform(X)
        kept_names = [name for name, kept in zip(feature_names, zero_var_mask) if kept]

        if len(kept_names) > 0 and y is not None:
            mi_func = mutual_info_classif if task_type == "classification" else mutual_info_regression
            try:
                mi_scores = mi_func(X_filtered, y, random_state=42)
                zero_mi_mask = mi_scores > 0
                zero_mi_removed = [
                    name for name, kept in zip(kept_names, zero_mi_mask) if not kept
                ]
                removed.extend(zero_mi_removed)
                kept_names = [name for name, kept in zip(kept_names, zero_mi_mask) if kept]
                X_filtered = X_filtered[:, zero_mi_mask]
            except (ValueError, TypeError):
                pass

        result_df = pd.DataFrame(X_filtered, columns=kept_names, index=X.index)
        log_entry = {
            "stage": "filter",
            "remaining_count": len(kept_names),
            "removed_features": removed,
        }
        return result_df, kept_names, log_entry

    def _wrapper_stage(
        self,
        X,
        y,
        task_type: str,
        feature_names: list[str],
        original_feature_count: int,
    ) -> tuple:
        k = min(math.ceil(original_feature_count * 0.5), 100)
        k = max(k, 1)

        if task_type == "classification":
            estimator = RandomForestClassifier(
                n_estimators=100, random_state=42, n_jobs=-1
            )
        else:
            estimator = RandomForestRegressor(
                n_estimators=100, random_state=42, n_jobs=-1
            )

        n_features = X.shape[1]
        if n_features <= k:
            log_entry = {
                "stage": "wrapper",
                "remaining_count": n_features,
                "removed_features": [],
            }
            return X, feature_names, log_entry

        rfe = RFE(estimator=estimator, n_features_to_select=k, step=0.1)
        rfe.fit(X, y)
        selected_mask = rfe.get_support()
        removed = [
            name for name, kept in zip(feature_names, selected_mask) if not kept
        ]
        kept_names = [name for name, kept in zip(feature_names, selected_mask) if kept]

        result_df = X.loc[:, kept_names]
        log_entry = {
            "stage": "wrapper",
            "remaining_count": len(kept_names),
            "removed_features": removed,
        }
        return result_df, kept_names, log_entry

    def _embedded_stage(
        self,
        X,
        y,
        task_type: str,
        feature_names: list[str],
    ) -> tuple:
        if task_type == "classification":
            model = LogisticRegression(
                penalty="l1", solver="saga", C=1.0, max_iter=1000, random_state=42
            )
        else:
            model = Lasso(alpha=1.0, random_state=42)

        model.fit(X, y)

        if task_type == "classification":
            coef = np.abs(model.coef_).sum(axis=0) if model.coef_.ndim > 1 else np.abs(model.coef_)
        else:
            coef = np.abs(model.coef_)

        nonzero_mask = coef > 0
        removed = [
            name for name, kept in zip(feature_names, nonzero_mask) if not kept
        ]
        kept_names = [name for name, kept in zip(feature_names, nonzero_mask) if kept]

        if len(kept_names) == 0:
            kept_names = feature_names
            nonzero_mask = np.ones(len(feature_names), dtype=bool)

        result_df = X.loc[:, kept_names]
        log_entry = {
            "stage": "embedded",
            "remaining_count": len(kept_names),
            "removed_features": removed,
        }
        return result_df, kept_names, log_entry, model

    def _get_importance_top30(
        self,
        model,
        feature_names: list[str],
        task_type: str,
    ) -> dict:
        if task_type == "classification":
            coef = model.coef_
            if coef.ndim > 1:
                importance = np.abs(coef).sum(axis=0)
            else:
                importance = np.abs(coef)
        else:
            importance = np.abs(model.coef_)

        if len(importance) != len(feature_names):
            return {}

        indices = np.argsort(importance)[::-1]
        top_k = min(30, len(feature_names))
        top30 = {}
        for i in range(top_k):
            idx = indices[i]
            top30[feature_names[idx]] = float(importance[idx])

        return top30
