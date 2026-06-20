import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import * as echarts from "echarts";
import { startModelSearch, getModelSearchResult, getModelSearchProgress } from "@/utils/api";
import { useTaskStore } from "@/stores/taskStore";
import { useWebSocket } from "@/hooks/useWebSocket";
import EChartsWrapper from "@/components/EChartsWrapper";
import StepProgress from "@/components/StepProgress";
import { Loader2, AlertCircle, Play, ChevronRight, Trophy } from "lucide-react";

export default function ModelSearchPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const modelSearchResult = useTaskStore((s) => s.modelSearchResult);
  const modelSearchProgress = useTaskStore((s) => s.modelSearchProgress);
  const modelSearchStatus = useTaskStore((s) => s.modelSearchStatus);
  const setModelSearchResult = useTaskStore((s) => s.setModelSearchResult);
  const setModelSearchProgress = useTaskStore((s) => s.setModelSearchProgress);
  const setModelSearchStatus = useTaskStore((s) => s.setModelSearchStatus);
  const setStep = useTaskStore((s) => s.setStep);

  const { lastMessage } = useWebSocket(taskId, {
    onMessage: (data) => {
      const msg = data as {
        type?: string;
        status?: string;
        current_model?: string;
        trial?: number;
        total_trials?: number;
        best_score?: number;
      };
      if (msg.type === "model_search") {
        if (msg.status === "completed" && taskId) {
          setModelSearchStatus("completed");
          getModelSearchResult(taskId).then(setModelSearchResult).catch(() => {});
        } else if (msg.status === "running" || msg.current_model) {
          setModelSearchStatus("running");
          setModelSearchProgress({
            current_model: msg.current_model || "",
            trial: msg.trial || 0,
            total_trials: msg.total_trials || 50,
            best_score: msg.best_score || 0,
            models_completed: [],
          });
        }
      }
    },
  });

  useEffect(() => {
    if (!taskId) return;
    getModelSearchResult(taskId)
      .then((data) => {
        setModelSearchResult(data);
        setModelSearchStatus("completed");
      })
      .catch(() => {});
  }, [taskId, setModelSearchResult, setModelSearchStatus]);

  const handleStart = async () => {
    if (!taskId) return;
    setModelSearchStatus("running");
    setError(null);
    try {
      await startModelSearch(taskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
      setModelSearchStatus("error");
    }
  };

  const isRunning = modelSearchStatus === "running";

  return (
    <div className="animate-fade-in space-y-6">
      <StepProgress />
      <h2 className="text-2xl font-bold text-white">Model Search</h2>

      <div className="flex items-center gap-4">
        <button
          onClick={handleStart}
          disabled={isRunning}
          className="btn-primary flex items-center gap-2"
        >
          {isRunning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          {isRunning ? "Searching..." : "Start Model Search"}
        </button>
        {error && (
          <div className="flex items-center gap-2 text-red-300 text-sm">
            <AlertCircle size={14} />
            {error}
          </div>
        )}
      </div>

      {isRunning && modelSearchProgress && (
        <div className="space-y-4">
          <div className="card">
            <div className="grid grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-slate-400">Current Model</p>
                <p className="font-mono text-lg font-bold text-white">{modelSearchProgress.current_model}</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Trial Progress</p>
                <p className="font-mono text-lg font-bold text-emerald-400">
                  {modelSearchProgress.trial}/{modelSearchProgress.total_trials}
                </p>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-700">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${(modelSearchProgress.trial / modelSearchProgress.total_trials) * 100}%`,
                      backgroundColor: "#10b981",
                    }}
                  />
                </div>
              </div>
              <div>
                <p className="text-sm text-slate-400">Best Score</p>
                <p className="font-mono text-lg font-bold text-amber-400">
                  {modelSearchProgress.best_score?.toFixed(4)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {modelSearchResult && (
        <div className="space-y-6 animate-slide-up">
          <h3 className="text-xl font-semibold text-white">Search Results</h3>

          {modelSearchResult.score_history.length > 0 && (
            <div className="card">
              <h4 className="mb-3 text-sm font-semibold text-slate-300">Score Evolution</h4>
              <div style={{ height: 300 }}>
                <EChartsWrapper
                  option={{
                    tooltip: { trigger: "axis", backgroundColor: "#1e293b", borderColor: "#334155", textStyle: { color: "#f1f5f9" } },
                    grid: { left: 60, right: 30, top: 20, bottom: 30 },
                    xAxis: { type: "category", data: modelSearchResult.score_history.map((h) => `#${h.trial}`), axisLabel: { color: "#94a3b8" } },
                    yAxis: { type: "value", axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "#334155" } } },
                    series: [{
                      type: "line",
                      data: modelSearchResult.score_history.map((h) => h.score),
                      smooth: true,
                      lineStyle: { color: "#10b981", width: 2 },
                      areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                          { offset: 0, color: "rgba(16, 185, 129, 0.3)" },
                          { offset: 1, color: "rgba(16, 185, 129, 0)" },
                        ]),
                      },
                      itemStyle: { color: "#10b981" },
                      symbolSize: 4,
                    }],
                  }}
                />
              </div>
            </div>
          )}

          <div className="card overflow-x-auto">
            <h4 className="mb-3 text-sm font-semibold text-slate-300">Model Comparison</h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "#334155" }}>
                  <th className="pb-3 text-left font-medium text-slate-400">Rank</th>
                  <th className="pb-3 text-left font-medium text-slate-400">Model</th>
                  <th className="pb-3 text-right font-medium text-slate-400">Best Score</th>
                  <th className="pb-3 text-left font-medium text-slate-400">Best Params</th>
                </tr>
              </thead>
              <tbody>
                {modelSearchResult.models
                  .sort((a, b) => a.rank - b.rank)
                  .map((model) => {
                    const isBest = model.name === modelSearchResult.best_model;
                    return (
                      <tr
                        key={model.name}
                        className={`border-b ${isBest ? "bg-emerald-500/10" : ""}`}
                        style={{ borderColor: "#1e293b" }}
                      >
                        <td className="py-3 pr-4">
                          {isBest ? (
                            <Trophy size={16} className="text-amber-400" />
                          ) : (
                            <span className="font-mono text-slate-400">#{model.rank}</span>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`font-mono font-medium ${isBest ? "text-emerald-400" : "text-white"}`}>
                            {model.name}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-right font-mono">
                          <span className={isBest ? "text-emerald-400 font-bold" : "text-slate-300"}>
                            {model.best_score.toFixed(4)}
                          </span>
                        </td>
                        <td className="py-3 font-mono text-xs text-slate-500 max-w-xs truncate">
                          {JSON.stringify(model.best_params)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => {
                setStep("ensemble");
                navigate(`/ensemble/${taskId}`);
              }}
              className="btn-primary flex items-center gap-2"
            >
              <ChevronRight size={16} />
              Next: Ensemble
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
