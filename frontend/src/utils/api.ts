const BASE_URL = "http://localhost:8000/api";

async function request<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

export interface InferenceResult {
  columns: ColumnInference[];
  total_rows: number;
  total_columns: number;
  numeric_count: number;
  categorical_count: number;
  datetime_count: number;
  text_count: number;
  missing_top: { column: string; ratio: number }[];
  numeric_distributions: {
    column: string;
    bins: number[];
    counts: number[];
  }[];
  categorical_frequencies: {
    column: string;
    values: string[];
    counts: number[];
  }[];
  detected_target: string | null;
}

export interface ColumnInference {
  name: string;
  inferred_type: "numeric" | "categorical" | "datetime" | "text";
  unique_count: number;
  missing_ratio: number;
  sample_values: string[];
}

export interface OverviewData {
  total_rows: number;
  total_columns: number;
  numeric_count: number;
  categorical_count: number;
  datetime_count: number;
  text_count: number;
  columns: ColumnInference[];
  missing_top: { column: string; ratio: number }[];
  numeric_distributions: {
    column: string;
    bins: number[];
    counts: number[];
  }[];
  categorical_frequencies: {
    column: string;
    values: string[];
    counts: number[];
  }[];
  detected_target: string | null;
}

export interface FeatureEngineeringResult {
  original_features: number;
  generated_features: number;
  dimension_change: { before: number; after: number };
  contributions: { type: string; count: number }[];
  new_features: string[];
}

export interface FeatureSelectionResult {
  stages: {
    name: string;
    remaining: number;
    removed: string[];
  }[];
  final_features: string[];
  importance: { feature: string; importance: number }[];
}

export interface ModelSearchProgress {
  current_model: string;
  trial: number;
  total_trials: number;
  best_score: number;
  models_completed: string[];
}

export interface ModelSearchResult {
  models: {
    name: string;
    best_score: number;
    best_params: Record<string, unknown>;
    rank: number;
  }[];
  best_model: string;
  best_score: number;
  score_history: { trial: number; score: number }[];
}

export interface EnsembleResult {
  method: string;
  score: number;
  improvement: number;
  base_models: string[];
  meta_learner: string;
  comparison: {
    model: string;
    score: number;
  }[];
}

export interface GlobalSHAPResult {
  features: string[];
  values: number[];
  abs_mean: { feature: string; value: number }[];
  beeswarm: {
    feature: string;
    shap_value: number;
    feature_value: number;
  }[];
}

export interface LocalSHAPResult {
  base_value: number;
  prediction: number;
  contributions: {
    feature: string;
    value: number;
    shap: number;
  }[];
}

export interface PipelineInfo {
  download_url: string;
  file_size: number;
}

export interface MissingValueColumn {
  column: string;
  missing_count: number;
  missing_ratio: number;
  risk_level: "normal" | "high_risk" | "suggest_delete";
  suggestion: string | null;
}

export interface CorrelatedMissingGroup {
  columns: string[];
  missing_count: number;
  label: string;
}

export interface MissingValuesResult {
  columns: MissingValueColumn[];
  correlated_groups: CorrelatedMissingGroup[];
}

export interface OutlierColumn {
  column: string;
  outlier_count: number;
  outlier_ratio: number;
  q1: number | null;
  q3: number | null;
  iqr: number | null;
  lower_bound: number | null;
  upper_bound: number | null;
  warning: boolean;
}

export interface OutliersResult {
  columns: OutlierColumn[];
}

export interface ConsistencyIssue {
  type: string;
  values: string[];
  description: string;
}

export interface ConsistencyColumn {
  column: string;
  inconsistency_count: number;
  issues: ConsistencyIssue[];
}

export interface ConsistencyResult {
  columns: ConsistencyColumn[];
}

export interface UniquenessColumn {
  column: string;
  unique_count: number;
  unique_ratio: number;
  category: "normal" | "suspected_id" | "constant";
  suggestion: string | null;
}

export interface UniquenessResult {
  columns: UniquenessColumn[];
}

export interface CorrelationPair {
  column_a: string;
  column_b: string;
  correlation: number;
  is_highly_collinear: boolean;
  suggestion: string | null;
}

export interface CorrelationsResult {
  pairs: CorrelationPair[];
}

export interface QualityReportData {
  missing_values: MissingValuesResult;
  outliers: OutliersResult;
  consistency: ConsistencyResult;
  uniqueness: UniquenessResult;
  correlations: CorrelationsResult;
}

export interface QualityReport {
  id: number;
  task_id: number;
  status: string;
  report_data: QualityReportData | null;
  created_at: string | null;
}

export interface QualityReportWSMessage {
  stage: string;
  progress: number;
  report_id?: number;
  data?: Partial<QualityReportData> | { error: string };
}

