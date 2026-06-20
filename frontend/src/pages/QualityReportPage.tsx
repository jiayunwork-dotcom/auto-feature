import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useTaskStore } from "@/stores/taskStore";
import type {
  QualityReportData,
  QualityReportWSMessage,
  MissingValueColumn,
  OutlierColumn,
  ConsistencyColumn,
  UniquenessColumn,
  CorrelationPair,
} from "@/utils/api";
import { getLatestQualityReport } from "@/utils/api";
import {
  FileWarning,
  AlertTriangle,
  ShieldCheck,
  Fingerprint,
  GitBranch,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from "lucide-react";

function riskBadge(level: string) {
  if (level === "suggest_delete") return <span className="badge badge-error">建议删除</span>;
  if (level === "high_risk") return <span className="badge badge-error">高风险</span>;
  return <span className="badge badge-success">正常</span>;
}

function warningBadge(warning: boolean) {
  return warning
    ? <span className="badge badge-warning">警告</span>
    : <span className="badge badge-success">正常</span>;
}

function categoryBadge(category: string) {
  if (category === "suspected_id") return <span className="badge badge-warning">疑似ID</span>;
  if (category === "constant") return <span className="badge badge-error">常量列</span>;
  return <span className="badge badge-success">正常</span>;
}

function collinearBadge(isHigh: boolean) {
  return isHigh
    ? <span className="badge badge-error">高度共线性</span>
    : <span className="badge badge-success">正常</span>;
}

function MissingValuesCard({ data }: { data: QualityReportData["missing_values"] }) {
  const [expanded, setExpanded] = useState(false);
  const highRiskCols = data.columns.filter((c) => c.risk_level !== "normal");
  const icon = highRiskCols.length > 0 ? <FileWarning size={20} className="text-red-400" /> : <ShieldCheck size={20} className="text-emerald-400" />;

  return (
    <div className={`card ${highRiskCols.length > 0 ? "border-red-500/40" : ""}`}>
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3">
          {icon}
          <h3 className="text-lg font-semibold text-white">缺失值分析</h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400">
            高风险 {highRiskCols.length} / {data.columns.length} 列
          </span>
          {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </div>
      </div>

      {data.correlated_groups.length > 0 && (
        <div className="mt-3 rounded-lg border border-orange-500/30 bg-orange-500/5 p-3">
          <p className="text-sm font-medium text-orange-300">关联缺失组</p>
          {data.correlated_groups.map((g, i) => (
            <p key={i} className="mt-1 text-xs text-slate-300">
              <span className="badge badge-warning mr-2">{g.label}</span>
              列: {g.columns.join(", ")} (缺失 {g.missing_count} 行)
            </p>
          ))}
        </div>
      )}

      {expanded && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "#334155" }}>
                <th className="pb-3 text-left font-medium text-slate-400">列名</th>
                <th className="pb-3 text-right font-medium text-slate-400">缺失数</th>
                <th className="pb-3 text-right font-medium text-slate-400">缺失比例</th>
                <th className="pb-3 text-left font-medium text-slate-400">风险等级</th>
                <th className="pb-3 text-left font-medium text-slate-400">建议</th>
              </tr>
            </thead>
            <tbody>
              {data.columns.map((col) => (
                <tr key={col.column} className="border-b" style={{ borderColor: "#1e293b" }}>
                  <td className="py-2 pr-4 font-mono text-sm text-white">{col.column}</td>
                  <td className="py-2 pr-4 text-right font-mono text-slate-300">{col.missing_count}</td>
                  <td className="py-2 pr-4 text-right font-mono">
                    <span className={col.risk_level !== "normal" ? "text-red-400" : "text-slate-300"}>
                      {(col.missing_ratio * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2 pr-4">{riskBadge(col.risk_level)}</td>
                  <td className="py-2 text-xs text-slate-400">{col.suggestion || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OutliersCard({ data }: { data: QualityReportData["outliers"] }) {
  const [expanded, setExpanded] = useState(false);
  const warningCols = data.columns.filter((c) => c.warning);
  const icon = warningCols.length > 0 ? <AlertTriangle size={20} className="text-orange-400" /> : <ShieldCheck size={20} className="text-emerald-400" />;

  return (
    <div className={`card ${warningCols.length > 0 ? "border-orange-500/40" : ""}`}>
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3">
          {icon}
          <h3 className="text-lg font-semibold text-white">异常值检测</h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400">
            警告 {warningCols.length} / {data.columns.length} 列
          </span>
          {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "#334155" }}>
                <th className="pb-3 text-left font-medium text-slate-400">列名</th>
                <th className="pb-3 text-right font-medium text-slate-400">异常值数</th>
                <th className="pb-3 text-right font-medium text-slate-400">异常值占比</th>
                <th className="pb-3 text-right font-medium text-slate-400">Q1</th>
                <th className="pb-3 text-right font-medium text-slate-400">Q3</th>
                <th className="pb-3 text-right font-medium text-slate-400">下界</th>
                <th className="pb-3 text-right font-medium text-slate-400">上界</th>
                <th className="pb-3 text-left font-medium text-slate-400">状态</th>
              </tr>
            </thead>
            <tbody>
              {data.columns.map((col) => (
                <tr key={col.column} className="border-b" style={{ borderColor: "#1e293b" }}>
                  <td className="py-2 pr-4 font-mono text-sm text-white">{col.column}</td>
                  <td className="py-2 pr-4 text-right font-mono text-slate-300">{col.outlier_count}</td>
                  <td className="py-2 pr-4 text-right font-mono">
                    <span className={col.warning ? "text-orange-400" : "text-slate-300"}>
                      {(col.outlier_ratio * 100).toFixed(2)}%
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right font-mono text-slate-400">{col.q1?.toFixed(2) ?? "-"}</td>
                  <td className="py-2 pr-4 text-right font-mono text-slate-400">{col.q3?.toFixed(2) ?? "-"}</td>
                  <td className="py-2 pr-4 text-right font-mono text-slate-400">{col.lower_bound?.toFixed(2) ?? "-"}</td>
                  <td className="py-2 pr-4 text-right font-mono text-slate-400">{col.upper_bound?.toFixed(2) ?? "-"}</td>
                  <td className="py-2">{warningBadge(col.warning)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ConsistencyCard({ data }: { data: QualityReportData["consistency"] }) {
  const [expanded, setExpanded] = useState(false);
  const problemCols = data.columns.filter((c) => c.inconsistency_count > 0);
  const icon = problemCols.length > 0 ? <AlertCircle size={20} className="text-orange-400" /> : <ShieldCheck size={20} className="text-emerald-400" />;

  return (
    <div className={`card ${problemCols.length > 0 ? "border-orange-500/40" : ""}`}>
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3">
          {icon}
          <h3 className="text-lg font-semibold text-white">数据一致性</h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400">
            不一致 {problemCols.length} / {data.columns.length} 列
          </span>
          {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3">
          {data.columns.map((col) => (
            <div key={col.column} className="rounded-lg border p-3" style={{ borderColor: col.inconsistency_count > 0 ? "#f59e0b40" : "#334155" }}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm text-white">{col.column}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">不一致条目: {col.inconsistency_count}</span>
                  {col.inconsistency_count > 0 ? <span className="badge badge-warning">有问题</span> : <span className="badge badge-success">正常</span>}
                </div>
              </div>
              {col.issues.length > 0 && (
                <div className="mt-2 space-y-1">
                  {col.issues.map((issue, idx) => (
                    <p key={idx} className="text-xs text-slate-300">
                      <span className="badge badge-info mr-2">{issue.type === "case_inconsistency" ? "大小写" : issue.type === "whitespace" ? "空格" : "相似"}</span>
                      {issue.description}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UniquenessCard({ data }: { data: QualityReportData["uniqueness"] }) {
  const [expanded, setExpanded] = useState(false);
  const flaggedCols = data.columns.filter((c) => c.category !== "normal");
  const icon = flaggedCols.length > 0 ? <Fingerprint size={20} className="text-orange-400" /> : <ShieldCheck size={20} className="text-emerald-400" />;

  return (
    <div className={`card ${flaggedCols.length > 0 ? "border-orange-500/40" : ""}`}>
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3">
          {icon}
          <h3 className="text-lg font-semibold text-white">唯一性检测</h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400">
            标记 {flaggedCols.length} / {data.columns.length} 列
          </span>
          {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "#334155" }}>
                <th className="pb-3 text-left font-medium text-slate-400">列名</th>
                <th className="pb-3 text-right font-medium text-slate-400">唯一值数</th>
                <th className="pb-3 text-right font-medium text-slate-400">唯一值占比</th>
                <th className="pb-3 text-left font-medium text-slate-400">类别</th>
                <th className="pb-3 text-left font-medium text-slate-400">建议</th>
              </tr>
            </thead>
            <tbody>
              {data.columns.map((col) => (
                <tr key={col.column} className="border-b" style={{ borderColor: "#1e293b" }}>
                  <td className="py-2 pr-4 font-mono text-sm text-white">{col.column}</td>
                  <td className="py-2 pr-4 text-right font-mono text-slate-300">{col.unique_count}</td>
                  <td className="py-2 pr-4 text-right font-mono">
                    <span className={col.category !== "normal" ? "text-orange-400" : "text-slate-300"}>
                      {(col.unique_ratio * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2 pr-4">{categoryBadge(col.category)}</td>
                  <td className="py-2 text-xs text-slate-400">{col.suggestion || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CorrelationsCard({ data }: { data: QualityReportData["correlations"] }) {
  const [expanded, setExpanded] = useState(false);
  const highPairs = data.pairs.filter((p) => p.is_highly_collinear);
  const icon = highPairs.length > 0 ? <GitBranch size={20} className="text-red-400" /> : <ShieldCheck size={20} className="text-emerald-400" />;

  return (
    <div className={`card ${highPairs.length > 0 ? "border-red-500/40" : ""}`}>
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3">
          {icon}
          <h3 className="text-lg font-semibold text-white">相关性预警</h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400">
            高共线性 {highPairs.length} / {data.pairs.length} 对
          </span>
          {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 overflow-x-auto">
          {data.pairs.length === 0 ? (
            <p className="text-sm text-slate-400">数值列不足,无法计算相关性</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "#334155" }}>
                  <th className="pb-3 text-left font-medium text-slate-400">列 A</th>
                  <th className="pb-3 text-left font-medium text-slate-400">列 B</th>
                  <th className="pb-3 text-right font-medium text-slate-400">相关系数</th>
                  <th className="pb-3 text-left font-medium text-slate-400">状态</th>
                  <th className="pb-3 text-left font-medium text-slate-400">建议</th>
                </tr>
              </thead>
              <tbody>
                {data.pairs.map((pair, idx) => (
                  <tr key={idx} className="border-b" style={{ borderColor: "#1e293b" }}>
                    <td className="py-2 pr-4 font-mono text-sm text-white">{pair.column_a}</td>
                    <td className="py-2 pr-4 font-mono text-sm text-white">{pair.column_b}</td>
                    <td className="py-2 pr-4 text-right font-mono">
                      <span className={pair.is_highly_collinear ? "text-red-400" : "text-slate-300"}>
                        {pair.correlation.toFixed(4)}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{collinearBadge(pair.is_highly_collinear)}</td>
                    <td className="py-2 text-xs text-slate-400">{pair.suggestion || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

const STAGE_LABELS: Record<string, string> = {
  started: "初始化...",
  missing_values: "缺失值分析",
  outliers: "异常值检测",
  consistency: "数据一致性",
  uniqueness: "唯一性检测",
  correlations: "相关性预警",
  completed: "报告完成",
  failed: "生成失败",
};

export default function QualityReportPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const qualityReportData = useTaskStore((s) => s.qualityReportData);
  const setQualityReportData = useTaskStore((s) => s.setQualityReportData);
  const qualityReportStatus = useTaskStore((s) => s.qualityReportStatus);
  const setQualityReportStatus = useTaskStore((s) => s.setQualityReportStatus);
  const qualityReportProgress = useTaskStore((s) => s.qualityReportProgress);
  const setQualityReportProgress = useTaskStore((s) => s.setQualityReportProgress);
  const qualityReportStage = useTaskStore((s) => s.qualityReportStage);
  const setQualityReportStage = useTaskStore((s) => s.setQualityReportStage);

  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!taskId) return;

    getLatestQualityReport(taskId)
      .then((res) => {
        if (res.report && res.report.status === "completed" && res.report.report_data) {
          setQualityReportData(res.report.report_data);
          setQualityReportStatus("completed");
          setQualityReportProgress(100);
        } else if (res.report && res.report.status === "running") {
          setQualityReportStatus("running");
          setQualityReportStage("running");
        }
      })
      .catch(() => {});
  }, [taskId, setQualityReportData, setQualityReportStatus, setQualityReportProgress, setQualityReportStage]);

  useEffect(() => {
    if (!taskId) return;

    const ws = new WebSocket(`ws://localhost:8000/ws/quality-report/${taskId}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg: QualityReportWSMessage = JSON.parse(event.data);
        setQualityReportProgress(msg.progress);
        setQualityReportStage(msg.stage);

        if (msg.stage === "completed" && msg.data) {
          setQualityReportData(msg.data as QualityReportData);
          setQualityReportStatus("completed");
        } else if (msg.stage === "failed") {
          setQualityReportStatus("error");
          setError((msg.data as { error: string })?.error || "报告生成失败");
        } else if (msg.data) {
          const prev = useTaskStore.getState().qualityReportData;
          setQualityReportData({ ...prev, ...msg.data } as QualityReportData);
        }

        if (msg.progress > 0 && msg.progress < 100) {
          setQualityReportStatus("running");
        }
      } catch {}
    };

    ws.onclose = () => {};

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [taskId, setQualityReportData, setQualityReportStatus, setQualityReportProgress, setQualityReportStage]);

  const isRunning = qualityReportStatus === "running";

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">数据质量报告</h2>
        {qualityReportData && (
          <span className="badge badge-success">已完成</span>
        )}
      </div>

      {isRunning && (
        <div className="card">
          <div className="flex items-center gap-3 mb-3">
            <Loader2 size={20} className="animate-spin text-emerald-400" />
            <span className="text-white font-medium">{STAGE_LABELS[qualityReportStage] || qualityReportStage}</span>
          </div>
          <div className="h-3 w-full rounded-full overflow-hidden" style={{ backgroundColor: "#334155" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${qualityReportProgress}%`,
                backgroundColor: qualityReportProgress >= 100 ? "#10b981" : "#3b82f6",
              }}
            />
          </div>
          <p className="mt-2 text-sm text-slate-400">{qualityReportProgress}%</p>
        </div>
      )}

      {error && (
        <div className="card border-red-500/40">
          <div className="flex items-center gap-2">
            <AlertCircle size={20} className="text-red-400" />
            <p className="text-red-300">{error}</p>
          </div>
        </div>
      )}

      {qualityReportData && (
        <div className="space-y-4">
          <MissingValuesCard data={qualityReportData.missing_values} />
          <OutliersCard data={qualityReportData.outliers} />
          <ConsistencyCard data={qualityReportData.consistency} />
          <UniquenessCard data={qualityReportData.uniqueness} />
          <CorrelationsCard data={qualityReportData.correlations} />
        </div>
      )}

      {!qualityReportData && !isRunning && !error && (
        <div className="flex min-h-[30vh] items-center justify-center">
          <p className="text-slate-400">尚未生成质量报告,请返回数据概览页点击"生成质量报告"</p>
        </div>
      )}
    </div>
  );
}
