import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import * as echarts from "echarts";
import {
  startFeatureAttribution,
  getLatestFeatureAttribution,
  getWebSocketUrl,
  type FeatureAttribution,
  type FeatureAttributionWSMessage,
  type DAGTreeNode,
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
} from "lucide-react";

export default function FeatureAttributionPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const [error, setError] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);

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

  function buildTreeOption() {
    if (!selectedTreeData) return null;

    function convert(node: DAGTreeNode): any {
      const children = node.children?.map(convert) ?? [];
      const weightLabel =
        node.contribution_weight !== undefined
          ? ` (${(node.contribution_weight * 100).toFixed(1)}%)`
          : node.shap_importance !== undefined
          ? ` (|SHAP|=${node.shap_importance.toFixed(4)})`
          : "";
      return {
        name: `${node.name}${weightLabel}`,
        children,
      };
    }

    const treeData = convert(selectedTreeData);

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
          right: "20%",
          symbolSize: 10,
          orient: "LR",
          label: {
            position: "left",
            verticalAlign: "middle",
            align: "right",
            color: "#f1f5f9",
            fontFamily: "JetBrains Mono",
            fontSize: 11,
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
            color: "#10b981",
            borderColor: "#059669",
          },
        },
      ],
    };
  }

  return (
    <div className="animate-fade-in space-y-6">
      <StepProgress />
      <h2 className="text-2xl font-bold text-white flex items-center gap-2">
        <GitBranch size={22} /> Feature Attribution Report
      </h2>

      <div className="flex items-center gap-4">
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
                <EChartsWrapper option={buildTreeOption() as unknown as echarts.EChartsOption} />
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
    </div>
  );
}
