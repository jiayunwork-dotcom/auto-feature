import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getDatasetVersions,
  createDatasetVersion,
  deleteDatasetVersion,
  getDriftComparisons,
  startDriftComparison,
  getAutoCompareStrategy,
  updateAutoCompareStrategy,
  deleteAutoCompareStrategy,
} from "@/utils/api";
import type { DatasetVersion, DriftComparison, AutoCompareStrategy } from "@/utils/api";
import { useTaskStore } from "@/stores/taskStore";
import {
  Upload,
  Loader2,
  Trash2,
  GitCompare,
  AlertCircle,
  Check,
  X,
  FileClock,
  Hash,
  Rows3,
  Columns3,
  Calendar,
  Eye,
  Settings,
  ChevronDown,
  ChevronUp,
  Save,
} from "lucide-react";

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return <span className="badge badge-success">已完成</span>;
    case "running":
      return <span className="badge badge-info">进行中</span>;
    case "pending":
      return <span className="badge badge-warning">等待中</span>;
    case "failed":
      return <span className="badge badge-error">失败</span>;
    default:
      return <span className="badge badge-info">{status}</span>;
  }
}

export default function DataVersioningPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setStep = useTaskStore((s) => s.setStep);

  const [versions, setVersions] = useState<DatasetVersion[]>([]);
  const [comparisons, setComparisons] = useState<DriftComparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedVersions, setSelectedVersions] = useState<Set<number>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [comparing, setComparing] = useState(false);
  const [strategy, setStrategy] = useState<AutoCompareStrategy | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [showStrategyPanel, setShowStrategyPanel] = useState(false);
  const [showThresholds, setShowThresholds] = useState(false);
  const [savingStrategy, setSavingStrategy] = useState(false);
  const [deletingStrategy, setDeletingStrategy] = useState(false);
  const [formStrategy, setFormStrategy] = useState<{
    is_enabled: boolean;
    trigger_mode: "on_upload" | "scheduled";
    baseline_mode: "first_version" | "previous_version";
    custom_p_value_threshold: number | null;
    custom_psi_threshold: number | null;
    custom_drift_ratio_threshold: number | null;
    poll_interval_minutes: number;
  }>({
    is_enabled: false,
    trigger_mode: "on_upload",
    baseline_mode: "first_version",
    custom_p_value_threshold: null,
    custom_psi_threshold: null,
    custom_drift_ratio_threshold: null,
    poll_interval_minutes: 60,
  });

  useEffect(() => {
    if (taskId) {
      setStep("versioning");
    }
  }, [taskId, setStep]);

  useEffect(() => {
    if (!taskId) return;
    setLoading(true);
    setStrategyLoading(true);
    Promise.all([getDatasetVersions(taskId), getDriftComparisons(taskId), getAutoCompareStrategy(taskId)])
      .then(([versRes, compRes, stratRes]) => {
        setVersions(versRes.versions.sort((a, b) => b.version_number - a.version_number));
        setComparisons(compRes.comparisons.sort((a, b) => b.id - a.id));
        setStrategy(stratRes);
        setFormStrategy({
          is_enabled: stratRes.is_enabled,
          trigger_mode: stratRes.trigger_mode,
          baseline_mode: stratRes.baseline_mode,
          custom_p_value_threshold: stratRes.custom_p_value_threshold,
          custom_psi_threshold: stratRes.custom_psi_threshold,
          custom_drift_ratio_threshold: stratRes.custom_drift_ratio_threshold,
          poll_interval_minutes: stratRes.poll_interval_minutes,
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => {
        setLoading(false);
        setStrategyLoading(false);
      });
  }, [taskId]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !taskId) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    createDatasetVersion(taskId, file, (p) => setUploadProgress(p))
      .then((newVer) => {
        setVersions((prev) => [newVer, ...prev]);
        setUploading(false);
      })
      .catch((err) => {
        setUploadError(err.message);
        setUploading(false);
      })
      .finally(() => {
        if (fileInputRef.current) fileInputRef.current.value = "";
      });
  };

  const handleDelete = async (versionId: number) => {
    if (!taskId) return;
    setDeletingId(versionId);
    try {
      await deleteDatasetVersion(taskId, versionId);
      setVersions((prev) => prev.filter((v) => v.id !== versionId));
      setSelectedVersions((prev) => {
        const next = new Set(prev);
        next.delete(versionId);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
      setDeleteConfirmId(null);
    }
  };

  const toggleSelect = (versionId: number) => {
    setSelectedVersions((prev) => {
      const next = new Set(prev);
      if (next.has(versionId)) {
        next.delete(versionId);
      } else if (next.size < 2) {
        next.add(versionId);
      } else {
        const arr = Array.from(next);
        next.delete(arr[0]);
        next.add(versionId);
      }
      return next;
    });
  };

  const handleCompare = async () => {
    if (!taskId || selectedVersions.size !== 2) return;
    const [a, b] = Array.from(selectedVersions);
    setComparing(true);
    try {
      const res = await startDriftComparison(taskId, a, b);
      navigate(`/drift-comparison/${taskId}/${res.comparison_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparison failed");
    } finally {
      setComparing(false);
    }
  };

  const refreshStrategy = async () => {
    if (!taskId) return;
    setStrategyLoading(true);
    try {
      const stratRes = await getAutoCompareStrategy(taskId);
      setStrategy(stratRes);
      setFormStrategy({
        is_enabled: stratRes.is_enabled,
        trigger_mode: stratRes.trigger_mode,
        baseline_mode: stratRes.baseline_mode,
        custom_p_value_threshold: stratRes.custom_p_value_threshold,
        custom_psi_threshold: stratRes.custom_psi_threshold,
        custom_drift_ratio_threshold: stratRes.custom_drift_ratio_threshold,
        poll_interval_minutes: stratRes.poll_interval_minutes,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load strategy");
    } finally {
      setStrategyLoading(false);
    }
  };

  const handleSaveStrategy = async () => {
    if (!taskId) return;
    setSavingStrategy(true);
    try {
      const res = await updateAutoCompareStrategy(taskId, formStrategy);
      setStrategy(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save strategy");
    } finally {
      setSavingStrategy(false);
    }
  };

  const handleDeleteStrategy = async () => {
    if (!taskId) return;
    setDeletingStrategy(true);
    try {
      await deleteAutoCompareStrategy(taskId);
      await refreshStrategy();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete strategy");
    } finally {
      setDeletingStrategy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={32} className="animate-spin text-emerald-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <AlertCircle size={32} className="text-red-400" />
        <p className="text-red-300">{error}</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">数据版本管理</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowStrategyPanel((v) => !v)}
            className={`flex items-center gap-2 ${
              showStrategyPanel ? "btn-primary" : "btn-secondary"
            }`}
          >
            <Settings size={16} />
            自动对比设置
          </button>
          {selectedVersions.size === 2 && (
            <button
              onClick={handleCompare}
              disabled={comparing}
              className="btn-primary flex items-center gap-2"
            >
              {comparing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <GitCompare size={16} />
              )}
              开始对比
            </button>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="btn-secondary flex items-center gap-2"
          >
            {uploading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Upload size={16} />
            )}
            上传新版本
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.parquet,.json,.xlsx,.xls"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      </div>

      {uploading && (
        <div className="card">
          <div className="flex items-center gap-3 mb-3">
            <Loader2 size={20} className="animate-spin text-emerald-400" />
            <span className="text-white font-medium">上传中...</span>
          </div>
          <div className="h-3 w-full rounded-full overflow-hidden" style={{ backgroundColor: "#334155" }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${uploadProgress}%`,
                backgroundColor: uploadProgress >= 100 ? "#10b981" : "#3b82f6",
              }}
            />
          </div>
          <p className="mt-2 text-sm text-slate-400">{uploadProgress}%</p>
        </div>
      )}

      {uploadError && (
        <div className="card border-red-500/40">
          <div className="flex items-center gap-2">
            <AlertCircle size={20} className="text-red-400" />
            <p className="text-red-300">{uploadError}</p>
          </div>
        </div>
      )}

      {showStrategyPanel && (
        <div className="card animate-fade-in">
          <h3 className="mb-4 text-lg font-semibold text-white flex items-center gap-2">
            <Settings size={18} className="text-emerald-400" />
            自动对比策略配置
            <span className="ml-2">
              {strategy?.is_enabled ? (
                <span className="badge badge-success">已启用</span>
              ) : strategy?.created_at ? (
                <span className="badge badge-warning">已配置</span>
              ) : (
                <span className="badge badge-info">未配置</span>
              )}
            </span>
            {strategy?.last_triggered_at && (
              <span className="ml-auto text-xs text-slate-400">
                上次触发: {new Date(strategy.last_triggered_at).toLocaleString("zh-CN")}
              </span>
            )}
          </h3>

          {strategyLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-emerald-400" />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-white">启用自动对比</label>
                  <p className="text-xs text-slate-400 mt-0.5">开启后将按配置自动执行数据漂移检测</p>
                </div>
                <button
                  onClick={() =>
                    setFormStrategy((s) => ({ ...s, is_enabled: !s.is_enabled }))
                  }
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    formStrategy.is_enabled ? "bg-emerald-500" : "bg-slate-600"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                      formStrategy.is_enabled ? "translate-x-6" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>

              <div>
                <label className="text-sm font-medium text-white block mb-2">触发模式</label>
                <div className="flex gap-3">
                  <label
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer border transition-colors ${
                      formStrategy.trigger_mode === "on_upload"
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                        : "border-slate-600 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    <input
                      type="radio"
                      name="trigger_mode"
                      className="hidden"
                      checked={formStrategy.trigger_mode === "on_upload"}
                      onChange={() =>
                        setFormStrategy((s) => ({ ...s, trigger_mode: "on_upload" }))
                      }
                    />
                    <span>每次上传自动对比</span>
                  </label>
                  <label
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer border transition-colors ${
                      formStrategy.trigger_mode === "scheduled"
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                        : "border-slate-600 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    <input
                      type="radio"
                      name="trigger_mode"
                      className="hidden"
                      checked={formStrategy.trigger_mode === "scheduled"}
                      onChange={() =>
                        setFormStrategy((s) => ({ ...s, trigger_mode: "scheduled" }))
                      }
                    />
                    <span>定时轮询</span>
                  </label>
                </div>
              </div>

              {formStrategy.trigger_mode === "scheduled" && (
                <div>
                  <label className="text-sm font-medium text-white block mb-2">
                    轮询间隔（分钟）
                    <span className="text-xs text-slate-400 ml-2">范围: 5-1440</span>
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    value={formStrategy.poll_interval_minutes}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v)) {
                        setFormStrategy((s) => ({
                          ...s,
                          poll_interval_minutes: Math.min(1440, Math.max(5, v)),
                        }));
                      }
                    }}
                    className="w-40 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-white block mb-2">基准版本</label>
                <div className="flex gap-3">
                  <label
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer border transition-colors ${
                      formStrategy.baseline_mode === "first_version"
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                        : "border-slate-600 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    <input
                      type="radio"
                      name="baseline_mode"
                      className="hidden"
                      checked={formStrategy.baseline_mode === "first_version"}
                      onChange={() =>
                        setFormStrategy((s) => ({ ...s, baseline_mode: "first_version" }))
                      }
                    />
                    <span>始终与第1版对比</span>
                  </label>
                  <label
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer border transition-colors ${
                      formStrategy.baseline_mode === "previous_version"
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                        : "border-slate-600 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    <input
                      type="radio"
                      name="baseline_mode"
                      className="hidden"
                      checked={formStrategy.baseline_mode === "previous_version"}
                      onChange={() =>
                        setFormStrategy((s) => ({ ...s, baseline_mode: "previous_version" }))
                      }
                    />
                    <span>始终与前一版对比</span>
                  </label>
                </div>
              </div>

              <div>
                <button
                  onClick={() => setShowThresholds((v) => !v)}
                  className="flex items-center gap-2 text-sm font-medium text-white hover:text-emerald-400 transition-colors"
                >
                  {showThresholds ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  阈值覆盖（显示默认值）
                </button>
                {showThresholds && (
                  <div className="mt-3 space-y-4 pl-2 border-l-2 border-slate-700">
                    <div>
                      <label className="text-sm font-medium text-white block mb-2">
                        P值阈值
                        <span className="text-xs text-slate-400 ml-2">
                          默认: 0.05, 范围: 0.001-0.5
                        </span>
                      </label>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-sm text-slate-300">
                          <input
                            type="checkbox"
                            checked={formStrategy.custom_p_value_threshold !== null}
                            onChange={(e) =>
                              setFormStrategy((s) => ({
                                ...s,
                                custom_p_value_threshold: e.target.checked ? 0.05 : null,
                              }))
                            }
                            className="w-4 h-4 rounded accent-emerald-500"
                          />
                          自定义
                        </label>
                        <input
                          type="number"
                          step={0.001}
                          min={0.001}
                          max={0.5}
                          disabled={formStrategy.custom_p_value_threshold === null}
                          value={formStrategy.custom_p_value_threshold ?? 0.05}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v)) {
                              setFormStrategy((s) => ({
                                ...s,
                                custom_p_value_threshold: Math.min(0.5, Math.max(0.001, v)),
                              }));
                            }
                          }}
                          className="w-32 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-white block mb-2">
                        PSI阈值
                        <span className="text-xs text-slate-400 ml-2">
                          默认: 0.2, 范围: 0.01-1.0
                        </span>
                      </label>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-sm text-slate-300">
                          <input
                            type="checkbox"
                            checked={formStrategy.custom_psi_threshold !== null}
                            onChange={(e) =>
                              setFormStrategy((s) => ({
                                ...s,
                                custom_psi_threshold: e.target.checked ? 0.2 : null,
                              }))
                            }
                            className="w-4 h-4 rounded accent-emerald-500"
                          />
                          自定义
                        </label>
                        <input
                          type="number"
                          step={0.01}
                          min={0.01}
                          max={1.0}
                          disabled={formStrategy.custom_psi_threshold === null}
                          value={formStrategy.custom_psi_threshold ?? 0.2}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v)) {
                              setFormStrategy((s) => ({
                                ...s,
                                custom_psi_threshold: Math.min(1.0, Math.max(0.01, v)),
                              }));
                            }
                          }}
                          className="w-32 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-white block mb-2">
                        漂移比例阈值
                        <span className="text-xs text-slate-400 ml-2">
                          默认: 0.2, 范围: 0.01-1.0
                        </span>
                      </label>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-sm text-slate-300">
                          <input
                            type="checkbox"
                            checked={formStrategy.custom_drift_ratio_threshold !== null}
                            onChange={(e) =>
                              setFormStrategy((s) => ({
                                ...s,
                                custom_drift_ratio_threshold: e.target.checked ? 0.2 : null,
                              }))
                            }
                            className="w-4 h-4 rounded accent-emerald-500"
                          />
                          自定义
                        </label>
                        <input
                          type="number"
                          step={0.01}
                          min={0.01}
                          max={1.0}
                          disabled={formStrategy.custom_drift_ratio_threshold === null}
                          value={formStrategy.custom_drift_ratio_threshold ?? 0.2}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v)) {
                              setFormStrategy((s) => ({
                                ...s,
                                custom_drift_ratio_threshold: Math.min(1.0, Math.max(0.01, v)),
                              }));
                            }
                          }}
                          className="w-32 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 pt-2 border-t border-slate-700">
                <button
                  onClick={handleSaveStrategy}
                  disabled={savingStrategy}
                  className="btn-primary flex items-center gap-2"
                >
                  {savingStrategy ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Save size={16} />
                  )}
                  保存策略
                </button>
                <button
                  onClick={handleDeleteStrategy}
                  disabled={deletingStrategy || !strategy?.created_at}
                  className="btn-secondary flex items-center gap-2 text-red-400 border-red-500/40 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deletingStrategy ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Trash2 size={16} />
                  )}
                  删除策略
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card overflow-x-auto">
        <h3 className="mb-4 text-lg font-semibold text-white flex items-center gap-2">
          <FileClock size={18} className="text-emerald-400" />
          版本列表
          {selectedVersions.size > 0 && (
            <span className="badge badge-info ml-2">已选 {selectedVersions.size}/2</span>
          )}
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: "#334155" }}>
              <th className="pb-3 w-10"></th>
              <th className="pb-3 text-left font-medium text-slate-400">版本号</th>
              <th className="pb-3 text-left font-medium text-slate-400">文件名</th>
              <th className="pb-3 text-right font-medium text-slate-400">行数</th>
              <th className="pb-3 text-right font-medium text-slate-400">列数</th>
              <th className="pb-3 text-left font-medium text-slate-400">MD5哈希</th>
              <th className="pb-3 text-left font-medium text-slate-400">上传时间</th>
              <th className="pb-3 text-right font-medium text-slate-400">操作</th>
            </tr>
          </thead>
          <tbody>
            {versions.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-400">
                  暂无版本记录
                </td>
              </tr>
            ) : (
              versions.map((v) => (
                <tr key={v.id} className="border-b" style={{ borderColor: "#1e293b" }}>
                  <td className="py-3 pr-2">
                    <input
                      type="checkbox"
                      checked={selectedVersions.has(v.id)}
                      onChange={() => toggleSelect(v.id)}
                      className="w-4 h-4 rounded cursor-pointer accent-emerald-500"
                    />
                  </td>
                  <td className="py-3 pr-4">
                    <span className="badge badge-info">v{v.version_number}</span>
                  </td>
                  <td className="py-3 pr-4 font-mono text-sm text-white">{v.filename}</td>
                  <td className="py-3 pr-4 text-right font-mono text-slate-300">
                    <div className="flex items-center justify-end gap-1">
                      <Rows3 size={14} className="text-slate-500" />
                      {v.row_count.toLocaleString()}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-right font-mono text-slate-300">
                    <div className="flex items-center justify-end gap-1">
                      <Columns3 size={14} className="text-slate-500" />
                      {v.column_count}
                    </div>
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs text-slate-500">
                    <div className="flex items-center gap-1">
                      <Hash size={12} />
                      {v.file_hash_md5.slice(0, 8)}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-xs text-slate-400">
                    <div className="flex items-center gap-1">
                      <Calendar size={12} />
                      {new Date(v.created_at).toLocaleString("zh-CN")}
                    </div>
                  </td>
                  <td className="py-3 text-right">
                    {deleteConfirmId === v.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleDelete(v.id)}
                          disabled={deletingId === v.id}
                          className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                        >
                          {deletingId === v.id ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Check size={16} />
                          )}
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(null)}
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-600/20 transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirmId(v.id)}
                        className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <h3 className="mb-4 text-lg font-semibold text-white flex items-center gap-2">
          <GitCompare size={18} className="text-emerald-400" />
          历史对比记录
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: "#334155" }}>
              <th className="pb-3 text-left font-medium text-slate-400">对比ID</th>
              <th className="pb-3 text-left font-medium text-slate-400">版本A</th>
              <th className="pb-3 text-left font-medium text-slate-400">版本B</th>
              <th className="pb-3 text-left font-medium text-slate-400">状态</th>
              <th className="pb-3 text-left font-medium text-slate-400">整体预警</th>
              <th className="pb-3 text-left font-medium text-slate-400">创建时间</th>
              <th className="pb-3 text-right font-medium text-slate-400">操作</th>
            </tr>
          </thead>
          <tbody>
            {comparisons.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  暂无对比记录
                </td>
              </tr>
            ) : (
              comparisons.map((c) => (
                <tr key={c.id} className="border-b" style={{ borderColor: "#1e293b" }}>
                  <td className="py-3 pr-4 font-mono text-sm text-white">#{c.id}</td>
                  <td className="py-3 pr-4">
                    <span className="badge badge-info">v{c.version_a_number ?? c.version_a_id}</span>
                  </td>
                  <td className="py-3 pr-4">
                    <span className="badge badge-warning">v{c.version_b_number ?? c.version_b_id}</span>
                  </td>
                  <td className="py-3 pr-4">{statusBadge(c.status)}</td>
                  <td className="py-3 pr-4">
                    {c.overall_warning === null ? (
                      <span className="text-slate-500">-</span>
                    ) : c.overall_warning ? (
                      <span className="badge badge-error">预警</span>
                    ) : (
                      <span className="badge badge-success">正常</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-xs text-slate-400">
                    {new Date(c.created_at).toLocaleString("zh-CN")}
                  </td>
                  <td className="py-3 text-right">
                    <button
                      onClick={() => navigate(`/drift-comparison/${taskId}/${c.id}`)}
                      className="btn-secondary flex items-center gap-1 ml-auto py-1.5 px-3 text-xs"
                    >
                      <Eye size={14} />
                      查看详情
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
