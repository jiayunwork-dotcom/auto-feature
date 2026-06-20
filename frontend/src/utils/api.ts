const BASE_URL = "/api";

export function getWebSocketUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

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

export interface DatasetVersion {
  id: number;
  task_id: number;
  version_number: number;
  filename: string;
  file_path: string;
  row_count: number;
  column_count: number;
  file_hash_md5: string;
  columns_info: Record<string, string> | null;
  created_at: string;
}

export interface ColumnDriftResult {
  column_name: string;
  column_type: string;
  method: string;
  statistic: number | null;
  p_value_or_psi: number | null;
  verdict: "稳定" | "轻微漂移" | "显著漂移";
  visualization_data: {
    type: "density" | "bar";
    x?: number[];
    density_a?: number[];
    density_b?: number[];
    categories?: string[];
    counts_a?: number[];
    counts_b?: number[];
  } | null;
}

export interface DriftComparison {
  id: number;
  task_id: number;
  version_a_id: number;
  version_b_id: number;
  version_a_number: number | null;
  version_b_number: number | null;
  version_a?: DatasetVersion;
  version_b?: DatasetVersion;
  status: "pending" | "running" | "completed" | "failed";
  column_results: ColumnDriftResult[] | null;
  added_columns: string[] | null;
  removed_columns: string[] | null;
  overall_warning: boolean | null;
  significant_drift_ratio: number | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface DriftWarning {
  id: number;
  task_id: number;
  comparison_id: number;
  warning_message: string;
  significant_columns: string[] | null;
  drift_ratio: number | null;
  is_active: boolean;
  created_at: string;
  acknowledged_at: string | null;
}

export interface DriftWSMessage {
  stage: string;
  progress: number;
  comparison_id: number;
  data?: Record<string, unknown>;
}

export function createDatasetVersion(
  taskId: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<DatasetVersion> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE_URL}/tasks/${taskId}/versions`);
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
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.detail || `Upload failed: ${xhr.status}`));
        } catch {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  });
}

export function getDatasetVersions(taskId: string): Promise<{ versions: DatasetVersion[] }> {
  return request<{ versions: DatasetVersion[] }>(`/tasks/${taskId}/versions`);
}

export function deleteDatasetVersion(taskId: string, versionId: number): Promise<{ message: string }> {
  return request<{ message: string }>(`/tasks/${taskId}/versions/${versionId}`, {
    method: "DELETE",
  });
}

export function startDriftComparison(
  taskId: string,
  versionAId: number,
  versionBId: number
): Promise<{ comparison_id: number; status: string }> {
  return request<{ comparison_id: number; status: string }>(`/tasks/${taskId}/compare`, {
    method: "POST",
    body: JSON.stringify({ version_a_id: versionAId, version_b_id: versionBId }),
  });
}

export function getDriftComparisons(taskId: string): Promise<{ comparisons: DriftComparison[] }> {
  return request<{ comparisons: DriftComparison[] }>(`/tasks/${taskId}/comparisons`);
}

export function getDriftComparison(taskId: string, comparisonId: number): Promise<DriftComparison> {
  return request<DriftComparison>(`/tasks/${taskId}/comparisons/${comparisonId}`);
}

export function getDriftWarnings(taskId: string): Promise<{ warnings: DriftWarning[] }> {
  return request<{ warnings: DriftWarning[] }>(`/tasks/${taskId}/warnings`);
}

export function getLatestDriftWarning(taskId: string): Promise<{ warning: DriftWarning | null }> {
  return request<{ warning: DriftWarning | null }>(`/tasks/${taskId}/warnings/latest`);
}

export function acknowledgeDriftWarning(taskId: string, warningId: number): Promise<{ message: string }> {
  return request<{ message: string }>(`/tasks/${taskId}/warnings/${warningId}/acknowledge`, {
    method: "POST",
  });
}

export interface AutoCompareStrategy {
  task_id: number;
  is_enabled: boolean;
  trigger_mode: "on_upload" | "scheduled";
  baseline_mode: "first_version" | "previous_version";
  custom_p_value_threshold: number | null;
  custom_psi_threshold: number | null;
  custom_drift_ratio_threshold: number | null;
  poll_interval_minutes: number;
  last_triggered_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export function getAutoCompareStrategy(taskId: string): Promise<AutoCompareStrategy> {
  return request<AutoCompareStrategy>(`/tasks/${taskId}/auto-compare-strategy`);
}

export function updateAutoCompareStrategy(
  taskId: string,
  data: {
    is_enabled: boolean;
    trigger_mode: "on_upload" | "scheduled";
    baseline_mode: "first_version" | "previous_version";
    custom_p_value_threshold: number | null;
    custom_psi_threshold: number | null;
    custom_drift_ratio_threshold: number | null;
    poll_interval_minutes: number;
  }
): Promise<AutoCompareStrategy> {
  return request<AutoCompareStrategy>(`/tasks/${taskId}/auto-compare-strategy`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteAutoCompareStrategy(taskId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/tasks/${taskId}/auto-compare-strategy`, {
    method: "DELETE",
  });
}

