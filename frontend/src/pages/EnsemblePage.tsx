import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import * as echarts from "echarts";
import { startEnsemble, getEnsembleResult } from "@/utils/api";
import { useTaskStore } from "@/stores/taskStore";
import { useWebSocket } from "@/hooks/useWebSocket";
import EChartsWrapper from "@/components/EChartsWrapper";
import StepProgress from "@/components/StepProgress";
import { Loader2, AlertCircle, Play, ChevronRight, TrendingUp, Layers } from "lucide-react";

export default function EnsemblePage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const ensembleResult = useTaskStore((s) => s.ensembleResult);
  const ensembleStatus = useTaskStore((s) => s.ensembleStatus);
  const setEnsembleResult = useTaskStore((s) => s.setEnsembleResult);
  const setEnsembleStatus = useTaskStore((s) => s.setEnsembleStatus);
  const setStep = useTaskStore((s) => s.setStep);

  const { lastMessage } = useWebSocket(taskId, {
    onMessage: (data) => {
      const msg = data as { type?: string; status?: string };
      if (msg.type === "ensemble") {
        if (msg.status === "completed" && taskId) {
          setEnsembleStatus("completed");
          getEnsembleResult(taskId).then(setEnsembleResult).catch(() => {});
        } else if (msg.status === "running") {
          setEnsembleStatus("running");
        }
      }
    },
  });

  useEffect(() => {
    if (!taskId) return;
    getEnsembleResult(taskId)
      .then((data) => {
        setEnsembleResult(data);
        setEnsembleStatus("completed");
      })
      .catch(() => {});
  }, [taskId, setEnsembleResult, setEnsembleStatus]);

  const handleStart = async () => {
    if (!taskId) return;
    setEnsembleStatus("running");
    setError(null);
    try {
      await startEnsemble(taskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
      setEnsembleStatus("error");
    }
  };

  const isRunning = ensembleStatus === "running";

  return (
    <div className="animate-fade-in space-y-6">
      <StepProgress />
      <h2 className="text-2xl font-bold text-white">Ensemble</h2>

      <div className="flex items-center gap-4">
        <button
          onClick={handleStart}
          disabled={isRunning}
          className="btn-primary flex items-center gap-2"
        >
          {isRunning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          {isRunning ? "Building Ensemble..." : "Start Ensemble"}
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
            <p className="font-medium text-white">Ensemble training in progress...</p>
            <p className="text-sm text-slate-400">Building stacking and blending models</p>
          </div>
        </div>
      )}

      {ensembleResult && (
        <div className="space-y-6 animate-slide-up">
          <div className="grid grid-cols-2 gap-4">
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <Layers size={18} className="text-emerald-400" />
                <h3 className="text-base font-semibold text-white">Method</h3>
              </div>
              <p className="font-mono text-2xl font-bold text-emerald-400">{ensembleResult.method}</p>
              <div className="mt-3 space-y-1">
                <p className="text-sm text-slate-400">Meta-learner: <span className="font-mono text-white">{ensembleResult.meta_learner}</span></p>
              </div>
              <div className="mt-3">
                <p className="text-sm text-slate-400 mb-1">Base Models</p>
                <div className="flex flex-wrap gap-1.5">
                  {ensembleResult.base_models.map((m) => (
                    <span key={m} className="badge badge-info font-mono text-xs">{m}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={18} className="text-amber-400" />
                <h3 className="text-base font-semibold text-white">Improvement</h3>
              </div>
              <p className="font-mono text-4xl font-bold text-amber-400">
                +{(ensembleResult.improvement * 100).toFixed(2)}%
              </p>
              <p className="mt-1 text-sm text-slate-400">over best single model</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-slate-800/50 p-2 text-center">
                  <p className="text-xs text-slate-500">Ensemble</p>
                  <p className="font-mono text-lg font-bold text-emerald-400">{ensembleResult.score.toFixed(4)}</p>
                </div>
                <div className="rounded-lg bg-slate-800/50 p-2 text-center">
                  <p className="text-xs text-slate-500">Best Single</p>
                  <p className="font-mono text-lg font-bold text-slate-300">
                    {ensembleResult.comparison.find((c) => c.model !== ensembleResult.method)?.score?.toFixed(4) ?? "-"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="mb-4 text-lg font-semibold text-white">Model Comparison</h3>
            <div style={{ height: 300 }}>
              <EChartsWrapper
                option={{
                  tooltip: { trigger: "axis", backgroundColor: "#1e293b", borderColor: "#334155", textStyle: { color: "#f1f5f9" } },
                  grid: { left: 120, right: 30, top: 10, bottom: 30 },
                  xAxis: { type: "value", axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "#334155" } } },
                  yAxis: {
                    type: "category",
                    data: ensembleResult.comparison.map((c) => c.model).reverse(),
                    axisLabel: { color: "#94a3b8", fontFamily: "JetBrains Mono" },
                  },
                  series: [{
                    type: "bar",
                    data: ensembleResult.comparison.map((c) => ({
                      value: c.score,
                      itemStyle: {
                        color: c.model === ensembleResult.method ? "#10b981" : "#64748b",
                      },
                    })).reverse(),
                    barWidth: 20,
                    label: {
                      show: true,
                      position: "right",
                      color: "#94a3b8",
                      fontFamily: "JetBrains Mono",
                      fontSize: 11,
                      formatter: (params: any) => Number(params.value).toFixed(4),
                    },
                  }],
                }}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => {
                setStep("explainability");
                navigate(`/explainability/${taskId}`);
              }}
              className="btn-primary flex items-center gap-2"
            >
              <ChevronRight size={16} />
              Next: Explainability
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
