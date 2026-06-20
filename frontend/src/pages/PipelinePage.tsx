import { useState, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { downloadPipeline, predict } from "@/utils/api";
import { useTaskStore } from "@/stores/taskStore";
import StepProgress from "@/components/StepProgress";
import {
  Download,
  Upload,
  Loader2,
  AlertCircle,
  FileText,
  Table,
  CheckCircle2,
} from "lucide-react";

interface PredictionRow {
  index: number;
  prediction: number;
  top_features: { feature: string; contribution: number }[];
}

export default function PipelinePage() {
  const { taskId } = useParams<{ taskId: string }>();
  const [downloading, setDownloading] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [predicting, setPredicting] = useState(false);
  const [predictions, setPredictions] = useState<PredictionRow[]>([]);
  const [predictFile, setPredictFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDownload = async () => {
    if (!taskId) return;
    setDownloading(true);
    setError(null);
    try {
      const info = await downloadPipeline(taskId);
      const link = document.createElement("a");
      link.href = info.download_url;
      link.download = `pipeline_${taskId}.pkl`;
      link.click();
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const handlePredict = async () => {
    if (!taskId || !predictFile) return;
    setPredicting(true);
    setError(null);
    try {
      const result = await predict(taskId, predictFile);
      setPredictions(result.predictions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prediction failed");
    } finally {
      setPredicting(false);
    }
  };

  return (
    <div className="animate-fade-in space-y-6">
      <StepProgress />
      <h2 className="text-2xl font-bold text-white">Pipeline</h2>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <h3 className="mb-4 text-lg font-semibold text-white flex items-center gap-2">
            <Download size={18} className="text-emerald-400" />
            Download Pipeline
          </h3>
          <p className="mb-4 text-sm text-slate-400">
            Download the complete trained pipeline as a pickle file. It includes data preprocessing, feature engineering, feature selection, and the final model.
          </p>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className={`btn-primary flex items-center gap-2 transition-all duration-300 ${
              downloadSuccess ? "bg-emerald-600" : ""
            }`}
          >
            {downloading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : downloadSuccess ? (
              <CheckCircle2 size={16} />
            ) : (
              <Download size={16} />
            )}
            {downloading ? "Downloading..." : downloadSuccess ? "Downloaded!" : "Download Pipeline"}
          </button>
        </div>

        <div className="card">
          <h3 className="mb-4 text-lg font-semibold text-white flex items-center gap-2">
            <Table size={18} className="text-amber-400" />
            Predict on New Data
          </h3>
          <p className="mb-4 text-sm text-slate-400">
            Upload a new CSV file to generate predictions using the trained pipeline.
          </p>

          <div
            onClick={() => inputRef.current?.click()}
            className="mb-4 flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-600 p-6 transition-colors hover:border-slate-500"
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setPredictFile(f);
              }}
            />
            {predictFile ? (
              <div className="flex items-center gap-2">
                <FileText size={20} className="text-emerald-400" />
                <span className="font-mono text-sm text-white">{predictFile.name}</span>
              </div>
            ) : (
              <>
                <Upload size={20} className="text-slate-500" />
                <span className="text-sm text-slate-500">Upload CSV for prediction</span>
              </>
            )}
          </div>

          <button
            onClick={handlePredict}
            disabled={!predictFile || predicting}
            className="btn-primary flex items-center gap-2"
          >
            {predicting ? <Loader2 size={16} className="animate-spin" /> : <Table size={16} />}
            {predicting ? "Predicting..." : "Run Prediction"}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
          <AlertCircle size={16} className="text-red-400" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {predictions.length > 0 && (
        <div className="card animate-slide-up">
          <h3 className="mb-4 text-lg font-semibold text-white">Prediction Results</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "#334155" }}>
                  <th className="pb-3 text-left font-medium text-slate-400">Index</th>
                  <th className="pb-3 text-right font-medium text-slate-400">Prediction</th>
                  <th className="pb-3 text-left font-medium text-slate-400">Top Contributing Features</th>
                </tr>
              </thead>
              <tbody>
                {predictions.map((row) => (
                  <tr key={row.index} className="border-b" style={{ borderColor: "#1e293b" }}>
                    <td className="py-3 pr-4 font-mono text-slate-300">{row.index}</td>
                    <td className="py-3 pr-4 text-right font-mono font-bold text-emerald-400">
                      {typeof row.prediction === "number" ? row.prediction.toFixed(4) : String(row.prediction)}
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {row.top_features?.slice(0, 5).map((f) => (
                          <span
                            key={f.feature}
                            className="badge font-mono text-xs"
                            style={{
                              backgroundColor:
                                f.contribution >= 0
                                  ? "rgba(239, 68, 68, 0.15)"
                                  : "rgba(59, 130, 246, 0.15)",
                              color: f.contribution >= 0 ? "#ef4444" : "#3b82f6",
                            }}
                          >
                            {f.feature}: {f.contribution >= 0 ? "+" : ""}
                            {f.contribution.toFixed(3)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
