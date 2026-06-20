import { create } from "zustand";
import type {
  OverviewData,
  FeatureEngineeringResult,
  FeatureSelectionResult,
  ModelSearchResult,
  ModelSearchProgress,
  EnsembleResult,
  GlobalSHAPResult,
  LocalSHAPResult,
  PipelineInfo,
  ColumnInference,
  QualityReportData,
  DatasetVersion,
  DriftComparison,
  DriftWarning,
  FeatureAttribution,
} from "@/utils/api";

export type StepStatus =
  | "idle"
  | "uploading"
  | "running"
  | "completed"
  | "error";

export type StepKey =
  | "upload"
  | "overview"
  | "versioning"
  | "feature_engineering"
  | "feature_selection"
  | "model_search"
  | "ensemble"
  | "explainability"
  | "pipeline"
  | "attribution";

interface TaskState {
  taskId: string | null;
  taskStatus: StepStatus;
  currentStep: StepKey;

  inference: OverviewData | null;
  targetColumn: string | null;

  featureEngineeringResult: FeatureEngineeringResult | null;
  featureEngineeringStatus: StepStatus;

  featureSelectionResult: FeatureSelectionResult | null;
  featureSelectionStatus: StepStatus;

  modelSearchResult: ModelSearchResult | null;
  modelSearchProgress: ModelSearchProgress | null;
  modelSearchStatus: StepStatus;

  ensembleResult: EnsembleResult | null;
  ensembleStatus: StepStatus;

  globalSHAP: GlobalSHAPResult | null;
  localSHAP: LocalSHAPResult | null;
  explainabilityStatus: StepStatus;

  pipelineInfo: PipelineInfo | null;

  qualityReportData: QualityReportData | null;
  qualityReportStatus: StepStatus;
  qualityReportProgress: number;
  qualityReportStage: string;

  datasetVersions: DatasetVersion[] | null;
  driftComparisons: DriftComparison[] | null;
  driftWarnings: DriftWarning[] | null;
  latestDriftWarning: DriftWarning | null;
  driftComparisonProgress: number;
  driftComparisonStage: string;

  featureAttribution: FeatureAttribution | null;
  featureAttributionStatus: StepStatus;
  featureAttributionProgress: number;
  featureAttributionStage: string;

  setTaskId: (id: string | null) => void;
  setTaskStatus: (status: StepStatus) => void;
  setStep: (step: StepKey) => void;
  setInference: (data: OverviewData) => void;
  updateColumnInference: (name: string, type: ColumnInference["inferred_type"]) => void;
  setTargetColumn: (col: string | null) => void;
  setFeatureEngineeringResult: (data: FeatureEngineeringResult | null) => void;
  setFeatureEngineeringStatus: (status: StepStatus) => void;
  setFeatureSelectionResult: (data: FeatureSelectionResult | null) => void;
  setFeatureSelectionStatus: (status: StepStatus) => void;
  setModelSearchResult: (data: ModelSearchResult | null) => void;
  setModelSearchProgress: (data: ModelSearchProgress | null) => void;
  setModelSearchStatus: (status: StepStatus) => void;
  setEnsembleResult: (data: EnsembleResult | null) => void;
  setEnsembleStatus: (status: StepStatus) => void;
  setGlobalSHAP: (data: GlobalSHAPResult | null) => void;
  setLocalSHAP: (data: LocalSHAPResult | null) => void;
  setExplainabilityStatus: (status: StepStatus) => void;
  setPipelineInfo: (data: PipelineInfo | null) => void;
  setQualityReportData: (data: QualityReportData | null) => void;
  setQualityReportStatus: (status: StepStatus) => void;
  setQualityReportProgress: (progress: number) => void;
  setQualityReportStage: (stage: string) => void;
  setDatasetVersions: (data: DatasetVersion[] | null) => void;
  setDriftComparisons: (data: DriftComparison[] | null) => void;
  setDriftWarnings: (data: DriftWarning[] | null) => void;
  setLatestDriftWarning: (data: DriftWarning | null) => void;
  setDriftComparisonProgress: (progress: number) => void;
  setDriftComparisonStage: (stage: string) => void;
  setFeatureAttribution: (data: FeatureAttribution | null) => void;
  setFeatureAttributionStatus: (status: StepStatus) => void;
  setFeatureAttributionProgress: (progress: number) => void;
  setFeatureAttributionStage: (stage: string) => void;
  reset: () => void;
}

