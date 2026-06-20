from __future__ import annotations

import numpy as np
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.model_selection import (
    KFold,
    StratifiedKFold,
    cross_val_score,
    train_test_split,
)


class EnsembleBuilder:
    def build(
        self,
        X,
        y,
        top_models_dict: dict[str, object],
        task_type: str,
    ) -> dict:
        is_classification = task_type == "classification"

        top3_names = list(top_models_dict.keys())[:3]
        top3_models = [top_models_dict[name] for name in top3_names]

        if len(top3_models) < 2:
            single_score = self._evaluate_single(top3_models[0], X, y, is_classification)
            return {
                "stacking_score": None,
                "blending_score": None,
                "single_best_score": single_score,
                "stacking_improvement_pct": None,
                "blending_improvement_pct": None,
                "base_model_names": top3_names,
                "meta_learner_name": None,
            }

        single_best_score = max(
            self._evaluate_single(m, X, y, is_classification) for m in top3_models
        )

        stacking_score = self._stacking(
            X, y, top3_models, is_classification
        )

        blending_score = self._blending(
            X, y, top3_models, is_classification
        )

        stacking_improvement = (
            (stacking_score - single_best_score) / abs(single_best_score) * 100
            if single_best_score != 0 and stacking_score is not None
            else None
        )
        blending_improvement = (
            (blending_score - single_best_score) / abs(single_best_score) * 100
            if single_best_score != 0 and blending_score is not None
            else None
        )

        meta_name = "LogisticRegression" if is_classification else "Ridge"

        return {
            "stacking_score": stacking_score,
            "blending_score": blending_score,
            "single_best_score": single_best_score,
            "stacking_improvement_pct": round(stacking_improvement, 4) if stacking_improvement is not None else None,
            "blending_improvement_pct": round(blending_improvement, 4) if blending_improvement is not None else None,
            "base_model_names": top3_names,
            "meta_learner_name": meta_name,
        }

    def _evaluate_single(
        self, model, X, y, is_classification: bool
    ) -> float:
        if is_classification:
            n_classes = len(np.unique(y))
            scoring = "roc_auc_ovr" if n_classes > 2 else "roc_auc"
            cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
        else:
            scoring = "neg_root_mean_squared_error"
            cv = KFold(n_splits=5, shuffle=True, random_state=42)

        scores = cross_val_score(model, X, y, cv=cv, scoring=scoring)
        mean_score = scores.mean()
        if not is_classification:
            mean_score = -mean_score
        return mean_score

    def _stacking(
        self,
        X,
        y,
        models: list,
        is_classification: bool,
    ) -> float | None:
        try:
            if is_classification:
                cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
            else:
                cv = KFold(n_splits=5, shuffle=True, random_state=42)

            meta_features = np.zeros((len(X), len(models)))

            for fold_idx, (train_idx, val_idx) in enumerate(cv.split(X, y)):
                X_train_fold = X.iloc[train_idx] if hasattr(X, "iloc") else X[train_idx]
                X_val_fold = X.iloc[val_idx] if hasattr(X, "iloc") else X[val_idx]
                y_train_fold = y[train_idx] if isinstance(y, np.ndarray) else y.iloc[train_idx]

                for model_idx, model in enumerate(models):
                    cloned = self._clone_model(model)
                    cloned.fit(X_train_fold, y_train_fold)

                    if is_classification and hasattr(cloned, "predict_proba"):
                        meta_features[val_idx, model_idx] = cloned.predict_proba(X_val_fold)[:, 1]
                    else:
                        meta_features[val_idx, model_idx] = cloned.predict(X_val_fold)

            if is_classification:
                meta_learner = LogisticRegression(max_iter=1000, random_state=42)
                scoring = "roc_auc"
                cv_meta = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
            else:
                meta_learner = Ridge(random_state=42)
                scoring = "neg_root_mean_squared_error"
                cv_meta = KFold(n_splits=5, shuffle=True, random_state=42)

            scores = cross_val_score(
                meta_learner, meta_features, y, cv=cv_meta, scoring=scoring
            )
            mean_score = scores.mean()
            if not is_classification:
                mean_score = -mean_score
            return mean_score

        except Exception:
            return None

    def _blending(
        self,
        X,
        y,
        models: list,
        is_classification: bool,
    ) -> float | None:
        try:
            if is_classification:
                X_train, X_val, y_train, y_val = train_test_split(
                    X, y, test_size=0.2, random_state=42, stratify=y
                )
            else:
                X_train, X_val, y_train, y_val = train_test_split(
                    X, y, test_size=0.2, random_state=42
                )

            if isinstance(y_train, np.ndarray):
                y_train_arr = y_train
            else:
                y_train_arr = y_train.to_numpy()

            val_predictions = np.zeros((len(X_val), len(models)))

            for model_idx, model in enumerate(models):
                cloned = self._clone_model(model)
                cloned.fit(X_train, y_train_arr)

                if is_classification and hasattr(cloned, "predict_proba"):
                    val_predictions[:, model_idx] = cloned.predict_proba(X_val)[:, 1]
                else:
                    val_predictions[:, model_idx] = cloned.predict(X_val)

            if is_classification:
                meta_learner = LogisticRegression(max_iter=1000, random_state=42)
            else:
                meta_learner = Ridge(random_state=42)

            if isinstance(y_val, np.ndarray):
                y_val_arr = y_val
            else:
                y_val_arr = y_val.to_numpy()

            meta_learner.fit(val_predictions, y_val_arr)

            if is_classification and hasattr(meta_learner, "predict_proba"):
                y_pred = meta_learner.predict_proba(val_predictions)
                n_classes = len(np.unique(y_val_arr))
                if n_classes > 2:
                    from sklearn.metrics import roc_auc_score
                    score = roc_auc_score(y_val_arr, y_pred, multi_class="ovr")
                else:
                    from sklearn.metrics import roc_auc_score
                    score = roc_auc_score(y_val_arr, y_pred[:, 1])
            else:
                from sklearn.metrics import root_mean_squared_error
                y_pred = meta_learner.predict(val_predictions)
                score = -root_mean_squared_error(y_val_arr, y_pred)

            return score

        except Exception:
            return None

    @staticmethod
    def _clone_model(model):
        from sklearn.base import clone
        return clone(model)
