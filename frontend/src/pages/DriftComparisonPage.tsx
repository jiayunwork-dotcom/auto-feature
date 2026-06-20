import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getDriftComparison } from "@/utils/api";
import type { DriftComparison as DriftCompType, ColumnDriftResult, DriftWSMessage } from "@/utils/api";
import { useTaskStore } from "@/stores/taskStore";
import EChartsWrapper from "@/components/EChartsWrapper";
import {
  Loader2,
  AlertTriangle,
  ArrowRight,
  GitCompare,
  Hash,
  Rows3,
  Columns3,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  Plus,
  Minus,
  ArrowLeft,
} from "lucide-react";

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return (
        <span className="badge badge-success flex items-center gap-1">
          <CheckCircle2 size={12} /> 已完成
        </span>
      );
    case "running":
      return (
        <span className="badge badge-info flex items-center gap-1">
          <Loader2 size={12} className="animate-spin" /> 进行中
        </span>
      );
    case "pending":
      return (
        <span className="badge badge-warning flex items-center gap-1">
          <Clock size={12} /> 等待中
        </span>
      );
    case "failed":
      return (
        <span className="badge badge-error flex items-center gap-1">
          <XCircle size={12} /> 失败
        </span>
      );
    default:
      return <span className="badge badge-info">{status}</span>;
  }
}

function verdictBadge(verdict: ColumnDriftResult["verdict"]) {
  switch (verdict) {
    case "稳定":
      return <span className="badge badge-success">{verdict}</span>;
    case "轻微漂移":
      return <span className="badge badge-warning">{verdict}</span>;
    case "显著漂移":
      return <span className="badge badge-error">{verdict}</span>;
  }
}

const STAGE_LABELS: Record<string, string> = {
  started: "初始化...",
  loading_data: "加载数据中...",
  comparing: "执行漂移检测中...",
  completed: "对比完成",
  failed: "对比失败",
};

function ColumnChart({ column }: { column: ColumnDriftResult }) {
  const vis = column.visualization_data;
  if (!vis) return null;

  if (vis.type === "density" && vis.x && vis.density_a && vis.density_b) {
    const xLabels = vis.x.map((v) => v.toFixed(2));
    return (
      <div style={{ height: 200 }}>
        <EChartsWrapper
          option={{
            tooltip: {
              trigger: "axis",
              backgroundColor: "#1e293b",
              borderColor: "#334155",
              textStyle: { color: "#f1f5f9", fontSize: 11 },
            },
            legend: {
              data: ["版本A", "版本B"],
              textStyle: { color: "#94a3b8", fontSize: 10 },
              top: 0,
              right: 0,
            },
            grid: { left: 40, right: 10, top: 30, bottom: 25 },
            xAxis: {
              type: "category",
              data: xLabels,
              axisLabel: { color: "#64748b", fontSize: 9, interval: Math.floor(xLabels.length / 6) },
              axisLine: { lineStyle: { color: "#334155" } },
            },
            yAxis: {
              type: "value",
              axisLabel: { color: "#64748b", fontSize: 9 },
              splitLine: { lineStyle: { color: "#334155" } },
            },
            series: [
              {
                name: "版本A",
                type: "line",
                data: vis.density_a,
                smooth: true,
                symbol: "none",
                lineStyle: { color: "#3b82f6", width: 2 },
                areaStyle: {
                  color: {
                    type: "linear",
                    x: 0, y: 0, x2: 0, y2: 1,
                    colorStops: [
                      { offset: 0, color: "rgba(59, 130, 246, 0.3)" },
                      { offset: 1, color: "rgba(59, 130, 246, 0.02)" },
                    ],
                  },
                },
              },
              {
                name: "版本B",
                type: "line",
                data: vis.density_b,
                smooth: true,
                symbol: "none",
                lineStyle: { color: "#f59e0b", width: 2 },
                areaStyle: {
                  color: {
                    type: "linear",
                    x: 0, y: 0, x2: 0, y2: 1,
                    colorStops: [
                      { offset: 0, color: "rgba(245, 158, 11, 0.3)" },
                      { offset: 1, color: "rgba(245, 158, 11, 0.02)" },
                    ],
                  },
                },
              },
            ],
          }}
        />
      </div>
    );
  }

  if (vis.type === "bar" && vis.categories && vis.counts_a && vis.counts_b) {
    return (
      <div style={{ height: 200 }}>
        <EChartsWrapper
          option={{
            tooltip: {
              trigger: "axis",
              backgroundColor: "#1e293b",
              borderColor: "#334155",
              textStyle: { color: "#f1f5f9", fontSize: 11 },
            },
            legend: {
              data: ["版本A", "版本B"],
              textStyle: { color: "#94a3b8", fontSize: 10 },
              top: 0,
              right: 0,
            },
            grid: { left: 60, right: 10, top: 30, bottom: 30 },
            xAxis: {
              type: "category",
              data: vis.categories,
              axisLabel: { color: "#64748b", fontSize: 9, rotate: vis.categories.length > 6 ? 30 : 0 },
              axisLine: { lineStyle: { color: "#334155" } },
            },
            yAxis: {
              type: "value",
              axisLabel: { color: "#64748b", fontSize: 9 },
              splitLine: { lineStyle: { color: "#334155" } },
            },
            series: [
              {
                name: "版本A",
                type: "bar",
                data: vis.counts_a,
                itemStyle: { color: "#3b82f6", borderRadius: [3, 3, 0, 0] },
                barWidth: "35%",
              },
              {
                name: "版本B",
                type: "bar",
                data: vis.counts_b,
                itemStyle: { color: "#f59e0b", borderRadius: [3, 3, 0, 0] },
                barWidth: "35%",
              },
            ],
          }}
        />
      </div>
    );
  }

  return null;
}

