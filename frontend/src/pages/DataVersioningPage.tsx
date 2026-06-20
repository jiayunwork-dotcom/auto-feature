import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getDatasetVersions,
  createDatasetVersion,
  deleteDatasetVersion,
  getDriftComparisons,
  startDriftComparison,
} from "@/utils/api";
import type { DatasetVersion, DriftComparison } from "@/utils/api";
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

  useEffect(() => {
    if (taskId) {
      setStep("versioning");
    }
  }, [taskId, setStep]);

  useEffect(() => {
    if (!taskId) return;
    setLoading(true);
    Promise.all([getDatasetVersions(taskId), getDriftComparisons(taskId)])
      .then(([versRes, compRes]) => {
        setVersions(versRes.versions.sort((a, b) => b.version_number - a.version_number));
        setComparisons(compRes.comparisons.sort((a, b) => b.id - a.id));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
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
