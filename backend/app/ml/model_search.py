from __future__ import annotations

import json
import logging

import numpy as np
import optuna
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.model_selection import StratifiedKFold, KFold, cross_val_score
from sklearn.neural_network import MLPClassifier, MLPRegressor
from xgboost import XGBClassifier, XGBRegressor
from lightgbm import LGBMClassifier, LGBMRegressor

try:
    from catboost import CatBoostClassifier, CatBoostRegressor
    HAS_CATBOOST = True
except ImportError:
    HAS_CATBOOST = False

import redis

from app.core.config import settings

logger = logging.getLogger(__name__)


class ModelSearcher:
    def __init__(self, task_id: int | None = None) -> None:
        self.task_id = task_id
        self._redis_client: redis.Redis | None = None

    def _get_redis(self) -> redis.Redis | None:
        try:
            if self._redis_client is None:
                self._redis_client = redis.from_url(settings.REDIS_URL)
            return self._redis_client
        except Exception:
            return None

    def _publish_progress(
        self, model_name: str, trial_number: int, max_trials: int, best_score: float
    ) -> None:
        if self.task_id is None:
            return
        try:
            r = self._get_redis()
            if r is None:
                return
            message = json.dumps({
                "stage": "model_search",
                "status": "progress",
                "detail": {
                    "model_name": model_name,
                    "trial_number": trial_number,
                    "max_trials": max_trials,
                    "best_score": round(best_score, 6),
                },
            })
            r.publish(f"task:{self.task_id}", message)
        except Exception:
            pass

    def search(
        self,
        X,
        y,
        task_type: str,
        n_trials: int = 50,
    ) -> list[dict]:
        is_classification = task_type == "classification"

        candidates = self._get_candidates(is_classification)
        results: list[dict] = []

        for model_name, model_cls, search_space in candidates:
            try:
                best_params, best_score = self._optimize_model(
                    X, y, model_name, model_cls, search_space,
                    is_classification, n_trials,
                )
                results.append({
                    "model_name": model_name,
                    "best_params": best_params,
                    "best_score": best_score,
                })
            except Exception as e:
                logger.warning(f"Model {model_name} search failed: {e}")
                continue

        results.sort(key=lambda r: r["best_score"], reverse=True)
        return results

    def _get_candidates(self, is_classification: bool) -> list[tuple]:
        candidates = [
            (
                "LogisticRegression",
                LogisticRegression if is_classification else LogisticRegression,
                self._lr_space,
            ),
            (
                "RandomForest",
                RandomForestClassifier if is_classification else RandomForestRegressor,
                self._rf_space,
            ),
            (
                "XGBoost",
                XGBClassifier if is_classification else XGBRegressor,
                self._xgb_space,
            ),
            (
                "LightGBM",
                LGBMClassifier if is_classification else LGBMRegressor,
                self._lgbm_space,
            ),
            (
                "MLP",
                MLPClassifier if is_classification else MLPRegressor,
                self._mlp_space,
            ),
        ]

        if HAS_CATBOOST:
            candidates.insert(4, (
                "CatBoost",
                CatBoostClassifier if is_classification else CatBoostRegressor,
                self._catboost_space,
            ))

        return candidates

    def _optimize_model(
        self,
        X,
        y,
        model_name: str,
        model_cls,
        search_space,
        is_classification: bool,
        n_trials: int,
    ) -> tuple[dict, float]:
        def objective(trial: optuna.Trial) -> float:
            params = search_space(trial)
            model = model_cls(**params)

            if is_classification:
                n_classes = len(np.unique(y))
                if n_classes > 2:
                    scoring = "roc_auc_ovr"
                else:
                    scoring = "roc_auc"
                cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
            else:
                scoring = "neg_root_mean_squared_error"
                cv = KFold(n_splits=5, shuffle=True, random_state=42)

            scores = cross_val_score(model, X, y, cv=cv, scoring=scoring, n_jobs=-1)
            mean_score = scores.mean()

            if not is_classification:
                mean_score = -mean_score

            trial_number = trial.number + 1
            study = trial.study
            best_so_far = study.best_value if study.best_value is not None else mean_score
            if not is_classification and study.best_value is not None:
                best_so_far = -best_so_far

            self._publish_progress(
                model_name, trial_number, n_trials, best_so_far
            )

            if is_classification:
                return mean_score
            else:
                return -mean_score

        sampler = optuna.samplers.TPESampler(seed=42)
        pruner = optuna.pruners.MedianPruner()
        study = optuna.create_study(
            direction="maximize",
            sampler=sampler,
            pruner=pruner,
        )
        study.optimize(objective, n_trials=n_trials, show_progress_bar=False)

        best_params = study.best_params
        best_score = study.best_value

        if not is_classification:
            best_score = -best_score

        return best_params, best_score

    @staticmethod
    def _lr_space(trial: optuna.Trial) -> dict:
        return {
            "C": trial.suggest_float("C", 0.01, 100.0, log=True),
            "penalty": trial.suggest_categorical("penalty", ["l1", "l2"]),
            "solver": "saga",
            "max_iter": 1000,
            "random_state": 42,
        }

    @staticmethod
    def _rf_space(trial: optuna.Trial) -> dict:
        return {
            "n_estimators": trial.suggest_int("n_estimators", 50, 500),
            "max_depth": trial.suggest_int("max_depth", 3, 20),
            "min_samples_split": trial.suggest_int("min_samples_split", 2, 20),
            "min_samples_leaf": trial.suggest_int("min_samples_leaf", 1, 10),
            "random_state": 42,
            "n_jobs": -1,
        }

    @staticmethod
    def _xgb_space(trial: optuna.Trial) -> dict:
        return {
            "n_estimators": trial.suggest_int("n_estimators", 50, 500),
            "max_depth": trial.suggest_int("max_depth", 3, 10),
            "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.3),
            "subsample": trial.suggest_float("subsample", 0.6, 1.0),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.6, 1.0),
            "random_state": 42,
            "n_jobs": -1,
            "verbosity": 0,
        }

    @staticmethod
    def _lgbm_space(trial: optuna.Trial) -> dict:
        return {
            "n_estimators": trial.suggest_int("n_estimators", 50, 500),
            "max_depth": trial.suggest_int("max_depth", 3, 10),
            "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.3),
            "num_leaves": trial.suggest_int("num_leaves", 15, 63),
            "subsample": trial.suggest_float("subsample", 0.6, 1.0),
            "random_state": 42,
            "n_jobs": -1,
            "verbose": -1,
        }

    @staticmethod
    def _catboost_space(trial: optuna.Trial) -> dict:
        return {
            "iterations": trial.suggest_int("iterations", 50, 500),
            "depth": trial.suggest_int("depth", 3, 10),
            "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.3),
            "l2_leaf_reg": trial.suggest_int("l2_leaf_reg", 1, 10),
            "random_state": 42,
            "verbose": 0,
        }

    @staticmethod
    def _mlp_space(trial: optuna.Trial) -> dict:
        hidden_choices = [(50,), (100,), (50, 50), (100, 50)]
        return {
            "hidden_layer_sizes": trial.suggest_categorical(
                "hidden_layer_sizes", hidden_choices
            ),
            "alpha": trial.suggest_float("alpha", 1e-5, 1e-1, log=True),
            "learning_rate_init": trial.suggest_float("learning_rate_init", 0.001, 0.1),
            "max_iter": 500,
            "random_state": 42,
        }