export default function DriftComparisonPage() {
  const { taskId, comparisonId } = useParams<{ taskId: string; comparisonId: string }>();
  const navigate = useNavigate();
  const wsRef = useRef<WebSocket | null>(null);
  const setStep = useTaskStore((s) => s.setStep);
  const driftComparisonProgress = useTaskStore((s) => s.driftComparisonProgress);
  const setDriftComparisonProgress = useTaskStore((s) => s.setDriftComparisonProgress);
  const driftComparisonStage = useTaskStore((s) => s.driftComparisonStage);
  const setDriftComparisonStage = useTaskStore((s) => s.setDriftComparisonStage);

  const [comparison, setComparison] = useState<DriftCompType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (taskId) {
      setStep("versioning");
    }
  }, [taskId, setStep]);

  useEffect(() => {
    if (!taskId || !comparisonId) return;
    setLoading(true);
    getDriftComparison(taskId, parseInt(comparisonId))
      .then((data) => {
        setComparison(data);
        if (data.status === "completed") {
          setDriftComparisonProgress(100);
          setDriftComparisonStage("completed");
        } else if (data.status === "running") {
          setDriftComparisonStage("comparing");
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [taskId, comparisonId, setDriftComparisonProgress, setDriftComparisonStage]);

  useEffect(() => {
    if (!comparisonId) return;

    const ws = new WebSocket(`ws://localhost:8000/ws/drift-comparison/${comparisonId}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg: DriftWSMessage = JSON.parse(event.data);
        setDriftComparisonProgress(msg.progress);
        setDriftComparisonStage(msg.stage);

        if (msg.stage === "completed" && taskId) {
          getDriftComparison(taskId, parseInt(comparisonId)).then((data) => {
            setComparison(data);
          });
        } else if (msg.stage === "failed") {
          setError((msg.data as { error: string })?.error || "对比失败");
        }
      } catch {}
    };

    ws.onclose = () => {};

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [comparisonId, taskId, setDriftComparisonProgress, setDriftComparisonStage]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={32} className="animate-spin text-emerald-400" />
      </div>
    );
  }

  if (error || !comparison) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <AlertCircle size={32} className="text-red-400" />
        <p className="text-red-300">{error || "对比数据加载失败"}</p>
      </div>
    );
  }

  const results = comparison.column_results || [];
  const totalCols = results.length;
  const significantCount = results.filter((r) => r.verdict === "显著漂移").length;
  const mildCount = results.filter((r) => r.verdict === "轻微漂移").length;
  const stableCount = results.filter((r) => r.verdict === "稳定").length;
  const driftRatio = comparison.significant_drift_ratio ?? (totalCols > 0 ? significantCount / totalCols : 0);

  return (
    <div className="animate-fade-in space-y-6">
      {comparison.overall_warning && (
        <div
          className="rounded-xl border p-4 flex items-center gap-3"
          style={{
            backgroundColor: "rgba(239, 68, 68, 0.08)",
            borderColor: "rgba(239, 68, 68, 0.4)",
          }}
        >
          <AlertTriangle size={24} className="text-red-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-red-300 font-medium">
              警告：检测到显著数据漂移（漂移比例 {(driftRatio * 100).toFixed(1)}%），建议重新训练模型
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/versioning/${taskId}`)}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <GitCompare size={24} className="text-emerald-400" />
              漂移对比详情
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="badge badge-info">v{comparison.version_a_number ?? comparison.version_a_id}</span>
              <ArrowRight size={14} className="text-slate-500" />
              <span className="badge badge-warning">v{comparison.version_b_number ?? comparison.version_b_id}</span>
            </div>
          </div>
        </div>
        {statusBadge(comparison.status)}
      </div>

      {comparison.status === "running" && (
        <div className="card">
          <div className="flex items-center gap-3 mb-3">
            <Loader2 size={20} className="animate-spin text-emerald-400" />
            <span className="text-white font-medium">
              {STAGE_LABELS[driftComparisonStage] || driftComparisonStage}
            </span>
          </div>
          <div className="h-3 w-full rounded-full overflow-hidden" style={{ backgroundColor: "#334155" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${driftComparisonProgress}%`,
                backgroundColor: driftComparisonProgress >= 100 ? "#10b981" : "#3b82f6",
              }}
            />
          </div>
          <p className="mt-2 text-sm text-slate-400">{driftComparisonProgress}%</p>
        </div>
      )}

      {comparison.error_message && (
        <div className="card border-red-500/40">
          <div className="flex items-center gap-2">
            <AlertCircle size={20} className="text-red-400" />
            <p className="text-red-300">{comparison.error_message}</p>
          </div>
        </div>
      )}

      {(comparison.added_columns && comparison.added_columns.length > 0) ||
      (comparison.removed_columns && comparison.removed_columns.length > 0) ? (
        <div className="grid grid-cols-2 gap-4">
          {comparison.added_columns && comparison.added_columns.length > 0 && (
            <div className="card">
              <h3 className="mb-3 text-lg font-semibold text-white flex items-center gap-2">
                <Plus size={18} className="text-emerald-400" />
                新增列
              </h3>
              <div className="flex flex-wrap gap-2">
                {comparison.added_columns.map((col) => (
                  <span
                    key={col}
                    className="badge badge-success font-mono"
                  >
                    {col}
                  </span>
                ))}
              </div>
            </div>
          )}
          {comparison.removed_columns && comparison.removed_columns.length > 0 && (
            <div className="card">
              <h3 className="mb-3 text-lg font-semibold text-white flex items-center gap-2">
                <Minus size={18} className="text-red-400" />
                移除列
              </h3>
              <div className="flex flex-wrap gap-2">
                {comparison.removed_columns.map((col) => (
                  <span
                    key={col}
                    className="badge badge-error font-mono"
                  >
                    {col}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {comparison.status === "completed" && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
            <div className="card flex flex-col items-center gap-2 py-4">
              <Hash size={20} className="text-slate-400" />
              <p className="font-mono text-2xl font-bold text-white">{totalCols}</p>
              <p className="text-xs text-slate-400">总列数</p>
            </div>
            <div className="card flex flex-col items-center gap-2 py-4 border-red-500/40">
              <AlertTriangle size={20} className="text-red-400" />
              <p className="font-mono text-2xl font-bold text-red-400">{significantCount}</p>
              <p className="text-xs text-slate-400">显著漂移</p>
            </div>
            <div className="card flex flex-col items-center gap-2 py-4 border-orange-500/40">
              <TrendingUp size={20} className="text-orange-400" />
              <p className="font-mono text-2xl font-bold text-orange-400">{mildCount}</p>
              <p className="text-xs text-slate-400">轻微漂移</p>
            </div>
            <div className="card flex flex-col items-center gap-2 py-4 border-emerald-500/40">
              <CheckCircle2 size={20} className="text-emerald-400" />
              <p className="font-mono text-2xl font-bold text-emerald-400">{stableCount}</p>
              <p className="text-xs text-slate-400">稳定</p>
            </div>
            <div className="card flex flex-col items-center gap-2 py-4">
              <Rows3 size={20} className="text-slate-400" />
              <p className="font-mono text-2xl font-bold" style={{ color: driftRatio > 0.2 ? "#ef4444" : driftRatio > 0.1 ? "#f59e0b" : "#10b981" }}>
                {(driftRatio * 100).toFixed(1)}%
              </p>
              <p className="text-xs text-slate-400">漂移比例</p>
            </div>
            <div className="card flex flex-col items-center gap-2 py-4">
              <Columns3 size={20} className="text-slate-400" />
              {comparison.overall_warning ? (
                <p className="font-mono text-2xl font-bold text-red-400">预警</p>
              ) : (
                <p className="font-mono text-2xl font-bold text-emerald-400">正常</p>
              )}
              <p className="text-xs text-slate-400">整体状态</p>
            </div>
          </div>

          <div className="card overflow-x-auto">
            <h3 className="mb-4 text-lg font-semibold text-white">漂移检测结果</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "#334155" }}>
                  <th className="pb-3 text-left font-medium text-slate-400">列名</th>
                  <th className="pb-3 text-left font-medium text-slate-400">类型</th>
                  <th className="pb-3 text-left font-medium text-slate-400">检验方法</th>
                  <th className="pb-3 text-right font-medium text-slate-400">统计量</th>
                  <th className="pb-3 text-right font-medium text-slate-400">P值 / PSI</th>
                  <th className="pb-3 text-left font-medium text-slate-400">判定</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.column_name} className="border-b" style={{ borderColor: "#1e293b" }}>
                    <td className="py-3 pr-4 font-mono text-sm text-white">{r.column_name}</td>
                    <td className="py-3 pr-4">
                      <span className="badge badge-info text-xs">{r.column_type}</span>
                    </td>
                    <td className="py-3 pr-4 text-slate-300">{r.method}</td>
                    <td className="py-3 pr-4 text-right font-mono text-slate-300">
                      {r.statistic !== null && r.statistic !== undefined ? r.statistic.toFixed(4) : <span className="text-slate-500">-</span>}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono">
                      {r.p_value_or_psi !== null ? (
                        <span className={
                          r.p_value_or_psi < 0.05 ? "text-red-400" :
                          r.p_value_or_psi < 0.1 ? "text-orange-400" : "text-slate-300"
                        }>
                          {r.p_value_or_psi.toFixed(4)}
                        </span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="py-3">{verdictBadge(r.verdict)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {results.some((r) => r.visualization_data) && (
            <div className="card">
              <h3 className="mb-4 text-lg font-semibold text-white">可视化对比</h3>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {results
                  .filter((r) => r.visualization_data)
                  .map((r) => (
                    <div
                      key={r.column_name}
                      className="rounded-lg border p-4"
                      style={{ borderColor: "#334155" }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-sm font-medium text-white">
                          {r.column_name}
                        </span>
                        {verdictBadge(r.verdict)}
                      </div>
                      <ColumnChart column={r} />
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