export interface DriftReportExport {
  id: number;
  task_id: number;
  comparison_id: number | null;
  status: "pending" | "running" | "completed" | "failed";
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  error_message: string | null;
  created_at: string | null;
  completed_at: string | null;
}

export interface DriftReportExportWSMessage {
  status: string;
  export_id: number;
  download_url?: string;
  error_message?: string;
}

export function exportDriftReport(
  taskId: string,
  comparisonId: number
): Promise<{ export_id: number; status: string }> {
  return request<{ export_id: number; status: string }>(
    `/tasks/${taskId}/comparisons/${comparisonId}/export`,
    { method: "POST" }
  );
}

export function getDriftReportExports(taskId: string): Promise<{ exports: DriftReportExport[] }> {
  return request<{ exports: DriftReportExport[] }>(`/tasks/${taskId}/exports`);
}

export function getDriftReportExport(taskId: string, exportId: number): Promise<DriftReportExport> {
  return request<DriftReportExport>(`/tasks/${taskId}/exports/${exportId}`);
}

export function getDriftReportDownloadUrl(taskId: string, exportId: number): string {
  return `${BASE_URL}/tasks/${taskId}/exports/${exportId}/download`;
}

export interface SHAPGlobalImportanceItem {
  feature: string;
  shap_value: number;
}

export interface SHAPTopPair {
  feature_a: string;
  feature_b: string;
  strength: number;
}

export interface SHAPInteractionResult {
  top_features: string[];
  matrix: number[][];
  top_5_pairs: SHAPTopPair[];
  note?: string;
  error?: string;
}

export interface DAGNode {
  id: string;
  type: string;
  label: string;
  weight?: number;
}

export interface DAGEdge {
  source: string;
  target: string;
  operation: string;
  weight?: number;
}

export interface DAGTreeNode {
  name: string;
  type: string;
  operation?: string;
  shap_importance?: number;
  contribution_weight?: number;
  children?: DAGTreeNode[];
}

export interface FeatureDAGResult {
  nodes: DAGNode[];
  edges: DAGEdge[];
  tree: Record<string, DAGTreeNode>;
}

export interface FeatureAttribution {
  id: number;
  task_id: number;
  status: "pending" | "running" | "completed" | "failed";
  shap_values: {
    global_importance: SHAPGlobalImportanceItem[];
    feature_names: string[];
    sample_count: number;
    per_feature_mean: Record<string, number>;
  } | null;
  interaction_matrix: SHAPInteractionResult | null;
  feature_dag: FeatureDAGResult | null;
  error_message: string | null;
  created_at: string | null;
  completed_at: string | null;
}

export interface FeatureAttributionWSMessage {
  stage: string;
  progress: number;
  attribution_id: number;
  data?: Record<string, unknown> | { error: string };
}

export function startFeatureAttribution(
  taskId: string
): Promise<{ task_id: number; status: string; message: string }> {
  return request<{ task_id: number; status: string; message: string }>(
    `/tasks/${taskId}/feature-attribution`,
    { method: "POST" }
  );
}

export function getLatestFeatureAttribution(
  taskId: string
): Promise<FeatureAttribution> {
  return request<FeatureAttribution>(
    `/tasks/${taskId}/feature-attribution/latest`
  );
}

export function getFeatureAttribution(
  taskId: string,
  attributionId: number
): Promise<FeatureAttribution> {
  return request<FeatureAttribution>(
    `/tasks/${taskId}/feature-attribution/${attributionId}`
  );
}