const initialState = {
  taskId: null,
  taskStatus: "idle" as StepStatus,
  currentStep: "upload" as StepKey,
  inference: null,
  targetColumn: null,
  featureEngineeringResult: null,
  featureEngineeringStatus: "idle" as StepStatus,
  featureSelectionResult: null,
  featureSelectionStatus: "idle" as StepStatus,
  modelSearchResult: null,
  modelSearchProgress: null,
  modelSearchStatus: "idle" as StepStatus,
  ensembleResult: null,
  ensembleStatus: "idle" as StepStatus,
  globalSHAP: null,
  localSHAP: null,
  explainabilityStatus: "idle" as StepStatus,
  pipelineInfo: null,
  qualityReportData: null,
  qualityReportStatus: "idle" as StepStatus,
  qualityReportProgress: 0,
  qualityReportStage: "",
  datasetVersions: null,
  driftComparisons: null,
  driftWarnings: null,
  latestDriftWarning: null,
  driftComparisonProgress: 0,
  driftComparisonStage: "",
  featureAttribution: null,
  featureAttributionStatus: "idle" as StepStatus,
  featureAttributionProgress: 0,
  featureAttributionStage: "",
};

export const useTaskStore = create<TaskState>((set) => ({
  ...initialState,

  setTaskId: (id) => set({ taskId: id }),
  setTaskStatus: (status) => set({ taskStatus: status }),
  setStep: (step) => set({ currentStep: step }),
  setInference: (data) => set({ inference: data }),
  updateColumnInference: (name, type) =>
    set((state) => {
      if (!state.inference) return state;
      return {
        inference: {
          ...state.inference,
          columns: state.inference.columns.map((col) =>
            col.name === name ? { ...col, inferred_type: type } : col
          ),
        },
      };
    }),
  setTargetColumn: (col) => set({ targetColumn: col }),
  setFeatureEngineeringResult: (data) =>
    set({ featureEngineeringResult: data }),
  setFeatureEngineeringStatus: (status) =>
    set({ featureEngineeringStatus: status }),
  setFeatureSelectionResult: (data) =>
    set({ featureSelectionResult: data }),
  setFeatureSelectionStatus: (status) =>
    set({ featureSelectionStatus: status }),
  setModelSearchResult: (data) => set({ modelSearchResult: data }),
  setModelSearchProgress: (data) => set({ modelSearchProgress: data }),
  setModelSearchStatus: (status) => set({ modelSearchStatus: status }),
  setEnsembleResult: (data) => set({ ensembleResult: data }),
  setEnsembleStatus: (status) => set({ ensembleStatus: status }),
  setGlobalSHAP: (data) => set({ globalSHAP: data }),
  setLocalSHAP: (data) => set({ localSHAP: data }),
  setExplainabilityStatus: (status) =>
    set({ explainabilityStatus: status }),
  setPipelineInfo: (data) => set({ pipelineInfo: data }),
  setQualityReportData: (data) => set({ qualityReportData: data }),
  setQualityReportStatus: (status) => set({ qualityReportStatus: status }),
  setQualityReportProgress: (progress) => set({ qualityReportProgress: progress }),
  setQualityReportStage: (stage) => set({ qualityReportStage: stage }),
  setDatasetVersions: (data) => set({ datasetVersions: data }),
  setDriftComparisons: (data) => set({ driftComparisons: data }),
  setDriftWarnings: (data) => set({ driftWarnings: data }),
  setLatestDriftWarning: (data) => set({ latestDriftWarning: data }),
  setDriftComparisonProgress: (progress) => set({ driftComparisonProgress: progress }),
  setDriftComparisonStage: (stage) => set({ driftComparisonStage: stage }),
  setFeatureAttribution: (data) => set({ featureAttribution: data }),
  setFeatureAttributionStatus: (status) => set({ featureAttributionStatus: status }),
  setFeatureAttributionProgress: (progress) => set({ featureAttributionProgress: progress }),
  setFeatureAttributionStage: (stage) => set({ featureAttributionStage: stage }),
  reset: () => set(initialState),
}));
