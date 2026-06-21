import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import * as echarts from "echarts";
import {
  startFeatureAttribution,
  getLatestFeatureAttribution,
  getWebSocketUrl,
  type FeatureAttribution,
  type FeatureAttributionWSMessage,
  type DAGTreeNode,
  listFeatureAttributions,
  compareFeatureAttributions,
  type AttributionListItem,
  type AttributionCompareResult,
  type ImportanceChange,
  type InteractionChange,
  type DAGDiff,
} from "@/utils/api";
import { useTaskStore } from "@/stores/taskStore";
import EChartsWrapper from "@/components/EChartsWrapper";
import StepProgress from "@/components/StepProgress";
import {
  Loader2,
  AlertCircle,
  Play,
  GitBranch,
  MousePointerClick,
  GitCompare,
  X,
  Check,
  ArrowUp,
  ArrowDown,
  Minus,
  Plus,
  TrendingUp,
  TrendingDown,
  ChevronsUp,
  ChevronsDown,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Layers,
  GitMerge,
} from "lucide-react";

function formatDateTime(s: string | null | undefined): string {
  if (!s) return "-";
  try {
    const d = new Date(s);
    return d.toLocaleString();
  } catch {
    return s;
  }
}

export default function FeatureAttributionPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const [error, setError] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);

  const [showCompareModal, setShowCompareModal] = useState(false);
  const [attributionList, setAttributionList] = useState<AttributionListItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareResult, setCompareResult] = useState<AttributionCompareResult | null>(null);
  const [compareExpanded, setCompareExpanded] = useState(true);
  const [compareDagSelected, setCompareDagSelected] = useState<string | null>(null);

  const featureAttribution = useTaskStore((s) => s.featureAttribution);
  const featureAttributionStatus = useTaskStore(
    (s) => s.featureAttributionStatus
  );
  const featureAttributionProgress = useTaskStore(
    (s) => s.featureAttributionProgress
  );
  const setFeatureAttribution = useTaskStore((s) => s.setFeatureAttribution);
  const setFeatureAttributionStatus = useTaskStore(
    (s) => s.setFeatureAttributionStatus
  );
  const setFeatureAttributionProgress = useTaskStore(
    (s) => s.setFeatureAttributionProgress
  );
  const setFeatureAttributionStage = useTaskStore(
    (s) => s.setFeatureAttributionStage
  );
  const setStep = useTaskStore((s) => s.setStep);

  const wsRef = useRef<WebSocket | null>(null);

  const connectWS = useCallback(() => {
    if (!taskId) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(
      getWebSocketUrl(`/ws/feature-attribution/${taskId}`)
    );
    wsRef.current = ws;

    ws.onopen = () => {};
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as FeatureAttributionWSMessage;
        setFeatureAttributionStage(data.stage);
        setFeatureAttributionProgress(data.progress);
        if (data.stage === "completed") {
          setFeatureAttributionStatus("completed");
          fetchLatest();
        } else if (data.stage === "failed") {
          setFeatureAttributionStatus("error");
          const err = data.data as { error?: string } | undefined;
          setError(err?.error || "Attribution computation failed");
        } else if (data.stage === "started") {
          setFeatureAttributionStatus("running");
        }
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      setTimeout(connectWS, 3000);
    };
    ws.onerror = () => {
      ws.close();
    };
  }, [
    taskId,
    setFeatureAttributionStage,
    setFeatureAttributionProgress,
    setFeatureAttributionStatus,
  ]);

  const fetchLatest = useCallback(async () => {
    if (!taskId) return;
    try {
      const data = await getLatestFeatureAttribution(taskId);
      setFeatureAttribution(data);
      if (data.status === "completed") {
        setFeatureAttributionStatus("completed");
      } else if (data.status === "failed") {
        setFeatureAttributionStatus("error");
        setError(data.error_message || "Attribution computation failed");
      } else if (data.status === "running") {
        setFeatureAttributionStatus("running");
      }
    } catch {
      /* not found yet */
    }
  }, [taskId, setFeatureAttribution, setFeatureAttributionStatus]);

  useEffect(() => {
    setStep("attribution");
    fetchLatest();
    connectWS();
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [setStep, fetchLatest, connectWS]);

  const handleStart = async () => {
    if (!taskId) return;
    setError(null);
    setFeatureAttributionStatus("running");
    try {
      await startFeatureAttribution(taskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
      setFeatureAttributionStatus("error");
    }
  };

  const loadAttributionList = useCallback(async () => {
    if (!taskId) return;
    try {
      const res = await listFeatureAttributions(taskId, "completed");
      setAttributionList(res.attributions);
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : "Failed to load list");
    }
  }, [taskId]);

  const openCompareModal = async () => {
    setCompareError(null);
    setSelectedIds([]);
    setShowCompareModal(true);
    await loadAttributionList();
  };

  const toggleSelectId = (id: number) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const handleStartCompare = async () => {
    if (!taskId || selectedIds.length !== 2) return;
    setCompareLoading(true);
    setCompareError(null);
    try {
      const res = await compareFeatureAttributions(
        taskId,
        selectedIds[0],
        selectedIds[1]
      );
      setCompareResult(res);
      setCompareExpanded(true);
      setCompareDagSelected(res.dag_diffs?.[0]?.feature ?? null);
      setShowCompareModal(false);
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : "Compare failed");
    } finally {
      setCompareLoading(false);
    }
  };

  const isRunning = featureAttributionStatus === "running";
  const globalImportance =
    featureAttribution?.shap_values?.global_importance ?? [];
  const interaction = featureAttribution?.interaction_matrix ?? null;
  const dag = featureAttribution?.feature_dag ?? null;

  const selectedTreeData: DAGTreeNode | null =
    selectedFeature && dag?.tree?.[selectedFeature]
      ? dag.tree[selectedFeature]
      : null;

  function buildBarOption() {
    const data = globalImportance.slice().reverse();
    const maxVal = Math.max(...data.map((d) => d.shap_value), 1);
    return {
      tooltip: {
        trigger: "axis",
        backgroundColor: "#1e293b",
        borderColor: "#334155",
        textStyle: { color: "#f1f5f9" },
        formatter: (params: any) => {
          const p = params[0];
          return `<b>${p.name}</b><br/>Mean |SHAP|: ${p.value.toFixed(4)}`;
        },
      },
      grid: { left: 180, right: 40, top: 10, bottom: 30 },
      xAxis: {
        type: "value",
        axisLabel: { color: "#94a3b8" },
        splitLine: { lineStyle: { color: "#334155" } },
      },
      yAxis: {
        type: "category",
        data: data.map((d) => d.feature),
        axisLabel: {
          color: "#94a3b8",
          fontFamily: "JetBrains Mono",
          fontSize: 10,
        },
      },
      series: [
        {
          type: "bar",
          data: data.map((d, i) => ({
            value: d.shap_value,
            itemStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                {
                  offset: 0,
                  color: `rgba(16, 185, 129, ${0.3 + (i / data.length) * 0.7})`,
                },
                {
                  offset: 1,
                  color: `rgba(5, 150, 105, ${0.3 + (i / data.length) * 0.7})`,
                },
              ]),
            },
          })),
          barWidth: 14,
        },
      ],
    };
  }

  function buildHeatmapOption() {
    if (!interaction || !interaction.matrix || interaction.matrix.length === 0) {
      return null;
    }
    const features = interaction.top_features;
    const matrix = interaction.matrix;
    const data: any[] = [];
    let max = 0;
    for (let i = 0; i < features.length; i++) {
      for (let j = 0; j < features.length; j++) {
        const v = matrix[i]?.[j] ?? 0;
        max = Math.max(max, v);
        data.push([j, i, v]);
      }
    }
    return {
      tooltip: {
        position: "top",
        backgroundColor: "#1e293b",
        borderColor: "#334155",
        textStyle: { color: "#f1f5f9" },
        formatter: (params: any) => {
          const [x, y, v] = params.data;
          return `<b>${features[y]}</b> × <b>${features[x]}</b><br/>Interaction: ${v.toFixed(5)}`;
        },
      },
      grid: { left: 140, right: 60, top: 10, bottom: 120 },
      xAxis: {
        type: "category",
        data: features,
        axisLabel: {
          color: "#94a3b8",
          rotate: 45,
          fontFamily: "JetBrains Mono",
          fontSize: 10,
        },
        splitArea: { show: true, areaStyle: { color: ["#1e293b", "#0f172a"] } },
      },
      yAxis: {
        type: "category",
        data: features,
        axisLabel: {
          color: "#94a3b8",
          fontFamily: "JetBrains Mono",
          fontSize: 10,
        },
        splitArea: { show: true },
      },
      visualMap: {
        min: 0,
        max: max || 1,
        calculable: true,
        orient: "vertical",
        right: 10,
        top: "center",
        inRange: {
          color: ["#1e293b", "#0e7490", "#10b981", "#f59e0b", "#ef4444"],
        },
        textStyle: { color: "#94a3b8" },
      },
      series: [
        {
          name: "SHAP Interaction",
          type: "heatmap",
          data,
          label: {
            show: true,
            color: "#f1f5f9",
            fontFamily: "JetBrains Mono",
            fontSize: 9,
            formatter: (params: any) => params.data[2].toFixed(3),
          },
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowColor: "rgba(0, 0, 0, 0.5)" },
          },
        },
      ],
    };
  }

  function buildTreeOption(nodeData: DAGTreeNode | null, edgesA?: Set<string>, edgesB?: Set<string>, mode?: "a" | "b") {
    if (!nodeData) return null;

    function convert(node: DAGTreeNode, parent: string | null = null): any {
      const children = node.children?.map((c) => convert(c, node.name)) ?? [];
      const weightLabel =
        node.contribution_weight !== undefined
          ? ` (${(node.contribution_weight * 100).toFixed(1)}%)`
          : node.shap_importance !== undefined
          ? ` (|SHAP|=${node.shap_importance.toFixed(4)})`
          : "";

      let edgeStyle: any = undefined;
      if (parent) {
        const edgeKey = `${parent}->${node.name}`;
        const isAdded = mode === "b" && edgesA && !edgesA.has(edgeKey) && edgesB?.has(edgeKey);
        const isRemoved = mode === "a" && edgesB && !edgesB.has(edgeKey) && edgesA?.has(edgeKey);
        if (isAdded) {
          edgeStyle = {
            color: "#22c55e",
            width: 2.5,
            type: "dashed",
          };
        } else if (isRemoved) {
          edgeStyle = {
            color: "#ef4444",
            width: 2.5,
            type: "dashed",
          };
        }
      }

      return {
        name: `${node.name}${weightLabel}`,
        children,
        lineStyle: edgeStyle,
      };
    }

    const treeData = convert(nodeData);

    return {
      tooltip: {
        trigger: "item",
        triggerOn: "mousemove",
        backgroundColor: "#1e293b",
        borderColor: "#334155",
        textStyle: { color: "#f1f5f9" },
        formatter: (params: any) => {
          return `<b>${params.name}</b>`;
        },
      },
      series: [
        {
          type: "tree",
          data: [treeData],
          top: "10%",
          left: "10%",
          bottom: "10%",
          right: "15%",
          symbolSize: 10,
          orient: "LR",
          label: {
            position: "left",
            verticalAlign: "middle",
            align: "right",
            color: "#f1f5f9",
            fontFamily: "JetBrains Mono",
            fontSize: 10,
          },
          leaves: {
            label: {
              position: "right",
              verticalAlign: "middle",
              align: "left",
              color: "#94a3b8",
            },
          },
          emphasis: {
            focus: "descendant",
          },
          expandAndCollapse: true,
          animationDuration: 550,
          animationDurationUpdate: 750,
          lineStyle: {
            color: "#475569",
            width: 1.5,
          },
          itemStyle: {
            color: mode === "a" ? "#3b82f6" : "#10b981",
            borderColor: mode === "a" ? "#1d4ed8" : "#059669",
          },
        },
      ],
    };
  }

  function buildTreeOptionStandard(nodeData: DAGTreeNode | null) {
    return buildTreeOption(nodeData);
  }

  return (
    <div className="animate-fade-in space-y-6">
      <StepProgress />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <GitBranch size={22} /> Feature Attribution Report
        </h2>
        {featureAttribution?.status === "completed" && (
          <button
            onClick={openCompareModal}
            className="btn-secondary flex items-center gap-2"
          >
            <GitCompare size={16} />
            版本对比
          </button>
        )}
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <button
          onClick={handleStart}
          disabled={isRunning}
          className="btn-primary flex items-center gap-2"
        >
          {isRunning ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Play size={16} />
          )}
          {isRunning
            ? `Computing Attribution... ${featureAttributionProgress}%`
            : "Start Attribution Analysis"}
        </button>
        {error && (
          <div className="flex items-center gap-2 text-red-300 text-sm">
            <AlertCircle size={14} />
            {error}
          </div>
        )}
      </div>

      {isRunning && (
        <div className="card flex items-center gap-4">
          <Loader2 size={24} className="animate-spin text-emerald-400" />
          <div>
            <p className="font-medium text-white">
              Computing SHAP attribution...
            </p>
            <p className="text-sm text-slate-400">
              Stage: {featureAttributionProgress > 0 ? "running" : "preparing"}{" "}
              ({featureAttributionProgress}%)
            </p>
            <div className="mt-2 w-64 h-2 rounded-full bg-slate-700 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${featureAttributionProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {featureAttribution?.status === "failed" && (
        <div className="card border border-red-500/50 bg-red-500/10">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-red-400 mt-0.5" />
            <div>
              <p className="font-semibold text-red-300">Attribution Failed</p>
              <p className="text-sm text-red-200/80 mt-1 font-mono">
                {featureAttribution.error_message}
              </p>
            </div>
          </div>
        </div>
      )}

      {compareResult && (
        <CompareResultPanel
          result={compareResult}
          expanded={compareExpanded}
          onToggle={() => setCompareExpanded((s) => !s)}
          dagSelected={compareDagSelected}
          onDagSelected={setCompareDagSelected}
          onClose={() => {
            setCompareResult(null);
            setCompareDagSelected(null);
          }}
        />
      )}

      {featureAttribution?.status === "completed" && (
        <div className="space-y-6 animate-slide-up">
          <div className="card">
            <h3 className="text-lg font-semibold text-white mb-1">
              Global Feature Importance (SHAP Mean |value|)
            </h3>
            <p className="text-sm text-slate-400 mb-3">
              Features sorted by the mean absolute SHAP value across all
              samples. Higher values indicate greater contribution to the
              model output.
            </p>
            {globalImportance.length > 0 && (
              <div
                style={{
                  height: Math.max(300, globalImportance.length * 26),
                }}
              >
                <EChartsWrapper option={buildBarOption() as echarts.EChartsOption} />
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-white mb-1">
              Top-5 SHAP Interaction Matrix
            </h3>
            <p className="text-sm text-slate-400 mb-3">
              Pairwise feature interaction strength computed via{" "}
              <code className="px-1 py-0.5 bg-slate-800 rounded text-xs">
                shap_interaction_values
              </code>
              . Only available for tree-based models.
            </p>
            {interaction && interaction.matrix && interaction.matrix.length > 0 ? (
              <div style={{ height: 460 }}>
                <EChartsWrapper option={buildHeatmapOption() as unknown as echarts.EChartsOption} />
              </div>
            ) : (
              <div className="text-sm text-slate-400 italic py-8 text-center">
                {interaction?.note ||
                  interaction?.error ||
                  "Interaction data not available"}
              </div>
            )}
            {interaction?.top_5_pairs && interaction.top_5_pairs.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium text-slate-300 mb-2">
                  Top 5 Feature Interaction Pairs:
                </p>
                <div className="space-y-1">
                  {interaction.top_5_pairs.map((p, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between px-3 py-1.5 rounded text-sm"
                      style={{ backgroundColor: "rgba(30, 41, 59, 0.6)" }}
                    >
                      <span className="font-mono text-slate-200">
                        {p.feature_a}{" "}
                        <span className="text-slate-500">×</span>{" "}
                        {p.feature_b}
                      </span>
                      <span className="font-mono text-emerald-400">
                        {p.strength.toFixed(5)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <MousePointerClick size={18} /> Feature Dependency DAG
                </h3>
                <p className="text-sm text-slate-400 mt-1">
                  Click a feature below to view its generation lineage from
                  original columns through feature engineering transformations.
                </p>
              </div>
              {selectedFeature && (
                <div className="text-xs text-slate-400 font-mono bg-slate-800 px-2 py-1 rounded">
                  selected: {selectedFeature}
                </div>
              )}
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {globalImportance.map((item) => {
                const active = selectedFeature === item.feature;
                return (
                  <button
                    key={item.feature}
                    onClick={() =>
                      setSelectedFeature(active ? null : item.feature)
                    }
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all ${
                      active
                        ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    {item.feature}
                    <span className="ml-1 opacity-60">
                      {item.shap_value.toFixed(3)}
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedTreeData ? (
              <div style={{ height: 360 }}>
                <EChartsWrapper option={buildTreeOptionStandard(selectedTreeData) as unknown as echarts.EChartsOption} />
              </div>
            ) : (
              <div className="text-sm text-slate-400 italic py-12 text-center border border-dashed border-slate-700 rounded-lg">
                {dag
                  ? "Select a feature from the chips above to view its dependency tree"
                  : "DAG data not available"}
              </div>
            )}
          </div>
        </div>
      )}

      {showCompareModal && (
        <CompareModal
          attributions={attributionList}
          selectedIds={selectedIds}
          onToggle={toggleSelectId}
          loading={compareLoading}
          error={compareError}
          onClose={() => setShowCompareModal(false)}
          onConfirm={handleStartCompare}
        />
      )}
    </div>
  );
}

function CompareModal(props: {
  attributions: AttributionListItem[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { attributions, selectedIds, onToggle, loading, error, onClose, onConfirm } = props;
  const canConfirm = selectedIds.length === 2 && !loading;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <GitCompare size={20} className="text-emerald-400" />
            <h3 className="text-lg font-semibold text-white">选择归因版本进行对比</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            disabled={loading}
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-800 bg-slate-800/40">
          <p className="text-sm text-slate-300">
            请勾选 <span className="text-emerald-400 font-semibold">两条</span> 已完成的归因分析记录进行对比（按时间倒序排列）
          </p>
          <p className="text-xs text-slate-500 mt-1">
            已选 {selectedIds.length} / 2
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {attributions.length === 0 ? (
            <div className="text-center py-16 text-slate-500 text-sm">
              暂无已完成的归因分析记录
            </div>
          ) : (
            attributions.map((a) => {
              const checked = selectedIds.includes(a.id);
              const disabled = !checked && selectedIds.length >= 2;
              return (
                <label
                  key={a.id}
                  className={`block border rounded-lg p-4 cursor-pointer transition-all ${
                    checked
                      ? "border-emerald-500/60 bg-emerald-500/10 shadow-lg shadow-emerald-500/10"
                      : disabled
                      ? "border-slate-800 bg-slate-800/30 opacity-50 cursor-not-allowed"
                      : "border-slate-700 bg-slate-800/50 hover:border-slate-600 hover:bg-slate-800"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                        checked
                          ? "bg-emerald-500 border-emerald-500"
                          : "border-slate-600"
                      }`}
                    >
                      {checked && <Check size={14} className="text-white" />}
                    </div>
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onToggle(a.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-white font-semibold">
                          Attribution #{a.id}
                        </span>
                        <span className="px-2 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          {a.status}
                        </span>
                        <span className="px-2 py-0.5 rounded text-xs bg-slate-700 text-slate-300">
                          {a.feature_count} features
                        </span>
                      </div>
                      <div className="mt-2 space-y-0.5 text-xs text-slate-400 font-mono">
                        <p>创建时间: {formatDateTime(a.created_at)}</p>
                        <p>完成时间: {formatDateTime(a.completed_at)}</p>
                      </div>
                    </div>
                    {checked && (
                      <div className="text-xs font-mono bg-emerald-500/30 text-emerald-300 px-2 py-1 rounded">
                        {selectedIds[0] === a.id ? "版本A" : "版本B"}
                      </div>
                    )}
                  </div>
                </label>
              );
            })
          )}
        </div>

        <div className="p-4 border-t border-slate-800 flex items-center justify-between gap-3">
          <div className="text-sm">
            {error && (
              <span className="text-red-400 flex items-center gap-1">
                <AlertCircle size={14} />
                {error}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={onConfirm}
              disabled={!canConfirm}
              className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <GitCompare size={16} />
              )}
              {loading ? "对比计算中..." : "开始对比"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CompareResultPanel(props: {
  result: AttributionCompareResult;
  expanded: boolean;
  onToggle: () => void;
  dagSelected: string | null;
  onDagSelected: (f: string | null) => void;
  onClose: () => void;
}) {
  const { result, expanded, onToggle, dagSelected, onDagSelected, onClose } = props;
  const r = result;

  return (
    <div className="card border-2 border-emerald-500/30 bg-emerald-500/5 shadow-xl">
      <div
        className="flex items-start justify-between gap-4 cursor-pointer select-none"
        onClick={onToggle}
      >
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="mt-1 p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
            <GitCompare size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-semibold text-white">归因版本对比差异报告</h3>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300 font-mono">
                #{r.attribution_a.id}
                <span className="mx-1 text-slate-500">→</span>
                #{r.attribution_b.id}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-4 text-xs text-slate-400 font-mono">
              <span>
                <span className="text-blue-400">版本A</span>: {formatDateTime(r.attribution_a.completed_at || r.attribution_a.created_at)} ({r.attribution_a.feature_count} features)
              </span>
              <span>
                <span className="text-emerald-400">版本B</span>: {formatDateTime(r.attribution_b.completed_at || r.attribution_b.created_at)} ({r.attribution_b.feature_count} features)
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="关闭对比"
          >
            <X size={16} />
          </button>
          <button className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
            {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-5 space-y-6 pt-4 border-t border-slate-700/50">
          {r.no_intersection ? (
            <div className="text-center py-12">
              <div className="inline-flex items-center gap-3 px-6 py-4 rounded-xl bg-amber-500/10 border border-amber-500/40">
                <AlertCircle size={24} className="text-amber-400" />
                <div className="text-left">
                  <p className="text-amber-300 font-semibold">{r.message}</p>
                  <p className="text-xs text-amber-200/60 mt-1 font-mono">
                    版本A包含 {r.attribution_a.feature_count} 个特征，版本B包含 {r.attribution_b.feature_count} 个特征，交集为空
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              <ImportanceTable changes={r.importance_changes || []} />
              <InteractionCards changes={r.interaction_changes || []} />
              <DAGDiffSection
                diffs={r.dag_diffs || []}
                selected={dagSelected}
                onSelected={onDagSelected}
                idA={r.attribution_a.id}
                idB={r.attribution_b.id}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ImportanceTable({ changes }: { changes: ImportanceChange[] }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded bg-blue-500/20 text-blue-400">
          <TrendingUp size={16} />
        </div>
        <h4 className="text-base font-semibold text-white">1. 全局重要性排名变化</h4>
        <span className="text-xs text-slate-500 ml-1">
          排名上升标绿，下降标红，变动超过3位高亮加粗
        </span>
      </div>
      <div className="overflow-x-auto border border-slate-700 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800/80 text-slate-300 text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-semibold">特征名称</th>
              <th className="text-center px-3 py-3 font-semibold">版本A排名</th>
              <th className="text-center px-3 py-3 font-semibold">版本B排名</th>
              <th className="text-center px-3 py-3 font-semibold">变化</th>
              <th className="text-right px-4 py-3 font-semibold">版本A SHAP</th>
              <th className="text-right px-4 py-3 font-semibold">版本B SHAP</th>
              <th className="text-right px-4 py-3 font-semibold">变化率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {changes.map((c) => {
              let rowClass = "text-slate-300";
              let rankBadge: React.ReactNode = null;
              if (c.status === "up") {
                rowClass = "text-emerald-300";
                rankBadge = (
                  <span className={`inline-flex items-center gap-1 ${c.highlight ? "font-bold" : ""}`}>
                    <ArrowUp size={14} className="text-emerald-400" />
                    <span>{c.rank_delta}</span>
                  </span>
                );
              } else if (c.status === "down") {
                rowClass = "text-red-300";
                rankBadge = (
                  <span className={`inline-flex items-center gap-1 ${c.highlight ? "font-bold" : ""}`}>
                    <ArrowDown size={14} className="text-red-400" />
                    <span>{Math.abs(c.rank_delta!)}</span>
                  </span>
                );
              } else if (c.status === "unchanged") {
                rowClass = "text-slate-300";
                rankBadge = (
                  <span className="inline-flex items-center gap-1 text-slate-500">
                    <Minus size={14} />
                    <span>0</span>
                  </span>
                );
              } else if (c.status === "new") {
                rowClass = "text-amber-300";
                rankBadge = (
                  <span className="inline-flex items-center gap-1 text-amber-400 font-semibold">
                    <Plus size={14} />
                    <span>NEW</span>
                  </span>
                );
              } else if (c.status === "removed") {
                rowClass = "text-slate-500";
                rankBadge = (
                  <span className="inline-flex items-center gap-1 text-slate-500 line-through">
                    <X size={14} />
                    <span>REMOVED</span>
                  </span>
                );
              }

              const highlight = c.highlight;

              return (
                <tr
                  key={c.feature}
                  className={`${rowClass} hover:bg-slate-800/50 transition-colors ${
                    highlight ? "bg-slate-800/40" : ""
                  }`}
                >
                  <td className={`px-4 py-2.5 font-mono ${highlight ? "font-extrabold" : "font-medium"}`}>
                    {highlight && (c.status === "up" ? (
                      <ChevronsUp size={14} className="inline mr-1 text-emerald-400" />
                    ) : c.status === "down" ? (
                      <ChevronsDown size={14} className="inline mr-1 text-red-400" />
                    ) : null)}
                    {c.feature}
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono">
                    {c.rank_a ?? <span className="text-slate-600">-</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono">
                    {c.rank_b ?? <span className="text-slate-600">-</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono">{rankBadge}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-400">
                    {c.value_a !== 0 ? c.value_a.toFixed(5) : <span className="text-slate-600">-</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-400">
                    {c.value_b !== 0 ? c.value_b.toFixed(5) : <span className="text-slate-600">-</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {c.value_change_pct !== null && c.value_change_pct !== undefined ? (
                      <span
                        className={
                          c.value_change_pct > 0
                            ? "text-emerald-400"
                            : c.value_change_pct < 0
                            ? "text-red-400"
                            : "text-slate-400"
                        }
                      >
                        {c.value_change_pct > 0 ? "+" : ""}
                        {c.value_change_pct}%
                      </span>
                    ) : (
                      <span className="text-slate-600">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InteractionCards({ changes }: { changes: InteractionChange[] }) {
  const sorted = useMemo(() => {
    return [...changes].sort((a, b) => {
      const order = { new: 0, removed: 1, common: 2 } as const;
      return order[a.status] - order[b.status];
    });
  }, [changes]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded bg-purple-500/20 text-purple-400">
          <Sparkles size={16} />
        </div>
        <h4 className="text-base font-semibold text-white">2. 交互关系变化</h4>
        <span className="text-xs text-slate-500 ml-1">
          Top-5 交互对新增/消失情况及强度变化
        </span>
      </div>
      {sorted.length === 0 ? (
        <div className="text-center py-8 text-sm text-slate-500 border border-dashed border-slate-700 rounded-lg">
          无交互数据可供对比
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sorted.map((c, idx) => {
            let statusBadge: React.ReactNode = null;
            let statusBg = "";
            let borderColor = "border-slate-700";

            if (c.status === "new") {
              statusBg = "bg-emerald-500/10";
              borderColor = "border-emerald-500/50";
              statusBadge = (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  <Plus size={12} /> 新增交互对
                </span>
              );
            } else if (c.status === "removed") {
              statusBg = "bg-red-500/10";
              borderColor = "border-red-500/50";
              statusBadge = (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-red-500/20 text-red-300 border border-red-500/40">
                  <X size={12} /> 消失交互对
                </span>
              );
            } else {
              const dir = c.direction;
              let dirIcon = null;
              let dirColor = "text-slate-400";
              if (dir === "up") {
                dirIcon = <TrendingUp size={14} className="text-emerald-400" />;
                dirColor = "text-emerald-400";
              } else if (dir === "down") {
                dirIcon = <TrendingDown size={14} className="text-red-400" />;
                dirColor = "text-red-400";
              } else {
                dirIcon = <Minus size={14} className="text-slate-400" />;
              }
              statusBadge = (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-slate-700/60 ${dirColor} border border-slate-600`}>
                  {dirIcon}
                  {c.change_pct !== null && c.change_pct !== undefined
                    ? `${c.change_pct > 0 ? "+" : ""}${c.change_pct}%`
                    : "强度未变"}
                </span>
              );
            }

            return (
              <div
                key={idx}
                className={`border ${borderColor} rounded-lg p-4 ${statusBg} transition-all hover:shadow-lg`}
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="font-mono text-sm text-white font-semibold truncate">
                    {c.feature_a}
                    <span className="text-slate-500 mx-1">×</span>
                    {c.feature_b}
                  </div>
                  {statusBadge}
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-2.5">
                    <div className="text-blue-400 font-semibold mb-1 flex items-center gap-1">
                      <Layers size={12} /> 版本A强度
                    </div>
                    <div className="font-mono text-white text-base font-semibold">
                      {c.strength_a !== null ? c.strength_a.toFixed(5) : <span className="text-slate-600">-</span>}
                    </div>
                  </div>
                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-2.5">
                    <div className="text-emerald-400 font-semibold mb-1 flex items-center gap-1">
                      <Layers size={12} /> 版本B强度
                    </div>
                    <div className="font-mono text-white text-base font-semibold">
                      {c.strength_b !== null ? c.strength_b.toFixed(5) : <span className="text-slate-600">-</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DAGDiffSection(props: {
  diffs: DAGDiff[];
  selected: string | null;
  onSelected: (f: string | null) => void;
  idA: number;
  idB: number;
}) {
  const { diffs, selected, onSelected, idA, idB } = props;
  const current = diffs.find((d) => d.feature === selected) || diffs[0] || null;

  const edgeKeysA = useMemo(() => {
    if (!current?.tree_a) return new Set<string>();
    const keys = new Set<string>();
    const walk = (n: DAGTreeNode, p: string | null = null) => {
      if (p) keys.add(`${p}->${n.name}`);
      (n.children || []).forEach((c) => walk(c, n.name));
    };
    walk(current.tree_a);
    return keys;
  }, [current]);

  const edgeKeysB = useMemo(() => {
    if (!current?.tree_b) return new Set<string>();
    const keys = new Set<string>();
    const walk = (n: DAGTreeNode, p: string | null = null) => {
      if (p) keys.add(`${p}->${n.name}`);
      (n.children || []).forEach((c) => walk(c, n.name));
    };
    walk(current.tree_b);
    return keys;
  }, [current]);

  function buildCompareTreeOption(node: DAGTreeNode | null, mode: "a" | "b") {
    if (!node) return null;
    function convert(n: DAGTreeNode, parent: string | null = null): any {
      const children = (n.children || []).map((c) => convert(c, n.name));
      const weightLabel =
        n.contribution_weight !== undefined
          ? ` (${(n.contribution_weight * 100).toFixed(1)}%)`
          : n.shap_importance !== undefined
          ? ` (|SHAP|=${n.shap_importance.toFixed(4)})`
          : "";

      let lineStyle: any = undefined;
      if (parent) {
        const ek = `${parent}->${n.name}`;
        if (mode === "b" && !edgeKeysA.has(ek) && edgeKeysB.has(ek)) {
          lineStyle = { color: "#22c55e", width: 3, type: "dashed" };
        } else if (mode === "a" && edgeKeysA.has(ek) && !edgeKeysB.has(ek)) {
          lineStyle = { color: "#ef4444", width: 3, type: "dashed" };
        }
      }
      return {
        name: `${n.name}${weightLabel}`,
        children,
        lineStyle,
      };
    }
    const treeData = convert(node);
    return {
      tooltip: {
        trigger: "item",
        backgroundColor: "#1e293b",
        borderColor: "#334155",
        textStyle: { color: "#f1f5f9" },
      },
      series: [
        {
          type: "tree",
          data: [treeData],
          top: "10%",
          left: "8%",
          bottom: "10%",
          right: "12%",
          symbolSize: 9,
          orient: "LR",
          label: {
            position: "left",
            verticalAlign: "middle",
            align: "right",
            color: "#f1f5f9",
            fontFamily: "JetBrains Mono",
            fontSize: 10,
          },
          leaves: {
            label: {
              position: "right",
              verticalAlign: "middle",
              align: "left",
              color: "#94a3b8",
              fontSize: 10,
            },
          },
          expandAndCollapse: true,
          lineStyle: { color: "#475569", width: 1.5 },
          itemStyle: {
            color: mode === "a" ? "#3b82f6" : "#10b981",
            borderColor: mode === "a" ? "#1d4ed8" : "#059669",
          },
        },
      ],
    };
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded bg-cyan-500/20 text-cyan-400">
          <GitMerge size={16} />
        </div>
        <h4 className="text-base font-semibold text-white">3. DAG结构差异</h4>
        <span className="text-xs text-slate-500 ml-1">
          左右并排对比，变化的边用虚线标注（绿色新增/红色移除）
        </span>
      </div>

      {diffs.length === 0 ? (
        <div className="text-center py-10 text-sm border border-dashed border-slate-700 rounded-lg space-y-2">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
            <Check size={16} />
            <span>所有特征的DAG结构在两个版本间完全一致，无差异</span>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {diffs.map((d) => {
              const active = (selected || diffs[0]?.feature) === d.feature;
              return (
                <button
                  key={d.feature}
                  onClick={() => onSelected(active ? null : d.feature)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all ${
                    active
                      ? "bg-cyan-500 text-white shadow-lg shadow-cyan-500/30"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  <MousePointerClick size={12} className="inline mr-1 opacity-70" />
                  {d.feature}
                  <span className="ml-2 opacity-60">
                    +{d.added_edges.length}/-{d.removed_edges.length}
                  </span>
                </button>
              );
            })}
          </div>

          {current && (
            <div className="border border-slate-700 rounded-lg overflow-hidden">
              <div className="grid grid-cols-2 divide-x divide-slate-700">
                <div className="bg-blue-500/5">
                  <div className="px-4 py-2 border-b border-slate-700 flex items-center justify-between bg-blue-500/10">
                    <span className="text-xs font-semibold text-blue-300 flex items-center gap-1.5">
                      <Layers size={12} /> 版本A · #{idA}
                    </span>
                    {current.removed_edges.length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40">
                        移除 {current.removed_edges.length} 条边
                      </span>
                    )}
                  </div>
                  <div style={{ height: 360 }}>
                    <EChartsWrapper option={buildCompareTreeOption(current.tree_a, "a") as unknown as echarts.EChartsOption} />
                  </div>
                </div>
                <div className="bg-emerald-500/5">
                  <div className="px-4 py-2 border-b border-slate-700 flex items-center justify-between bg-emerald-500/10">
                    <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                      <Layers size={12} /> 版本B · #{idB}
                    </span>
                    {current.added_edges.length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        新增 {current.added_edges.length} 条边
                      </span>
                    )}
                  </div>
                  <div style={{ height: 360 }}>
                    <EChartsWrapper option={buildCompareTreeOption(current.tree_b, "b") as unknown as echarts.EChartsOption} />
                  </div>
                </div>
              </div>
              {(current.added_edges.length > 0 || current.removed_edges.length > 0) && (
                <div className="px-4 py-3 border-t border-slate-700 bg-slate-800/50 space-y-2 text-xs">
                  {current.removed_edges.length > 0 && (
                    <div>
                      <div className="text-red-400 font-semibold mb-1 flex items-center gap-1">
                        <ArrowDown size={12} /> 移除的边 ({current.removed_edges.length})
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {current.removed_edges.map((e, i) => (
                          <span key={`r-${i}`} className="font-mono px-2 py-0.5 rounded bg-red-500/15 text-red-200 border border-red-500/30">
                            {e.source} → {e.target}
                            {e.operation && <span className="text-red-400/70 ml-1">({e.operation})</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {current.added_edges.length > 0 && (
                    <div>
                      <div className="text-emerald-400 font-semibold mb-1 flex items-center gap-1">
                        <ArrowUp size={12} /> 新增的边 ({current.added_edges.length})
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {current.added_edges.map((e, i) => (
                          <span key={`a-${i}`} className="font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-200 border border-emerald-500/30">
                            {e.source} → {e.target}
                            {e.operation && <span className="text-emerald-400/70 ml-1">({e.operation})</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
