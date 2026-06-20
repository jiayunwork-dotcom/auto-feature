import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useTaskStore, type StepKey } from "@/stores/taskStore";
import {
  Upload,
  BarChart3,
  GitBranchPlus,
  AlertTriangle,
  Cog,
  Filter,
  Search,
  Layers,
  Brain,
  Download,
  GitBranch,
} from "lucide-react";

const STEPS: { key: StepKey; label: string; icon: React.ReactNode; path: string }[] = [
  { key: "upload", label: "Upload", icon: <Upload size={18} />, path: "/" },
  { key: "overview", label: "Overview", icon: <BarChart3 size={18} />, path: "/overview" },
  { key: "versioning", label: "版本管理", icon: <GitBranchPlus size={18} />, path: "/versioning" },
  { key: "feature_engineering", label: "Feature Engineering", icon: <Cog size={18} />, path: "/feature-engineering" },
  { key: "feature_selection", label: "Feature Selection", icon: <Filter size={18} />, path: "/feature-selection" },
  { key: "model_search", label: "Model Search", icon: <Search size={18} />, path: "/model-search" },
  { key: "ensemble", label: "Ensemble", icon: <Layers size={18} />, path: "/ensemble" },
  { key: "explainability", label: "Explainability", icon: <Brain size={18} />, path: "/explainability" },
  { key: "pipeline", label: "Pipeline", icon: <Download size={18} />, path: "/pipeline" },
  { key: "attribution", label: "归因报告", icon: <GitBranch size={18} />, path: "/attribution" },
];

const STEP_ORDER: StepKey[] = [
  "upload",
  "overview",
  "versioning",
  "feature_engineering",
  "feature_selection",
  "model_search",
  "ensemble",
  "explainability",
  "pipeline",
  "attribution",
];

function getStepIndex(step: StepKey): number {
  return STEP_ORDER.indexOf(step);
}

export default function Layout() {
  const currentStep = useTaskStore((s) => s.currentStep);
  const taskId = useTaskStore((s) => s.taskId);
  const navigate = useNavigate();
  const currentIndex = getStepIndex(currentStep);

  function buildPath(step: StepKey): string {
    if (step === "upload") return "/";
    if (!taskId) return "/";
    const base = STEPS.find((s) => s.key === step)?.path;
    return base ? `${base}/${taskId}` : "/";
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: "#0f172a" }}>
      <aside className="flex w-64 flex-shrink-0 flex-col border-r" style={{ backgroundColor: "#1e293b", borderColor: "#334155" }}>
        <div className="flex h-14 items-center gap-2 border-b px-5" style={{ borderColor: "#334155" }}>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: "#10b981" }}>
            <Cog size={16} className="text-white" />
          </div>
          <span className="text-lg font-bold text-white tracking-tight">AutoFeature</span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <div className="space-y-1">
            {STEPS.map((step, idx) => {
              const isActive = step.key === currentStep;
              const isCompleted = idx < currentIndex;
              const isDisabled = !taskId && step.key !== "upload";

              return (
                <NavLink
                  key={step.key}
                  to={buildPath(step.key)}
                  onClick={(e) => {
                    if (isDisabled) e.preventDefault();
                  }}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200 ${
                    isActive
                      ? "text-white"
                      : isCompleted
                      ? "text-emerald-400"
                      : isDisabled
                      ? "text-slate-600 cursor-not-allowed"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                  style={
                    isActive
                      ? { backgroundColor: "rgba(16, 185, 129, 0.15)" }
                      : undefined
                  }
                >
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-md text-xs ${
                      isActive
                        ? "glow-accent"
                        : isCompleted
                        ? "bg-emerald-500/20"
                        : "bg-slate-700/50"
                    }`}
                    style={
                      isActive
                        ? { backgroundColor: "#10b981" }
                        : undefined
                    }
                  >
                    {isCompleted ? (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <span style={{ fontSize: 11 }}>{idx + 1}</span>
                    )}
                  </div>
                  <span className="font-medium">{step.label}</span>
                  {isActive && (
                    <div className="ml-auto h-1.5 w-1.5 rounded-full animate-pulse-glow" style={{ backgroundColor: "#10b981" }} />
                  )}
                </NavLink>
              );
            })}
          </div>
        </nav>

        {taskId && (
          <div className="border-t px-4 py-3" style={{ borderColor: "#334155" }}>
            <p className="text-xs text-slate-500">Task ID</p>
            <p className="font-mono text-xs text-slate-300 truncate">{taskId}</p>
          </div>
        )}
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
