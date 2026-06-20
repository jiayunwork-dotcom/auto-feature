from __future__ import annotations

import numpy as np
import pandas as pd


def analyze_missing_values(df: pd.DataFrame) -> dict:
    n_rows = len(df)
    if n_rows == 0:
        return {"columns": [], "correlated_groups": []}

    missing_counts = df.isnull().sum()
    columns_result = []
    for col in df.columns:
        missing_count = int(missing_counts[col])
        missing_ratio = float(missing_count / n_rows)
        risk_level = "normal"
        suggestion = None
        if missing_ratio > 0.7:
            risk_level = "suggest_delete"
            suggestion = "建议删除此列"
        elif missing_ratio > 0.3:
            risk_level = "high_risk"
            suggestion = "高风险缺失列"

        columns_result.append({
            "column": col,
            "missing_count": missing_count,
            "missing_ratio": round(missing_ratio, 4),
            "risk_level": risk_level,
            "suggestion": suggestion,
        })

    columns_with_missing = [col for col in df.columns if missing_counts[col] > 0]
    correlated_groups = []
    if len(columns_with_missing) > 1:
        missing_mask = df[columns_with_missing].isnull()
        visited = set()
        for i, col_a in enumerate(columns_with_missing):
            if col_a in visited:
                continue
            group = [col_a]
            mask_a = missing_mask[col_a]
            for col_b in columns_with_missing[i + 1:]:
                if col_b in visited:
                    continue
                mask_b = missing_mask[col_b]
                if mask_a.equals(mask_b):
                    group.append(col_b)
                    visited.add(col_b)
            if len(group) > 1:
                correlated_groups.append({
                    "columns": group,
                    "missing_count": int(missing_counts[group[0]]),
                    "label": "关联缺失",
                })
            visited.add(col_a)

    return {
        "columns": columns_result,
        "correlated_groups": correlated_groups,
    }


def detect_outliers(df: pd.DataFrame, numeric_cols: list[str]) -> dict:
    if not numeric_cols:
        return {"columns": []}

    columns_result = []
    for col in numeric_cols:
        series = df[col].dropna()
        if len(series) < 4:
            columns_result.append({
                "column": col,
                "outlier_count": 0,
                "outlier_ratio": 0.0,
                "q1": None,
                "q3": None,
                "iqr": None,
                "lower_bound": None,
                "upper_bound": None,
                "warning": False,
            })
            continue

        q1 = float(series.quantile(0.25))
        q3 = float(series.quantile(0.75))
        iqr = q3 - q1
        lower_bound = q1 - 1.5 * iqr
        upper_bound = q3 + 1.5 * iqr
        outlier_mask = (series < lower_bound) | (series > upper_bound)
        outlier_count = int(outlier_mask.sum())
        outlier_ratio = float(outlier_count / len(series))
        warning = outlier_ratio > 0.05

        columns_result.append({
            "column": col,
            "outlier_count": outlier_count,
            "outlier_ratio": round(outlier_ratio, 4),
            "q1": round(q1, 4),
            "q3": round(q3, 4),
            "iqr": round(iqr, 4),
            "lower_bound": round(lower_bound, 4),
            "upper_bound": round(upper_bound, 4),
            "warning": warning,
        })

    return {"columns": columns_result}


def _edit_distance(s1: str, s2: str) -> int:
    if len(s1) < len(s2):
        return _edit_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)
    prev_row = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        curr_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = prev_row[j + 1] + 1
            deletions = curr_row[j] + 1
            substitutions = prev_row[j] + (c1 != c2)
            curr_row.append(min(insertions, deletions, substitutions))
        prev_row = curr_row
    return prev_row[-1]


