from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.model_selection import KFold
from sklearn.preprocessing import StandardScaler


class FeatureEngineer:
    def __init__(self, config: dict) -> None:
        self.config = config
        self.scaler: StandardScaler | None = None
        self.target_encoding_maps_: dict[str, dict] = {}
        self.freq_encoding_maps_: dict[str, dict] = {}
        self.tfidf_vectorizers_: dict[str, TfidfVectorizer] = {}
        self.max_dates_: dict[str, pd.Timestamp] = {}
        self.top_k_pairs_: list[tuple[str, str]] = []
        self.top_5_pairs_: list[tuple[str, str]] = []

    def fit_transform(
        self,
        df: pd.DataFrame,
        column_types: dict[str, str],
        target_column: str,
    ) -> tuple[pd.DataFrame, dict]:
        original_features = len(df.columns)
        contribution_by_type: dict[str, int] = {}
        result_parts: list[pd.DataFrame] = []

        numeric_cols = [
            c for c, t in column_types.items()
            if t == "numeric" and c != target_column
        ]
        categorical_cols = [
            c for c, t in column_types.items()
            if t == "categorical" and c != target_column
        ]
        datetime_cols = [
            c for c, t in column_types.items()
            if t == "datetime" and c != target_column
        ]
        text_cols = [
            c for c, t in column_types.items()
            if t == "text" and c != target_column
        ]

        df_work = df.copy()

        if numeric_cols:
            num_result = self._transform_numeric(df_work, numeric_cols, target_column)
            contribution_by_type["numeric"] = num_result.shape[1]
            result_parts.append(num_result)
        else:
            contribution_by_type["numeric"] = 0

        if categorical_cols:
            cat_result = self._transform_categorical(df_work, categorical_cols, target_column)
            contribution_by_type["categorical"] = cat_result.shape[1]
            result_parts.append(cat_result)
        else:
            contribution_by_type["categorical"] = 0

        if datetime_cols:
            dt_result = self._transform_datetime(df_work, datetime_cols)
            contribution_by_type["datetime"] = dt_result.shape[1]
            result_parts.append(dt_result)
        else:
            contribution_by_type["datetime"] = 0

        if text_cols:
            text_result = self._transform_text(df_work, text_cols)
            contribution_by_type["text"] = text_result.shape[1]
            result_parts.append(text_result)
        else:
            contribution_by_type["text"] = 0

        if len(result_parts) > 0:
            transformed_df = pd.concat(result_parts, axis=1)
        else:
            transformed_df = pd.DataFrame(index=df_work.index)

        if self.top_5_pairs_ and numeric_cols:
            cross_result = self._transform_cross(df_work)
            contribution_by_type["cross"] = cross_result.shape[1]
            transformed_df = pd.concat([transformed_df, cross_result], axis=1)
        else:
            contribution_by_type["cross"] = 0

        transformed_df = transformed_df.replace([np.inf, -np.inf], np.nan)
        transformed_df = transformed_df.fillna(0)

        metadata = {
            "original_features": original_features,
            "transformed_features": transformed_df.shape[1],
            "contribution_by_type": contribution_by_type,
        }

        return transformed_df, metadata

    def _transform_numeric(
        self,
        df: pd.DataFrame,
        numeric_cols: list[str],
        target_column: str,
    ) -> pd.DataFrame:
        parts: list[pd.DataFrame] = []
        num_df = df[numeric_cols].copy()

        corr_matrix = num_df.corr().abs()
        if target_column in df.columns and df[target_column].dtype in [np.float64, np.int64, float, int]:
            target_corr = df[numeric_cols].corrwith(df[target_column].astype(float)).abs()
            top_k = min(self.config.get("polynomial_top_k", 10), len(numeric_cols))
            top_cols = target_corr.nlargest(top_k).index.tolist()
        else:
            top_cols = numeric_cols[:self.config.get("polynomial_top_k", 10)]

        poly_result = pd.DataFrame(index=df.index)
        self.top_k_pairs_ = []
        for i in range(len(top_cols)):
            for j in range(i + 1, len(top_cols)):
                self.top_k_pairs_.append((top_cols[i], top_cols[j]))
                poly_result[f"{top_cols[i]}_x_{top_cols[j]}"] = (
                    df[top_cols[i]] * df[top_cols[j]]
                )
        for col in top_cols:
            poly_result[f"{col}_sq"] = df[col] ** 2
        parts.append(poly_result)

        bins_list = self.config.get("bin_counts", [5, 10, 20])
        bin_result = pd.DataFrame(index=df.index)
        for col in numeric_cols:
            for n_bins in bins_list:
                try:
                    bin_result[f"{col}_bin{n_bins}"] = pd.qcut(
                        df[col], q=n_bins, labels=False, duplicates="drop"
                    )
                except (ValueError, TypeError):
                    pass
        parts.append(bin_result)

        log_result = pd.DataFrame(index=df.index)
        for col in numeric_cols:
            if (df[col] > 0).all():
                log_result[f"{col}_log1p"] = np.log1p(df[col])
        parts.append(log_result)

        self.scaler = StandardScaler()
        scaled_array = self.scaler.fit_transform(num_df.fillna(0))
        scaled_df = pd.DataFrame(
            scaled_array, columns=[f"{c}_zscore" for c in numeric_cols], index=df.index
        )
        parts.append(scaled_df)

        self.top_5_pairs_ = self.top_k_pairs_[:5]

        return pd.concat(parts, axis=1)

    def _transform_categorical(
        self,
        df: pd.DataFrame,
        categorical_cols: list[str],
        target_column: str,
    ) -> pd.DataFrame:
        parts: list[pd.DataFrame] = []
        one_hot_cols = []
        target_enc_cols = []

        for col in categorical_cols:
            nunique = df[col].nunique()
            if nunique < 15:
                one_hot_cols.append(col)
            else:
                target_enc_cols.append(col)

        if one_hot_cols:
            dummies = pd.get_dummies(df[one_hot_cols], dummy_na=False)
            parts.append(dummies)

        if target_enc_cols and target_column in df.columns:
            target_enc_result = self._target_encode(df, target_enc_cols, target_column)
            parts.append(target_enc_result)

        freq_result = pd.DataFrame(index=df.index)
        for col in categorical_cols:
            freq_map = df[col].value_counts(normalize=True).to_dict()
            self.freq_encoding_maps_[col] = freq_map
            freq_result[f"{col}_freq"] = df[col].map(freq_map).fillna(0)
        parts.append(freq_result)

        return pd.concat(parts, axis=1) if parts else pd.DataFrame(index=df.index)

    def _target_encode(
        self,
        df: pd.DataFrame,
        cols: list[str],
        target_column: str,
    ) -> pd.DataFrame:
        result = pd.DataFrame(index=df.index)
        y = df[target_column].astype(float)
        kf = KFold(n_splits=5, shuffle=True, random_state=42)

        for col in cols:
            encoded = pd.Series(np.nan, index=df.index, name=f"{col}_target_enc")
            global_mean = y.mean()
            self.target_encoding_maps_[col] = {"global_mean": global_mean, "maps": {}}

            for fold_idx, (train_idx, val_idx) in enumerate(kf.split(df)):
                train_vals = df.iloc[train_idx][col]
                train_target = y.iloc[train_idx]
                means = train_target.groupby(train_vals).mean()
                self.target_encoding_maps_[col]["maps"][fold_idx] = means.to_dict()
                encoded.iloc[val_idx] = df.iloc[val_idx][col].map(means)

            encoded = encoded.fillna(global_mean)
            result[f"{col}_target_enc"] = encoded

        return result

    def _transform_datetime(
        self,
        df: pd.DataFrame,
        datetime_cols: list[str],
    ) -> pd.DataFrame:
        parts: list[pd.DataFrame] = []

        for col in datetime_cols:
            dt_series = pd.to_datetime(df[col], errors="coerce")
            self.max_dates_[col] = dt_series.max()

            dt_result = pd.DataFrame(index=df.index)
            dt_result[f"{col}_year"] = dt_series.dt.year
            dt_result[f"{col}_month"] = dt_series.dt.month
            dt_result[f"{col}_day"] = dt_series.dt.day
            dt_result[f"{col}_dayofweek"] = dt_series.dt.dayofweek
            dt_result[f"{col}_is_weekend"] = (dt_series.dt.dayofweek >= 5).astype(int)
            dt_result[f"{col}_weekofyear"] = dt_series.dt.isocalendar().week.astype(int)

            if dt_series.dt.hour.nunique(dropna=True) > 1:
                dt_result[f"{col}_hour"] = dt_series.dt.hour

            max_date = self.max_dates_[col]
            if pd.notna(max_date):
                dt_result[f"{col}_days_from_max"] = (max_date - dt_series).dt.days

            parts.append(dt_result)

        return pd.concat(parts, axis=1) if parts else pd.DataFrame(index=df.index)

    def _transform_text(
        self,
        df: pd.DataFrame,
        text_cols: list[str],
    ) -> pd.DataFrame:
        parts: list[pd.DataFrame] = []
        max_features = self.config.get("tfidf_max_features", 300)

        for col in text_cols:
            text_data = df[col].fillna("").astype(str)
            vectorizer = TfidfVectorizer(max_features=max_features)
            tfidf_matrix = vectorizer.fit_transform(text_data)
            self.tfidf_vectorizers_[col] = vectorizer

            feature_names = [f"{col}_tfidf_{i}" for i in range(tfidf_matrix.shape[1])]
            tfidf_df = pd.DataFrame(
                tfidf_matrix.toarray(),
                columns=feature_names,
                index=df.index,
            )
            parts.append(tfidf_df)

        return pd.concat(parts, axis=1) if parts else pd.DataFrame(index=df.index)

    def _transform_cross(self, df: pd.DataFrame) -> pd.DataFrame:
        result = pd.DataFrame(index=df.index)
        for col_a, col_b in self.top_5_pairs_:
            ratio = np.where(df[col_b] != 0, df[col_a] / df[col_b], 0)
            result[f"{col_a}_div_{col_b}"] = ratio
        return result
