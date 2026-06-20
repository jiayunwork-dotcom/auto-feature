from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import stats


EPSILON = 1e-6


def compute_ks_test(series_a: pd.Series, series_b: pd.Series) -> dict:
    a = series_a.dropna().values
    b = series_b.dropna().values
    if len(a) == 0 or len(b) == 0:
        return {"statistic": 0.0, "p_value": 1.0, "method": "ks_test"}
    result = stats.ks_2samp(a, b)
    return {
        "statistic": float(result.statistic),
        "p_value": float(result.pvalue),
        "method": "ks_test",
    }


def compute_psi(expected: pd.Series, actual: pd.Series, n_bins: int = 10) -> dict:
    exp = expected.dropna()
    act = actual.dropna()

    if len(exp) == 0 or len(act) == 0:
        return {"psi": 0.0, "method": "psi"}

    is_numeric = pd.api.types.is_numeric_dtype(exp)

    if is_numeric:
        try:
            quantiles = np.linspace(0, 1, n_bins + 1)
            breakpoints = exp.quantile(quantiles).unique()
            breakpoints = np.sort(breakpoints)
            if len(breakpoints) < 2:
                breakpoints = np.array([float("-inf"), float("inf")])

            exp_counts = pd.cut(exp, bins=breakpoints, include_lowest=True).value_counts(sort=False)
            act_counts = pd.cut(act, bins=breakpoints, include_lowest=True).value_counts(sort=False)
        except Exception:
            exp_counts = exp.value_counts()
            act_counts = act.value_counts()
            all_cats = exp_counts.index.union(act_counts.index)
            exp_counts = exp_counts.reindex(all_cats, fill_value=0)
            act_counts = act_counts.reindex(all_cats, fill_value=0)
    else:
        exp_counts = exp.astype(str).value_counts()
        act_counts = act.astype(str).value_counts()
        all_cats = exp_counts.index.union(act_counts.index)
        exp_counts = exp_counts.reindex(all_cats, fill_value=0)
        act_counts = act_counts.reindex(all_cats, fill_value=0)

    exp_total = exp_counts.sum()
    act_total = act_counts.sum()

    if exp_total == 0 or act_total == 0:
        return {"psi": 0.0, "method": "psi"}

    exp_pct = exp_counts / exp_total
    act_pct = act_counts / act_total

    psi_value = 0.0
    for e_pct, a_pct in zip(exp_pct.values, act_pct.values):
        e = max(e_pct, EPSILON)
        a = max(a_pct, EPSILON)
        psi_value += (a - e) * math.log(a / e)

    return {"psi": float(psi_value), "method": "psi"}


def get_column_type_from_version(columns_info: dict, col_name: str) -> str:
    col_type = columns_info.get(col_name, "categorical")
    if col_type in ("numeric", "integer", "float", "int"):
        return "numeric"
    return "categorical"


def compute_visualization_data(series_a: pd.Series, series_b: pd.Series, col_type: str) -> dict:
    if col_type == "numeric":
        a = series_a.dropna().values
        b = series_b.dropna().values

        if len(a) < 2 or len(b) < 2:
            all_vals = np.concatenate([a, b]) if len(a) + len(b) > 0 else np.array([0.0, 1.0])
            if len(all_vals) < 2:
                all_vals = np.array([0.0, 1.0])
            x_min = float(np.min(all_vals))
            x_max = float(np.max(all_vals))
            if x_min == x_max:
                x_max = x_min + 1.0
            x = np.linspace(x_min, x_max, 100).tolist()
            density_a = [0.0] * len(x)
            density_b = [0.0] * len(x)
            return {
                "type": "density",
                "x": x,
                "density_a": density_a,
                "density_b": density_b,
            }

        try:
            kde_a = stats.gaussian_kde(a)
            kde_b = stats.gaussian_kde(b)

            all_vals = np.concatenate([a, b])
            x_min = float(np.min(all_vals))
            x_max = float(np.max(all_vals))
            margin = (x_max - x_min) * 0.1
            x_min -= margin
            x_max += margin
            if x_min == x_max:
                x_max = x_min + 1.0

            x = np.linspace(x_min, x_max, 200)
            density_a = kde_a(x).tolist()
            density_b = kde_b(x).tolist()

            return {
                "type": "density",
                "x": x.tolist(),
                "density_a": density_a,
                "density_b": density_b,
            }
        except Exception:
            all_vals = np.concatenate([a, b])
            x_min = float(np.min(all_vals))
            x_max = float(np.max(all_vals))
            if x_min == x_max:
                x_max = x_min + 1.0
            x = np.linspace(x_min, x_max, 100).tolist()
            return {
                "type": "density",
                "x": x,
                "density_a": [0.0] * len(x),
                "density_b": [0.0] * len(x),
            }
    else:
        a = series_a.dropna().astype(str)
        b = series_b.dropna().astype(str)

        counts_a = a.value_counts()
        counts_b = b.value_counts()

        all_cats = list(counts_a.index.union(counts_b.index))
        counts_a_list = [int(counts_a.get(cat, 0)) for cat in all_cats]
        counts_b_list = [int(counts_b.get(cat, 0)) for cat in all_cats]

        return {
            "type": "bar",
            "categories": all_cats,
            "counts_a": counts_a_list,
            "counts_b": counts_b_list,
        }


def compare_versions(
    df_a: pd.DataFrame,
    df_b: pd.DataFrame,
    columns_info_a: dict,
    columns_info_b: dict,
    progress_callback=None,
) -> dict:
    cols_a = set(df_a.columns)
    cols_b = set(df_b.columns)

    common_cols = sorted(cols_a & cols_b)
    added_cols = sorted(cols_b - cols_a)
    removed_cols = sorted(cols_a - cols_b)

    column_results = []
    total = len(common_cols)

    for idx, col_name in enumerate(common_cols):
        series_a = df_a[col_name]
        series_b = df_b[col_name]

        col_type_a = get_column_type_from_version(columns_info_a or {}, col_name)
        col_type_b = get_column_type_from_version(columns_info_b or {}, col_name)
        col_type = col_type_a if col_type_a == "numeric" else col_type_b

        if col_type == "numeric":
            method = "ks_test"
            ks_result = compute_ks_test(series_a, series_b)
            statistic = ks_result["statistic"]
            p_value_or_psi = ks_result["p_value"]
            if p_value_or_psi < 0.05:
                verdict = "显著漂移"
            else:
                verdict = "稳定"
        else:
            method = "psi"
            psi_result = compute_psi(series_a, series_b)
            statistic = None
            p_value_or_psi = psi_result["psi"]
            if p_value_or_psi > 0.2:
                verdict = "显著漂移"
            elif 0.1 <= p_value_or_psi <= 0.2:
                verdict = "轻微漂移"
            else:
                verdict = "稳定"

        viz_data = compute_visualization_data(series_a, series_b, col_type)

        column_results.append({
            "column_name": col_name,
            "column_type": col_type,
            "method": method,
            "statistic": statistic,
            "p_value_or_psi": p_value_or_psi,
            "verdict": verdict,
            "visualization_data": viz_data,
        })

        if progress_callback is not None:
            try:
                progress_callback(idx + 1, total)
            except Exception:
                pass

    return {
        "column_results": column_results,
        "added_columns": added_cols,
        "removed_columns": removed_cols,
    }
