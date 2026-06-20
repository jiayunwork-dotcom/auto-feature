import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getOverview, updateInference, setTarget } from "@/utils/api";
import { useTaskStore } from "@/stores/taskStore";
import type { ColumnInference } from "@/utils/api";
import EChartsWrapper from "@/components/EChartsWrapper";
import StepProgress from "@/components/StepProgress";
import {
  Loader2,
  AlertCircle,
  Rows3,
  Columns3,
  Hash,
  Tag,
  Calendar,
  Type,
  ChevronRight,
  Target,
} from "lucide-react";

export default function OverviewPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inference = useTaskStore((s) => s.inference);
  const setInference = useTaskStore((s) => s.setInference);
  const setStep = useTaskStore((s) => s.setStep);
  const targetColumn = useTaskStore((s) => s.targetColumn);
  const setTargetColumn = useTaskStore((s) => s.setTargetColumn);
  const updateColumnInference = useTaskStore((s) => s.updateColumnInference);

  useEffect(() => {
    if (!taskId) return;
    setLoading(true);
    getOverview(taskId)
      .then((data) => {
        setInference(data);
        if (data.detected_target) {
          setTargetColumn(data.detected_target);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [taskId, setInference, setTargetColumn]);

  const handleTypeChange = (colName: string, newType: ColumnInference["inferred_type"]) => {
    updateColumnInference(colName, newType);
  };

  const handleConfirm = async () => {
    if (!taskId || !inference) return;
    setSaving(true);
    try {
      await updateInference(
        taskId,
        inference.columns.map((c) => ({
          name: c.name,
          inferred_type: c.inferred_type,
        }))
      );
      if (targetColumn) {
        await setTarget(taskId, targetColumn);
      }
      setStep("feature_engineering");
      navigate(`/feature-engineering/${taskId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={32} className="animate-spin text-emerald-400" />
      </div>
    );
  }

  if (error || !inference) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <AlertCircle size={32} className="text-red-400" />
        <p className="text-red-300">{error || "No data available"}</p>
      </div>
    );
  }

  const statsCards = [
    { label: "Total Rows", value: inference.total_rows.toLocaleString(), icon: <Rows3 size={20} />, color: "#10b981" },
    { label: "Total Columns", value: inference.total_columns, icon: <Columns3 size={20} />, color: "#3b82f6" },
    { label: "Numeric", value: inference.numeric_count, icon: <Hash size={20} />, color: "#8b5cf6" },
    { label: "Categorical", value: inference.categorical_count, icon: <Tag size={20} />, color: "#f59e0b" },
    { label: "Datetime", value: inference.datetime_count, icon: <Calendar size={20} />, color: "#06b6d4" },
    { label: "Text", value: inference.text_count, icon: <Type size={20} />, color: "#ec4899" },
  ];

  return (
    <div className="animate-fade-in space-y-6">
      <StepProgress />

      <h2 className="text-2xl font-bold text-white">Data Overview</h2>

      <div className="grid grid-cols-3 gap-4 lg:grid-cols-6">
        {statsCards.map((card) => (
          <div key={card.label} className="card flex flex-col items-center gap-2 py-4">
            <div style={{ color: card.color }}>{card.icon}</div>
            <p className="font-mono text-2xl font-bold text-white">{card.value}</p>
            <p className="text-xs text-slate-400">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 className="mb-4 text-lg font-semibold text-white flex items-center gap-2">
          <Target size={18} className="text-emerald-400" />
          Target Column
        </h3>
        <select
          value={targetColumn || ""}
          onChange={(e) => setTargetColumn(e.target.value || null)}
          className="select-field w-64"
        >
          <option value="">Select target...</option>
          {inference.columns.map((col) => (
            <option key={col.name} value={col.name}>
              {col.name}
              {col.name === inference.detected_target ? " (auto-detected)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="card overflow-x-auto">
        <h3 className="mb-4 text-lg font-semibold text-white">Column Type Inference</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: "#334155" }}>
              <th className="pb-3 text-left font-medium text-slate-400">Column</th>
              <th className="pb-3 text-left font-medium text-slate-400">Type</th>
              <th className="pb-3 text-right font-medium text-slate-400">Unique</th>
              <th className="pb-3 text-right font-medium text-slate-400">Missing %</th>
              <th className="pb-3 text-left font-medium text-slate-400">Sample Values</th>
            </tr>
          </thead>
          <tbody>
            {inference.columns.map((col) => (
              <tr key={col.name} className="border-b" style={{ borderColor: "#1e293b" }}>
                <td className="py-3 pr-4">
                  <span className={`font-mono text-sm ${col.name === targetColumn ? "text-emerald-400 font-bold" : "text-white"}`}>
                    {col.name}
                    {col.name === targetColumn && " ★"}
                  </span>
                </td>
                <td className="py-3 pr-4">
                  <select
                    value={col.inferred_type}
                    onChange={(e) =>
                      handleTypeChange(col.name, e.target.value as ColumnInference["inferred_type"])
                    }
                    className="select-field"
                  >
                    <option value="numeric">Numeric</option>
                    <option value="categorical">Categorical</option>
                    <option value="datetime">Datetime</option>
                    <option value="text">Text</option>
                  </select>
                </td>
                <td className="py-3 pr-4 text-right font-mono text-slate-300">{col.unique_count}</td>
                <td className="py-3 pr-4 text-right font-mono">
                  <span className={col.missing_ratio > 0.3 ? "text-amber-400" : "text-slate-300"}>
                    {(col.missing_ratio * 100).toFixed(1)}%
                  </span>
                </td>
                <td className="py-3 font-mono text-xs text-slate-500 max-w-xs truncate">
                  {col.sample_values.slice(0, 3).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {inference.missing_top.length > 0 && (
        <div className="card">
          <h3 className="mb-4 text-lg font-semibold text-white">Missing Values (Top 10)</h3>
          <div style={{ height: 300 }}>
            <EChartsWrapper
              option={{
                tooltip: { trigger: "axis", backgroundColor: "#1e293b", borderColor: "#334155", textStyle: { color: "#f1f5f9" } },
                grid: { left: 120, right: 40, top: 10, bottom: 30 },
                xAxis: { type: "value", axisLabel: { color: "#94a3b8", formatter: (v: number) => `${(v * 100).toFixed(0)}%` }, splitLine: { lineStyle: { color: "#334155" } } },
                yAxis: { type: "category", data: inference.missing_top.map((m) => m.column).reverse(), axisLabel: { color: "#94a3b8", fontFamily: "JetBrains Mono" } },
                series: [{
                  type: "bar",
                  data: inference.missing_top.map((m) => m.ratio).reverse(),
                  itemStyle: { color: "#f59e0b" },
                  barWidth: 18,
                }],
              }}
            />
          </div>
        </div>
      )}

      {inference.numeric_distributions.length > 0 && (
        <div className="card">
          <h3 className="mb-4 text-lg font-semibold text-white">Numeric Distributions</h3>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {inference.numeric_distributions.slice(0, 20).map((dist) => (
              <div key={dist.column} style={{ height: 160 }}>
                <p className="mb-1 font-mono text-xs text-slate-400 truncate">{dist.column}</p>
                <EChartsWrapper
                  option={{
                    tooltip: { trigger: "axis", backgroundColor: "#1e293b", borderColor: "#334155", textStyle: { color: "#f1f5f9", fontSize: 10 } },
                    grid: { left: 30, right: 5, top: 5, bottom: 20 },
                    xAxis: { type: "category", data: dist.bins.map((b) => b.toFixed(1)), axisLabel: { color: "#64748b", fontSize: 9 }, show: false },
                    yAxis: { type: "value", axisLabel: { show: false }, splitLine: { show: false } },
                    series: [{
                      type: "bar",
                      data: dist.counts,
                      itemStyle: { color: "#8b5cf6" },
                      barWidth: "90%",
                    }],
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {inference.categorical_frequencies.length > 0 && (
        <div className="card">
          <h3 className="mb-4 text-lg font-semibold text-white">Categorical Frequencies (Top 5)</h3>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            {inference.categorical_frequencies.slice(0, 12).map((cat) => (
              <div key={cat.column} style={{ height: 160 }}>
                <p className="mb-1 font-mono text-xs text-slate-400 truncate">{cat.column}</p>
                <EChartsWrapper
                  option={{
                    tooltip: { trigger: "axis", backgroundColor: "#1e293b", borderColor: "#334155", textStyle: { color: "#f1f5f9", fontSize: 10 } },
                    grid: { left: 60, right: 10, top: 5, bottom: 20 },
                    xAxis: { type: "value", axisLabel: { show: false }, splitLine: { show: false } },
                    yAxis: { type: "category", data: cat.values.slice(0, 5).reverse(), axisLabel: { color: "#94a3b8", fontSize: 9, fontFamily: "JetBrains Mono" } },
                    series: [{
                      type: "bar",
                      data: cat.counts.slice(0, 5).reverse(),
                      itemStyle: { color: "#f59e0b" },
                      barWidth: 14,
                    }],
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleConfirm}
          disabled={saving || !targetColumn}
          className="btn-primary flex items-center gap-2"
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <ChevronRight size={16} />
          )}
          Confirm & Next
        </button>
      </div>
    </div>
  );
}
