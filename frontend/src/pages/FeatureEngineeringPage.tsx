import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { startFeatureEngineering, getFeatureEngineeringResult } from "@/utils/api";
import { useTaskStore } from "@/stores/taskStore";
import { useWebSocket } from "@/hooks/useWebSocket";
import EChartsWrapper from "@/components/EChartsWrapper";
import StepProgress from "@/components/StepProgress";
import { Loader2, AlertCircle, Play, ChevronRight } from "lucide-react";

interface ConfigState {
  numeric: { enabled: boolean; methods: string[] };
  categorical: { enabled: boolean; methods: string[] };
  datetime: { enabled: boolean; methods: string[] };
  text: { enabled: boolean; methods: string[] };
  cross: { enabled: boolean; methods: string[] };
}

const DEFAULT_CONFIG: ConfigState = {
  numeric: { enabled: true, methods: ["standard_scale", "minmax_scale", "log_transform", "polynomial"] },
  categorical: { enabled: true, methods: ["one_hot", "label_encode", "target_encode", "frequency_encode"] },
  datetime: { enabled: true, methods: ["extract_components", "time_since", "cyclic_encode"] },
  text: { enabled: true, methods: ["tfidf", "count_vectorize", "hash_vectorize"] },
  cross: { enabled: false, methods: ["pairwise_multiply", "pairwise_ratio", "pairwise_diff"] },
};

const METHOD_LABELS: Record<string, Record<string, string>> = {
  numeric: { standard_scale: "Standard Scale", minmax_scale: "MinMax Scale", log_transform: "Log Transform", polynomial: "Polynomial" },
  categorical: { one_hot: "One-Hot", label_encode: "Label Encode", target_encode: "Target Encode", frequency_encode: "Frequency Encode" },
  datetime: { extract_components: "Extract Components", time_since: "Time Since", cyclic_encode: "Cyclic Encode" },
  text: { tfidf: "TF-IDF", count_vectorize: "Count Vectorize", hash_vectorize: "Hash Vectorize" },
  cross: { pairwise_multiply: "Multiply", pairwise_ratio: "Ratio", pairwise_diff: "Difference" },
};

const TYPE_COLORS: Record<string, string> = {
  numeric: "#8b5cf6",
  categorical: "#f59e0b",
  datetime: "#06b6d4",
  text: "#ec4899",
  cross: "#10b981",
};

