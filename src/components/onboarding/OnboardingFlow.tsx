import type { OnboardingState } from "@/hooks/useOnboardingState";
import { OnbStepWhatsApp } from "./steps/OnbStepWhatsApp";
import { OnbStepPerfil } from "./steps/OnbStepPerfil";
import { OnbStepPipelines } from "./steps/OnbStepPipelines";
import { OnbStepAutomacoes } from "./steps/OnbStepAutomacoes";
import { cn } from "@/lib/utils";

const STEPS: { key: OnboardingState; label: string }[] = [
  { key: "pending_whatsapp", label: "WhatsApp" },
  { key: "pending_profile", label: "Perfil" },
  { key: "pending_pipelines", label: "Pipelines" },
  { key: "pending_automations", label: "Automações" },
];

interface Props {
  currentState: OnboardingState;
}

export function OnboardingFlow({ currentState }: Props) {
  const currentIndex = STEPS.findIndex((s) => s.key === currentState);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-amber-400 to-amber-600" />
          <span className="font-bold text-sm tracking-tight">Torque CRM</span>
        </div>
        <span className="text-xs text-muted-foreground">Configuração inicial</span>
      </div>

      <div className="px-12 pt-6">
        <div className="flex gap-2 mb-1.5">
          {STEPS.map((step, i) => (
            <div
              key={step.key}
              className={cn(
                "flex-1 h-1 rounded-full transition-colors",
                i <= currentIndex ? "bg-amber-500" : "bg-muted",
              )}
            />
          ))}
        </div>
        <div className="flex justify-between">
          {STEPS.map((step, i) => (
            <span
              key={step.key}
              className={cn(
                "text-[11px]",
                i <= currentIndex ? "text-amber-500 font-semibold" : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
          ))}
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        {currentState === "pending_whatsapp" && <OnbStepWhatsApp />}
        {currentState === "pending_profile" && <OnbStepPerfil />}
        {currentState === "pending_pipelines" && <OnbStepPipelines />}
        {currentState === "pending_automations" && <OnbStepAutomacoes />}
      </div>
    </div>
  );
}
