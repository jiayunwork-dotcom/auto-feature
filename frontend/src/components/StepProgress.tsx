import { useTaskStore, type StepKey } from "@/stores/taskStore";
import { Check } from "lucide-react";

const STEPS: { key: StepKey; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "overview", label: "Overview" },
  { key: "feature_engineering", label: "Feature Eng." },
  { key: "feature_selection", label: "Feature Sel." },
  { key: "model_search", label: "Model Search" },
  { key: "ensemble", label: "Ensemble" },
  { key: "explainability", label: "Explainability" },
  { key: "pipeline", label: "Pipeline" },
];

const STEP_ORDER: StepKey[] = STEPS.map((s) => s.key);

export default function StepProgress() {
  const currentStep = useTaskStore((s) => s.currentStep);
  const currentIndex = STEP_ORDER.indexOf(currentStep);

  return (
    <div className="flex items-center justify-center gap-0 py-4">
      {STEPS.map((step, idx) => {
        const isCompleted = idx < currentIndex;
        const isCurrent = idx === currentIndex;
        const isFuture = idx > currentIndex;

        return (
          <div key={step.key} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all duration-300 ${
                  isCurrent
                    ? "glow-accent text-white"
                    : isCompleted
                    ? "text-white"
                    : "text-slate-500"
                }`}
                style={{
                  backgroundColor: isCurrent
                    ? "#10b981"
                    : isCompleted
                    ? "rgba(16, 185, 129, 0.3)"
                    : "#1e293b",
                  border: isFuture ? "2px solid #334155" : "2px solid transparent",
                }}
              >
                {isCompleted ? <Check size={14} /> : idx + 1}
              </div>
              <span
                className={`mt-1.5 text-xs font-medium whitespace-nowrap ${
                  isCurrent
                    ? "text-emerald-400"
                    : isCompleted
                    ? "text-emerald-400/70"
                    : "text-slate-500"
                }`}
              >
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className="mx-1 h-0.5 w-8 rounded-full transition-all duration-300"
                style={{
                  backgroundColor: isCompleted
                    ? "#10b981"
                    : isCurrent
                    ? "rgba(16, 185, 129, 0.3)"
                    : "#334155",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
