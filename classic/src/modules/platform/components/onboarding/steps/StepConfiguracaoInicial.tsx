import { useState, useMemo } from "react";
import { generateSuggestions, type SuggestedPipeline, type SuggestedAutomation } from "@/modules/platform/lib/onboarding-suggestions";
import type { OnboardingAnswers } from "@/modules/platform/hooks/useOnboarding";
import { GitBranch, Workflow, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  answers: OnboardingAnswers;
  onApply: (pipelines: SuggestedPipeline[], automations: SuggestedAutomation[]) => void;
  isApplying: boolean;
}

export function StepConfiguracaoInicial({ answers, onApply, isApplying }: Props) {
  const suggestions = useMemo(() => generateSuggestions(answers), [answers]);
  const [automationToggles, setAutomationToggles] = useState<Record<number, boolean>>(
    () => Object.fromEntries(suggestions.automations.map((a, i) => [i, a.enabled]))
  );

  const toggleAutomation = (idx: number) => {
    setAutomationToggles((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const handleApply = () => {
    const selectedAutomations = suggestions.automations.filter((_, i) => automationToggles[i]);
    onApply(suggestions.pipelines, selectedAutomations);
  };

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-primary font-medium mb-1">Perfil detectado</p>
        <h3 className="text-lg font-semibold">{suggestions.profileLabel}</h3>
        <p className="text-sm text-muted-foreground mt-1">Com base nas suas respostas, vamos configurar o sistema assim:</p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground/80">
          <GitBranch className="w-4 h-4" />
          <span>Funis sugeridos</span>
        </div>
        {suggestions.pipelines.map((pipe, i) => (
          <div key={i} className="border border-border/50 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ background: pipe.color }} />
              <span className="font-medium text-sm">{pipe.name}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {pipe.stages.map((stage, j) => (
                <span
                  key={j}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-full border",
                    stage.is_final_positive ? "border-green-500/30 text-green-600 bg-green-500/10" :
                    stage.is_final_negative ? "border-red-500/30 text-red-600 bg-red-500/10" :
                    "border-border/50 text-muted-foreground"
                  )}
                >
                  {stage.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {suggestions.automations.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground/80">
            <Workflow className="w-4 h-4" />
            <span>Automações sugeridas</span>
          </div>
          {suggestions.automations.map((auto, i) => (
            <button
              key={i}
              onClick={() => toggleAutomation(i)}
              className={cn(
                "w-full text-left border rounded-xl p-4 transition-all duration-150",
                automationToggles[i]
                  ? "border-primary/50 bg-primary/5"
                  : "border-border/50 opacity-60"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{auto.name}</span>
                {automationToggles[i] && <Check className="w-4 h-4 text-primary" />}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{auto.description}</p>
            </button>
          ))}
        </div>
      )}

      <button
        onClick={handleApply}
        disabled={isApplying}
        className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm transition-all hover:opacity-90 disabled:opacity-50"
      >
        {isApplying ? "Configurando..." : "Aplicar configuração"}
      </button>
    </div>
  );
}