export async function uploadFile(
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ task_id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE_URL}/upload`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Invalid response"));
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  });
}

export function getInference(taskId: string): Promise<InferenceResult> {
  return request<InferenceResult>(`/tasks/${taskId}/inference`);
}

export function updateInference(
  taskId: string,
  columns: { name: string; inferred_type: string }[]
): Promise<InferenceResult> {
  return request<InferenceResult>(`/tasks/${taskId}/inference`, {
    method: "PUT",
    body: JSON.stringify({ columns }),
  });
}

export function setTarget(
  taskId: string,
  targetColumn: string
): Promise<{ target: string }> {
  return request<{ target: string }>(`/tasks/${taskId}/target`, {
    method: "POST",
    body: JSON.stringify({ target_column: targetColumn }),
  });
}

export function getOverview(taskId: string): Promise<OverviewData> {
  return request<OverviewData>(`/tasks/${taskId}/overview`);
}

export function startFeatureEngineering(
  taskId: string,
  config?: Record<string, unknown>
): Promise<{ status: string }> {
  return request<{ status: string }>(`/tasks/${taskId}/feature-engineering`, {
    method: "POST",
    body: JSON.stringify(config || {}),
  });
}

export function getFeatureEngineeringResult(
  taskId: string
): Promise<FeatureEngineeringResult> {
  return request<FeatureEngineeringResult>(
    `/tasks/${taskId}/feature-engineering/result`
  );
}

export function startFeatureSelection(
  taskId: string,
  config?: Record<string, unknown>
): Promise<{ status: string }> {
  return request<{ status: string }>(`/tasks/${taskId}/feature-selection`, {
    method: "POST",
    body: JSON.stringify(config || {}),
  });
}

export function getFeatureSelectionResult(
  taskId: string
): Promise<FeatureSelectionResult> {
  return request<FeatureSelectionResult>(
    `/tasks/${taskId}/feature-selection/result`
  );
}

export function startModelSearch(
  taskId: string,
  config?: Record<string, unknown>
): Promise<{ status: string }> {
  return request<{ status: string }>(`/tasks/${taskId}/model-search`, {
    method: "POST",
    body: JSON.stringify(config || {}),
  });
}

export function getModelSearchResult(
  taskId: string
): Promise<ModelSearchResult> {
  return request<ModelSearchResult>(`/tasks/${taskId}/model-search/result`);
}

export function getModelSearchProgress(
  taskId: string
): Promise<ModelSearchProgress> {
  return request<ModelSearchProgress>(
    `/tasks/${taskId}/model-search/progress`
  );
}

export function startEnsemble(
  taskId: string,
  config?: Record<string, unknown>
): Promise<{ status: string }> {
  return request<{ status: string }>(`/tasks/${taskId}/ensemble`, {
    method: "POST",
    body: JSON.stringify(config || {}),
  });
}

export function getEnsembleResult(taskId: string): Promise<EnsembleResult> {
  return request<EnsembleResult>(`/tasks/${taskId}/ensemble/result`);
}

export function startExplainability(
  taskId: string,
  config?: Record<string, unknown>
): Promise<{ status: string }> {
  return request<{ status: string }>(`/tasks/${taskId}/explainability`, {
    method: "POST",
    body: JSON.stringify(config || {}),
  });
}

export function getGlobalSHAP(taskId: string): Promise<GlobalSHAPResult> {
  return request<GlobalSHAPResult>(`/tasks/${taskId}/explainability/global`);
}

export function getLocalSHAP(
  taskId: string,
  sampleIndex: number
): Promise<LocalSHAPResult> {
  return request<LocalSHAPResult>(
    `/tasks/${taskId}/explainability/local?sample_index=${sampleIndex}`
  );
}

export function downloadPipeline(taskId: string): Promise<PipelineInfo> {
  return request<PipelineInfo>(`/tasks/${taskId}/pipeline`);
}

export function predict(
  taskId: string,
  file: File
): Promise<{
  predictions: { index: number; prediction: number; top_features: { feature: string; contribution: number }[] }[];
}> {
  const formData = new FormData();
  formData.append("file", file);
  return fetch(`${BASE_URL}/tasks/${taskId}/predict`, {
    method: "POST",
    body: formData,
  }).then((res) => {
    if (!res.ok) throw new Error(`Prediction failed: ${res.status}`);
    return res.json();
  });
}

export function generateQualityReport(
  taskId: string
): Promise<{ status: string; task_id: number }> {
  return request<{ status: string; task_id: number }>(
    `/tasks/${taskId}/quality-report`,
    { method: "POST" }
  );
}

export function getLatestQualityReport(
  taskId: string
): Promise<{ report: QualityReport | null }> {
  return request<{ report: QualityReport | null }>(
    `/tasks/${taskId}/quality-report/latest`
  );
}

export function getQualityReport(
  taskId: string,
  reportId: number
): Promise<QualityReport> {
  return request<QualityReport>(
    `/tasks/${taskId}/quality-report/${reportId}`
  );
}