export default function FeatureEngineeringPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [config, setConfig] = useState<ConfigState>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const featureEngineeringResult = useTaskStore((s) => s.featureEngineeringResult);
  const featureEngineeringStatus = useTaskStore((s) => s.featureEngineeringStatus);
  const setFeatureEngineeringResult = useTaskStore((s) => s.setFeatureEngineeringResult);
  const setFeatureEngineeringStatus = useTaskStore((s) => s.setFeatureEngineeringStatus);
  const setStep = useTaskStore((s) => s.setStep);

  const { lastMessage } = useWebSocket(taskId, {
    onMessage: (data) => {
      const msg = data as { type?: string; status?: string; progress?: number; result?: unknown };
      if (msg.type === "feature_engineering") {
        if (msg.status === "completed" && msg.result && taskId) {
          setFeatureEngineeringStatus("completed");
          getFeatureEngineeringResult(taskId).then(setFeatureEngineeringResult).catch(() => {});
        } else if (msg.status === "running") {
          setFeatureEngineeringStatus("running");
        } else if (msg.status === "error") {
          setFeatureEngineeringStatus("error");
        }
      }
    },
  });

  useEffect(() => {
    if (!taskId) return;
    setLoading(true);
    getFeatureEngineeringResult(taskId)
      .then((data) => {
        setFeatureEngineeringResult(data);
        setFeatureEngineeringStatus("completed");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [taskId, setFeatureEngineeringResult, setFeatureEngineeringStatus]);

  const handleStart = async () => {
    if (!taskId) return;
    setFeatureEngineeringStatus("running");
    setError(null);
    try {
      const activeConfig: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(config)) {
        if (val.enabled) {
          activeConfig[key] = val.methods;
        }
      }
      await startFeatureEngineering(taskId, activeConfig);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
      setFeatureEngineeringStatus("error");
    }
  };

  const toggleMethod = (type: keyof ConfigState, method: string) => {
    setConfig((prev) => {
      const entry = prev[type];
      const methods = entry.methods.includes(method)
        ? entry.methods.filter((m) => m !== method)
        : [...entry.methods, method];
      return { ...prev, [type]: { ...entry, methods } };
    });
  };

  const toggleEnabled = (type: keyof ConfigState) => {
    setConfig((prev) => ({
      ...prev,
      [type]: { ...prev[type], enabled: !prev[type].enabled },
    }));
  };

  const isRunning = featureEngineeringStatus === "running";

  return (
    <div className="animate-fade-in space-y-6">
      <StepProgress />
      <h2 className="text-2xl font-bold text-white">Feature Engineering</h2>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(Object.keys(DEFAULT_CONFIG) as (keyof ConfigState)[]).map((type) => (
          <div key={type} className="card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: TYPE_COLORS[type] }} />
                <h3 className="text-base font-semibold text-white capitalize">{type} Transforms</h3>
              </div>
              <button
                onClick={() => toggleEnabled(type)}
                className={`relative h-6 w-11 rounded-full transition-colors duration-200 ${
                  config[type].enabled ? "bg-emerald-500" : "bg-slate-600"
                }`}
              >
                <div
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-200 ${
                    config[type].enabled ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(METHOD_LABELS[type]) as string[]).map((method) => (
                <button
                  key={method}
                  onClick={() => config[type].enabled && toggleMethod(type, method)}
                  disabled={!config[type].enabled}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    config[type].methods.includes(method) && config[type].enabled
                      ? "text-white"
                      : "bg-slate-700/50 text-slate-500"
                  }`}
                  style={
                    config[type].methods.includes(method) && config[type].enabled
                      ? { backgroundColor: TYPE_COLORS[type] }
                      : undefined
                  }
                >
                  {METHOD_LABELS[type][method]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={handleStart}
          disabled={isRunning}
          className="btn-primary flex items-center gap-2"
        >
          {isRunning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          {isRunning ? "Engineering Features..." : "Start Feature Engineering"}
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
            <p className="font-medium text-white">Feature engineering in progress...</p>
            <p className="text-sm text-slate-400">This may take a few minutes. Real-time updates via WebSocket.</p>
          </div>
        </div>
      )}

      {featureEngineeringResult && (
        <div className="space-y-4 animate-slide-up">
          <h3 className="text-xl font-semibold text-white">Results</h3>

          <div className="grid grid-cols-3 gap-4">
            <div className="card text-center">
              <p className="font-mono text-3xl font-bold text-white">{featureEngineeringResult.original_features}</p>
              <p className="text-sm text-slate-400">Original Features</p>
            </div>
            <div className="card text-center">
              <p className="font-mono text-3xl font-bold text-emerald-400">{featureEngineeringResult.generated_features}</p>
              <p className="text-sm text-slate-400">Generated Features</p>
            </div>
            <div className="card text-center">
              <p className="font-mono text-3xl font-bold text-amber-400">
                +{((featureEngineeringResult.generated_features / featureEngineeringResult.original_features - 1) * 100).toFixed(0)}%
              </p>
              <p className="text-sm text-slate-400">Dimension Increase</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="card">
              <h4 className="mb-3 text-sm font-semibold text-slate-300">Dimension Change</h4>
              <div style={{ height: 250 }}>
                <EChartsWrapper
                  option={{
                    tooltip: { trigger: "axis", backgroundColor: "#1e293b", borderColor: "#334155", textStyle: { color: "#f1f5f9" } },
                    grid: { left: 50, right: 30, top: 10, bottom: 30 },
                    xAxis: { type: "category", data: ["Before", "After"], axisLabel: { color: "#94a3b8" } },
                    yAxis: { type: "value", axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "#334155" } } },
                    series: [{
                      type: "bar",
                      data: [
                        { value: featureEngineeringResult.original_features, itemStyle: { color: "#64748b" } },
                        { value: featureEngineeringResult.generated_features, itemStyle: { color: "#10b981" } },
                      ],
                      barWidth: 50,
                    }],
                  }}
                />
              </div>
            </div>

            <div className="card">
              <h4 className="mb-3 text-sm font-semibold text-slate-300">Contribution by Type</h4>
              <div style={{ height: 250 }}>
                <EChartsWrapper
                  option={{
                    tooltip: { trigger: "item", backgroundColor: "#1e293b", borderColor: "#334155", textStyle: { color: "#f1f5f9" } },
                    series: [{
                      type: "pie",
                      radius: ["40%", "70%"],
                      center: ["50%", "50%"],
                      data: featureEngineeringResult.contributions.map((c, i) => ({
                        name: c.type,
                        value: c.count,
                        itemStyle: { color: Object.values(TYPE_COLORS)[i % 5] },
                      })),
                      label: { color: "#94a3b8", fontSize: 11 },
                      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: "rgba(0,0,0,0.5)" } },
                    }],
                  }}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => {
                setStep("feature_selection");
                navigate(`/feature-selection/${taskId}`);
              }}
              className="btn-primary flex items-center gap-2"
            >
              <ChevronRight size={16} />
              Next: Feature Selection
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-emerald-400" />
        </div>
      )}
    </div>
  );
}
