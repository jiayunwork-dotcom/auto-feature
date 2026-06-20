import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { uploadFile } from "@/utils/api";
import { useTaskStore } from "@/stores/taskStore";
import { Upload, FileText, AlertCircle, Loader2 } from "lucide-react";

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const ACCEPTED_TYPES = [".csv", ".parquet"];

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const setTaskId = useTaskStore((s) => s.setTaskId);
  const setStep = useTaskStore((s) => s.setStep);

  const validateFile = useCallback((f: File): string | null => {
    const ext = "." + f.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_TYPES.includes(ext)) {
      return "Only .csv and .parquet files are supported";
    }
    if (f.size > MAX_FILE_SIZE) {
      return "File size must be under 200MB";
    }
    return null;
  }, []);

  const handleFile = useCallback(
    (f: File) => {
      const err = validateFile(f);
      if (err) {
        setError(err);
        setFile(null);
        return;
      }
      setError(null);
      setFile(f);
    },
    [validateFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const result = await uploadFile(file, (p) => setProgress(p));
      setTaskId(result.task_id);
      setStep("overview");
      navigate(`/overview/${result.task_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="animate-fade-in flex min-h-[80vh] flex-col items-center justify-center">
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white">Upload Dataset</h1>
          <p className="mt-2 text-slate-400">
            Drag and drop your data file to get started
          </p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 transition-all duration-200 ${
            dragOver
              ? "border-emerald-500 bg-emerald-500/10"
              : "border-slate-600 bg-slate-800/30 hover:border-slate-500"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.parquet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />

          {file ? (
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-emerald-500/15">
                <FileText size={32} className="text-emerald-400" />
              </div>
              <p className="text-lg font-medium text-white">{file.name}</p>
              <p className="text-sm text-slate-400">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-slate-700/50">
                <Upload size={32} className="text-slate-400" />
              </div>
              <p className="text-lg font-medium text-slate-300">
                Drop your file here
              </p>
              <p className="text-sm text-slate-500">
                Supports CSV and Parquet (max 200MB)
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
            <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {uploading && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-slate-400">Uploading...</span>
              <span className="font-mono text-emerald-400">{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-700">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${progress}%`,
                  backgroundColor: "#10b981",
                }}
              />
            </div>
          </div>
        )}

        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="btn-primary mt-6 flex w-full items-center justify-center gap-2 py-3 text-base"
        >
          {uploading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Upload size={18} />
              Upload & Analyze
            </>
          )}
        </button>
      </div>
    </div>
  );
}