def check_consistency(df: pd.DataFrame, categorical_cols: list[str]) -> dict:
    if not categorical_cols:
        return {"columns": []}

    columns_result = []
    for col in categorical_cols:
        series = df[col].dropna().astype(str)
        if len(series) == 0:
            columns_result.append({
                "column": col,
                "inconsistency_count": 0,
                "issues": [],
            })
            continue

        issues = []
        unique_vals = series.unique()
        val_set = set(unique_vals)

        case_issues = set()
        lower_map: dict[str, list[str]] = {}
        for v in unique_vals:
            lv = v.lower()
            lower_map.setdefault(lv, []).append(v)
        for lv, variants in lower_map.items():
            if len(variants) > 1:
                for i in range(len(variants)):
                    for j in range(i + 1, len(variants)):
                        pair = tuple(sorted([variants[i], variants[j]]))
                        case_issues.add(pair)
        for pair in sorted(case_issues)[:3]:
            issues.append({
                "type": "case_inconsistency",
                "values": list(pair),
                "description": f"大小写不一致: {' vs '.join(pair)}",
            })

        space_issues = set()
        for v in unique_vals:
            stripped = v.strip()
            if v != stripped and stripped in val_set:
                pair = tuple(sorted([v, stripped]))
                space_issues.add(pair)
        for pair in sorted(space_issues)[:3]:
            issues.append({
                "type": "whitespace",
                "values": list(pair),
                "description": f"前后空格不一致: {' vs '.join(pair)}",
            })

        similar_issues = []
        checked = set()
        for i in range(len(unique_vals)):
            for j in range(i + 1, len(unique_vals)):
                v1, v2 = unique_vals[i], unique_vals[j]
                if v1.lower() == v2.lower():
                    continue
                key = tuple(sorted([v1, v2]))
                if key in checked:
                    continue
                checked.add(key)
                dist = _edit_distance(v1, v2)
                if dist <= 2 and dist > 0:
                    similar_issues.append((v1, v2, dist))
        for v1, v2, dist in sorted(similar_issues, key=lambda x: x[2])[:3]:
            issues.append({
                "type": "similar_string",
                "values": [v1, v2],
                "description": f"相似字符串(编辑距离={dist}): {v1} vs {v2}",
            })

        columns_result.append({
            "column": col,
            "inconsistency_count": len(case_issues) + len(space_issues) + len(similar_issues),
            "issues": issues[:3],
        })

    return {"columns": columns_result}


def analyze_uniqueness(df: pd.DataFrame) -> dict:
    n_rows = len(df)
    if n_rows == 0:
        return {"columns": []}

    columns_result = []
    for col in df.columns:
        nunique = int(df[col].nunique())
        unique_ratio = float(nunique / n_rows) if n_rows > 0 else 0.0
        category = "normal"
        suggestion = None
        if unique_ratio > 0.95:
            category = "suspected_id"
            suggestion = "疑似ID列,建议在建模前排除"
        elif nunique == 1:
            category = "constant"
            suggestion = "常量列,建议删除"

        columns_result.append({
            "column": col,
            "unique_count": nunique,
            "unique_ratio": round(unique_ratio, 4),
            "category": category,
            "suggestion": suggestion,
        })

    return {"columns": columns_result}


def compute_correlations(df: pd.DataFrame, numeric_cols: list[str]) -> dict:
    if len(numeric_cols) < 2:
        return {"pairs": []}

    corr_matrix = df[numeric_cols].corr(method="pearson")
    pairs = []
    for i in range(len(numeric_cols)):
        for j in range(i + 1, len(numeric_cols)):
            col_a = numeric_cols[i]
            col_b = numeric_cols[j]
            corr_val = corr_matrix.loc[col_a, col_b]
            if np.isnan(corr_val):
                continue
            is_high = abs(corr_val) > 0.95
            pairs.append({
                "column_a": col_a,
                "column_b": col_b,
                "correlation": round(float(corr_val), 4),
                "is_highly_collinear": is_high,
                "suggestion": "高度共线性,建议特征选择时优先去除其中一个" if is_high else None,
            })

    pairs.sort(key=lambda x: abs(x["correlation"]), reverse=True)
    return {"pairs": pairs}


def generate_quality_report(df: pd.DataFrame, column_types: dict[str, str]) -> dict:
    numeric_cols = [col for col in df.columns if column_types.get(col) == "numeric" and pd.api.types.is_numeric_dtype(df[col])]
    categorical_cols = [col for col in df.columns if column_types.get(col) == "categorical"]

    return {
        "missing_values": analyze_missing_values(df),
        "outliers": detect_outliers(df, numeric_cols),
        "consistency": check_consistency(df, categorical_cols),
        "uniqueness": analyze_uniqueness(df),
        "correlations": compute_correlations(df, numeric_cols),
    }
