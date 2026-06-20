import re

import pandas as pd


def infer_column_types(df: pd.DataFrame) -> list[dict]:
    results = []
    n_rows = len(df)
    for col in df.columns:
        series = df[col]
        inferred_type = _infer_single_column(series, n_rows)
        unique_count = int(series.nunique())
        missing_ratio = float(series.isnull().sum() / n_rows) if n_rows > 0 else 0.0

        results.append({
            "column_name": col,
            "inferred_type": inferred_type,
            "unique_count": unique_count,
            "missing_ratio": round(missing_ratio, 4),
        })
    return results


def _infer_single_column(series: pd.Series, n_rows: int) -> str:
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"

    if pd.api.types.is_numeric_dtype(series):
        return "numeric"

    sample = series.dropna()
    if len(sample) == 0:
        return "categorical"

    nunique = series.nunique()
    categorical_threshold = max(int(0.05 * n_rows), 50)

    if _is_datetime_column(sample, n_rows):
        return "datetime"

    if nunique <= categorical_threshold:
        return "categorical"

    avg_len = sample.astype(str).str.len().mean()
    if avg_len > 50:
        return "text"

    return "categorical"


def _is_datetime_column(sample: pd.Series, n_rows: int) -> bool:
    if len(sample) == 0:
        return False

    try:
        converted = pd.to_datetime(sample, errors="coerce")
        valid_count = converted.notna().sum()
        total_count = len(sample)
        if total_count > 0 and (valid_count / total_count) >= 0.8:
            return True
    except (ValueError, TypeError, OverflowError):
        pass

    datetime_count = 0
    sample_size = min(100, len(sample))
    for val in sample.head(sample_size):
        val_str = str(val)
        if _is_datetime_string(val_str):
            datetime_count += 1

    return sample_size > 0 and (datetime_count / sample_size) > 0.7


_DATE_PATTERNS = [
    re.compile(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}(\s+\d{1,2}:\d{2}(:\d{2})?)?$"),
    re.compile(r"^\d{1,2}[-/]\d{1,2}[-/]\d{4}(\s+\d{1,2}:\d{2}(:\d{2})?)?$"),
    re.compile(r"^\d{4}年\d{1,2}月\d{1,2}日$"),
    re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$"),
]


def _is_datetime_string(s: str) -> bool:
    s = s.strip()
    if not s:
        return False

    for pattern in _DATE_PATTERNS:
        if pattern.match(s):
            return True

    try:
        result = pd.to_datetime(s, errors="raise")
        if pd.isna(result):
            return False
        return True
    except (ValueError, TypeError, OverflowError):
        return False


def auto_detect_target(columns: list[str]) -> str | None:
    target_keywords = ["target", "label", "y", "class", "outcome", "response", "default"]
    for col in columns:
        col_lower = col.lower().strip()
        for keyword in target_keywords:
            if keyword in col_lower:
                return col
    return None
