import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import * as echarts from "echarts";
import { startExplainability, getGlobalSHAP, getLocalSHAP } from "@/utils/api";
import { useTaskStore } from "@/stores/taskStore";
import { useWebSocket } from "@/hooks/useWebSocket";
import EChartsWrapper from "@/components/EChartsWrapper";
import StepProgress from "@/components/StepProgress";
import { Loader2, AlertCircle, Play, ChevronRight, Search } from "lucide-react";

export default function ExplainabilityPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [sampleIndex, setSampleIndex] = useState(0);
  const [localLoading, setLocalLoading] = useState(false);
  const globalSHAP = useTaskStore((s) => s.globalSHAP);
  const localSHAP = useTaskStore((s) => s.localSHAP);
  const explainabilityStatus = useTaskStore((s) => s.explainabilityStatus);
  const setGlobalSHAP = useTaskStore((s) => s.setGlobalSHAP);
  const setLocalSHAP = useTaskStore((s) => s.setLocalSHAP);
  const setExplainabilityStatus = useTaskStore((s) => s.setExplainabilityStatus);
  const setStep = useTaskStore((s) => s.setStep);

  const { lastMessage } = useWebSocket(taskId, {
    onMessage: (data) => {
      const msg = data as { type?: string; status?: string };
      if (msg.type === "explainability") {
        if (msg.status === "completed" && taskId) {
          setExplainabilityStatus("completed");
          getGlobalSHAP(taskId).then(setGlobalSHAP).catch(() => {});
        } else if (msg.status === "running") {
          setExplainabilityStatus("running");
        }
      }
    },
  });

  useEffect(() => {
    if (!taskId) return;
    getGlobalSHAP(taskId)
      .then((data) => {
        setGlobalSHAP(data);
        setExplainabilityStatus("completed");
      })
      .catch(() => {});
  }, [taskId, setGlobalSHAP, setExplainabilityStatus]);

  const handleStart = async () => {
    if (!taskId) return;
    setExplainabilityStatus("running");
    setError(null);
    try {
      await startExplainability(taskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
      setExplainabilityStatus("error");
    }
  };

  const handleFetchLocal = async () => {
    if (!taskId) return;
    setLocalLoading(true);
    try {
      const data = await getLocalSHAP(taskId, sampleIndex);
      setLocalSHAP(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLocalLoading(false);
    }
  };

  const isRunning = explainabilityStatus === "running";
  const top20 = globalSHAP?.abs_mean.slice(0, 20) ?? [];

  return (
    <div className="animate-fade-in space-y-6">
      <StepProgress />
      <h2 className="text-2xl font-bold text-white">Explainability</h2>

      <div className="flex items-center gap-4">
        <button
          onClick={handleStart}
          disabled={isRunning}
          className="btn-primary flex items-center gap-2"
        >
          {isRunning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          {isRunning ? "Computing SHAP..." : "Start Explainability Analysis"}
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
            <p className="font-medium text-white">Computing SHAP values...</p>
            <p className="text-sm text-slate-400">This may take a while for large datasets</p>
          </div>
        </div>
      )}

      {globalSHAP && (
        <div className="space-y-6 animate-slide-up">
          <h3 className="text-xl font-semibold text-white">Global SHAP Importance</h3>

          <div className="card">
            <h4 className="mb-3 text-sm font-semibold text-slate-300">Top 20 Features by Mean |SHAP|</h4>
            <div style={{ height: Math.max(300, top20.length * 24) }}>
              <EChartsWrapper
                option={{
                  tooltip: { trigger: "axis", backgroundColor: "#1e293b", borderColor: "#334155", textStyle: { color: "#f1f5f9" } },
                  grid: { left: 160, right: 30, top: 10, bottom: 30 },
                  xAxis: { type: "value", axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "#334155" } } },
                  yAxis: {
                    type: "category",
                    data: top20.map((f) => f.feature).reverse(),
                    axisLabel: { color: "#94a3b8", fontFamily: "JetBrains Mono", fontSize: 10 },
                  },
                  series: [{
                    type: "bar",
                    data: top20.map((f) => ({
                      value: f.value,
                      itemStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                          { offset: 0, color: "#10b981" },
                          { offset: 1, color: "#059669" },
                        ]),
                      },
                    })).reverse(),
                    barWidth: 14,
                  }],
                }}
              />
            </div>
          </div>

          {globalSHAP.beeswarm.length > 0 && (
            <div className="card">
              <h4 className="mb-3 text-sm font-semibold text-slate-300">Beeswarm Plot</h4>
              <div style={{ height: 400 }}>
                <EChartsWrapper
                  option={{
                    tooltip: {
                      trigger: "item",
                      backgroundColor: "#1e293b",
                      borderColor: "#334155",
                      textStyle: { color: "#f1f5f9", fontSize: 10 },
                      formatter: (params: any) => {
                        const d = params.data as [string, number, number, string];
                        return `<b>${d[3]}</b><br/>SHAP: ${d[1].toFixed(3)}<br/>Value: ${d[2].toFixed(3)}`;
                      },
                    },
                    grid: { left: 160, right: 30, top: 10, bottom: 30 },
                    xAxis: { type: "value", axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "#334155" } } },
                    yAxis: {
                      type: "category",
                      data: top20.map((f) => f.feature).reverse(),
                      axisLabel: { color: "#94a3b8", fontFamily: "JetBrains Mono", fontSize: 10 },
                    },
                    series: [{
                      type: "scatter",
                      data: globalSHAP.beeswarm
                        .filter((b) => top20.some((f) => f.feature === b.feature))
                        .map((b) => {
                          const idx = top20.findIndex((f) => f.feature === b.feature);
                          return [idx, b.shap_value, b.feature_value, b.feature] as [number, number, number, string];
                        })
                        .map((d) => {
                          const norm = Math.abs(d[2]);
                          const r = Math.min(1, norm);
                          return {
                            value: [d[1], top20.map((f) => f.feature).reverse().indexOf(d[3]) === -1 ? 0 : top20.map((f) => f.feature).reverse().indexOf(d[3]), d[2], d[3]],
                            itemStyle: {
                              color: d[1] >= 0
                                ? `rgba(239, 68, 68, ${0.3 + r * 0.7})`
                                : `rgba(59, 130, 246, ${0.3 + r * 0.7})`,
                            },
                          };
                        }),
                      symbolSize: 5,
                    }],
                  }}
                />
              </div>
            </div>
          )}

          <div className="card">
            <h3 className="mb-4 text-lg font-semibold text-white">Local Explanation</h3>
            <div className="flex items-end gap-3 mb-4">
              <div>
                <label className="mb-1 block text-sm text-slate-400">Sample Index</label>
                <input
                  type="number"
                  min={0}
                  value={sampleIndex}
                  onChange={(e) => setSampleIndex(Number(e.target.value))}
                  className="input-field w-32 font-mono"
                />
              </div>
              <button
                onClick={handleFetchLocal}
                disabled={localLoading}
                className="btn-secondary flex items-center gap-2"
              >
                {localLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Explain
              </button>
            </div>

            {localSHAP && (
              <div className="space-y-4">
                <div className="flex gap-6">
                  <div>
                    <p className="text-sm text-slate-400">Base Value</p>
                    <p className="font-mono text-lg font-bold text-slate-300">{localSHAP.base_value.toFixed(4)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-400">Prediction</p>
                    <p className="font-mono text-lg font-bold text-emerald-400">{localSHAP.prediction.toFixed(4)}</p>
                  </div>
                </div>

                <div style={{ height: Math.max(200, localSHAP.contributions.length * 24) }}>
                  <EChartsWrapper
                    option={{
                      tooltip: { trigger: "axis", backgroundColor: "#1e293b", borderColor: "#334155", textStyle: { color: "#f1f5f9" } },
                      grid: { left: 160, right: 30, top: 10, bottom: 30 },
                      xAxis: { type: "value", axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "#334155" } } },
                      yAxis: {
                        type: "category",
                        data: localSHAP.contributions.map((c) => `${c.feature} = ${c.value}`).reverse(),
                        axisLabel: { color: "#94a3b8", fontFamily: "JetBrains Mono", fontSize: 10 },
                      },
                      series: [{
                        type: "bar",
                        data: localSHAP.contributions.map((c) => ({
                          value: c.shap,
                          itemStyle: {
                            color: c.shap >= 0 ? "#ef4444" : "#3b82f6",
                          },
                        })).reverse(),
                        barWidth: 14,
                        label: {
                          show: true,
                          position: "right",
                          color: "#94a3b8",
                          fontFamily: "JetBrains Mono",
                          fontSize: 10,
                          formatter: (params: any) => Number(params.value).toFixed(3),
                        },
                      }],
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => {
                setStep("pipeline");
                navigate(`/pipeline/${taskId}`);
              }}
              className="btn-primary flex items-center gap-2"
            >
              <ChevronRight size={16} />
              Next: Pipeline
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
