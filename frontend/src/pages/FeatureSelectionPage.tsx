import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import * as echarts from "echarts";
import { startFeatureSelection, getFeatureSelectionResult } from "@/utils/api";
import { useTaskStore } from "@/stores/taskStore";
import { useWebSocket } from "@/hooks/useWebSocket";
import EChartsWrapper from "@/components/EChartsWrapper";
import StepProgress from "@/components/StepProgress";
import { Loader2, AlertCircle, Play, ChevronRight, Filter, CheckCircle2 } from "lucide-react";

export default function FeatureSelectionPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const featureSelectionResult = useTaskStore((s) => s.featureSelectionResult);
  const featureSelectionStatus = useTaskStore((s) => s.featureSelectionStatus);
  const setFeatureSelectionResult = useTaskStore((s) => s.setFeatureSelectionResult);
  const setFeatureSelectionStatus = useTaskStore((s) => s.setFeatureSelectionStatus);
  const setStep = useTaskStore((s) => s.setStep);

  const { lastMessage } = useWebSocket(taskId, {
    onMessage: (data) => {
      const msg = data as { type?: string; status?: string; stage?: string; result?: unknown };
      if (msg.type === "feature_selection") {
        if (msg.status === "completed" && taskId) {
          setFeatureSelectionStatus("completed");
          getFeatureSelectionResult(taskId).then(setFeatureSelectionResult).catch(() => {});
        } else if (msg.status === "running") {
          setFeatureSelectionStatus("running");
        }
      }
    },
  });

  useEffect(() => {
    if (!taskId) return;
    getFeatureSelectionResult(taskId)
      .then((data) => {
        setFeatureSelectionResult(data);
        setFeatureSelectionStatus("completed");
      })
      .catch(() => {})
      .finally(() => {});
  }, [taskId, setFeatureSelectionResult, setFeatureSelectionStatus]);

  const handleStart = async () => {
    if (!taskId) return;
    setFeatureSelectionStatus("running");
    setError(null);
    try {
      await startFeatureSelection(taskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
      setFeatureSelectionStatus("error");
    }
  };

  const isRunning = featureSelectionStatus === "running";

  const top30 = featureSelectionResult?.importance.slice(0, 30) ?? [];

  return (
    <div className="animate-fade-in space-y-6">
      <StepProgress />
      <h2 className="text-2xl font-bold text-white">Feature Selection</h2>

      <div className="flex items-center gap-4">
        <button
          onClick={handleStart}
          disabled={isRunning}
          className="btn-primary flex items-center gap-2"
        >
          {isRunning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          {isRunning ? "Selecting Features..." : "Start Feature Selection"}
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
            <p className="font-medium text-white">Feature selection in progress...</p>
            <p className="text-sm text-slate-400">Running Filter → Wrapper → Embedded stages</p>
          </div>
        </div>
      )}

      {featureSelectionResult && (
        <div className="space-y-6 animate-slide-up">
          <h3 className="text-xl font-semibold text-white">Three-Stage Selection</h3>

          <div className="grid grid-cols-3 gap-4">
            {featureSelectionResult.stages.map((stage, idx) => {
              const stageColors = ["#3b82f6", "#f59e0b", "#10b981"];
              const stageIcons = [<Filter key="0" size={20} />, <Filter key="1" size={20} />, <CheckCircle2 key="2" size={20} />];
              return (
                <div key={stage.name} className="card">
                  <div className="flex items-center gap-2 mb-3" style={{ color: stageColors[idx] }}>
                    {stageIcons[idx]}
                    <h4 className="font-semibold text-white">{stage.name}</h4>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-slate-400">Remaining</span>
                      <span className="font-mono font-bold text-emerald-400">{stage.remaining}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-slate-400">Removed</span>
                      <span className="font-mono text-amber-400">{stage.removed.length}</span>
                    </div>
                    {stage.removed.length > 0 && (
                      <div className="mt-2 max-h-24 overflow-y-auto rounded bg-slate-900/50 p-2">
                        {stage.removed.map((f) => (
                          <p key={f} className="font-mono text-xs text-slate-500">{f}</p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card">
            <h3 className="mb-4 text-lg font-semibold text-white">Feature Importance (Top 30)</h3>
            <div style={{ height: Math.max(400, top30.length * 22) }}>
              <EChartsWrapper
                option={{
                  tooltip: { trigger: "axis", backgroundColor: "#1e293b", borderColor: "#334155", textStyle: { color: "#f1f5f9" } },
                  grid: { left: 180, right: 30, top: 10, bottom: 30 },
                  xAxis: { type: "value", axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "#334155" } } },
                  yAxis: {
                    type: "category",
                    data: top30.map((f) => f.feature).reverse(),
                    axisLabel: { color: "#94a3b8", fontFamily: "JetBrains Mono", fontSize: 10 },
                  },
                  series: [{
                    type: "bar",
                    data: top30.map((f, i) => ({
                      value: f.importance,
                      itemStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                          { offset: 0, color: "#10b981" },
                          { offset: 1, color: `rgba(16, 185, 129, ${0.3 + (i / top30.length) * 0.7})` },
                        ]),
                      },
                    })).reverse(),
                    barWidth: 14,
                  }],
                }}
              />
            </div>
          </div>

          <div className="card">
            <p className="text-slate-400">
              Final selected features: <span className="font-mono font-bold text-emerald-400">{featureSelectionResult.final_features.length}</span>
            </p>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => {
                setStep("model_search");
                navigate(`/model-search/${taskId}`);
              }}
              className="btn-primary flex items-center gap-2"
            >
              <ChevronRight size={16} />
              Next: Model Search
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
