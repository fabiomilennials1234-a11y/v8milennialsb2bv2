import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/modules/identity";
import { useOnboarding, type OnboardingAnswers } from "@/modules/platform/hooks/useOnboarding";
import { useOrganization } from "@/modules/identity";
import { generateSuggestions, type SuggestedPipeline, type SuggestedAutomation } from "@/modules/platform/lib/onboarding-suggestions";
import { useCreateCustomPipeline } from "@/modules/pipelines";
import { track } from "@/lib/analytics";
import { toast } from "sonner";
import { StepPerfilOperacao } from "./steps/StepPerfilOperacao";
import { StepEstruturaComercial } from "./steps/StepEstruturaComercial";
import { StepProcessoVendas } from "./steps/StepProcessoVendas";
import { StepConfiguracaoInicial } from "./steps/StepConfiguracaoInicial";
import { StepEquipe } from "./steps/StepEquipe";
import { StepWhatsApp } from "./steps/StepWhatsApp";
import { StepPrimeiroLead } from "./steps/StepPrimeiroLead";
import { StepRevisao } from "./steps/StepRevisao";
import { cn } from "@/lib/utils";
import { ChevronLeft, Building2, Users, GitBranch, Settings, MessageSquare, UserPlus, CheckCircle } from "lucide-react";
import torqueLogo from "@/assets/torque-logo.png";
import torqueLogoDark from "@/assets/torque-logo-dark.png";
import { useTheme } from "next-themes";

// Steps 0-3: profile quiz + pipeline config (keep existing flow)
// Steps 4-6: activation (team, whatsapp, lead) — new in-wizard actions
// Step 7: celebration
const STEP_KEYS = [
  "perfil",
  "estrutura",
  "processo",
  "configuracao",
  "equipe",
  "whatsapp",
  "lead",
  "pronto",
] as const;

const STEP_LABELS = [
  "Perfil",
  "Estrutura",
  "Processo",
  "Configuração",
  "Equipe",
  "WhatsApp",
  "Lead",
  "Pronto",
];

const STEP_ICONS = [Building2, Users, GitBranch, Settings, Users, MessageSquare, UserPlus, CheckCircle];

// Steps that need the quiz nav buttons (prev/next)
const QUIZ_STEPS = new Set([0, 1, 2]);

export function OnboardingWizard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const { onboarding, saveStepAnswers, complete, skip, markApplied, isSaving } = useOnboarding();
  const createCustomPipeline = useCreateCustomPipeline();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const initialStep = onboarding?.current_step ?? 0;
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [localAnswers, setLocalAnswers] = useState<OnboardingAnswers>(onboarding?.answers ?? {});
  const [isApplying, setIsApplying] = useState(false);

  const currentStepKey = STEP_KEYS[currentStep];
  const stepAnswers = useMemo(
    () => (localAnswers as Record<string, Record<string, unknown>>)[currentStepKey] ?? {},
    [localAnswers, currentStepKey],
  );

  const updateStepAnswer = useCallback((key: string, value: unknown) => {
    setLocalAnswers((prev) => ({
      ...prev,
      [currentStepKey]: { ...((prev as Record<string, Record<string, unknown>>)[currentStepKey] ?? {}), [key]: value },
    }));
  }, [currentStepKey]);

  const canAdvance = useMemo(() => {
    switch (currentStep) {
      case 0: return !!stepAnswers.sells && !!stepAnswers.segment && !!stepAnswers.avg_ticket && !!stepAnswers.monthly_volume;
      case 1: return !!stepAnswers.team_size && stepAnswers.has_sdr !== undefined && !!stepAnswers.seller_type;
      case 2: return !!stepAnswers.presentation_mode && !!stepAnswers.sales_cycle && stepAnswers.uses_proposal !== undefined;
      default: return true;
    }
  }, [currentStep, stepAnswers]);

  const goNext = async () => {
    if (currentStep < 3) {
      await saveStepAnswers(currentStepKey, stepAnswers, currentStep + 1);
      if (organizationId) {
        track({ event: "onboarding_step_completed", organizationId, metadata: { step: currentStepKey } });
      }
    }
    setCurrentStep((s) => Math.min(s + 1, STEP_KEYS.length - 1));
  };

  const goBack = () => setCurrentStep((s) => Math.max(s - 1, 0));

  const handleApplyConfig = async (pipelines: SuggestedPipeline[], automations: SuggestedAutomation[]) => {
    if (!organizationId) return;
    setIsApplying(true);
    try {
      // SCRUM-635: funil custom nasce pelo FLUXO DE CRIAÇÃO NORMAL
      // (useCreateCustomPipeline — slug/stage_key canônicos, rollback se as
      // etapas falharem), não mais por INSERT manual em custom_pipeline_stages.
      for (const pipe of pipelines) {
        try {
          await createCustomPipeline.mutateAsync({
            name: pipe.name,
            icon: pipe.icon,
            color: pipe.color,
            custom_stages: pipe.stages.map((s) => ({
              name: s.name,
              color: s.color,
              is_final_positive: s.is_final_positive,
              is_final_negative: s.is_final_negative,
            })),
          });
        } catch (pipeErr) {
          console.error("Pipeline create error:", pipeErr);
          continue;
        }
      }
      // SCRUM-641: o quiz NÃO semeia mais os funis de sistema legados. A org
      // já nasce com o "Funil de Vendas" (trigger trg_seed_default_funnel,
      // 20270918000000) como funil padrão; o que o quiz agrega são os funis
      // CUSTOM sugeridos acima — criados pelo fluxo normal. O rename do funil
      // padrão fica ao alcance do usuário como em qualquer funil.
      await markApplied();
      toast.success("Pipelines configurados!");
      setCurrentStep(4); // advance to Equipe
    } catch (err) {
      console.error("Apply config error:", err);
      toast.error("Erro ao aplicar configuração. Tente novamente.");
    } finally {
      setIsApplying(false);
    }
  };

  const handleFinish = async () => {
    if (user?.id) await complete(user.id);
    if (organizationId) {
      track({ event: "onboarding_step_completed", organizationId, metadata: { step: "completed" } });
    }
    navigate("/", { replace: true });
  };

  const handleSkip = async () => {
    await skip();
    navigate("/", { replace: true });
  };

  const suggestions = useMemo(() => generateSuggestions(localAnswers), [localAnswers]);

  const progressPercent = Math.round(((currentStep) / (STEP_KEYS.length - 1)) * 100);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/30">
        <img src={isDark ? torqueLogo : torqueLogoDark} alt="Torque" className="h-6 object-contain" />
        <button onClick={handleSkip} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Pular e explorar
        </button>
      </div>

      {/* Progress */}
      <div className="px-6 pt-4 pb-2">
        <div className="max-w-xl mx-auto space-y-2">
          {/* Step label row */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">
              {STEP_LABELS[currentStep]}
            </span>
            <span className="text-xs text-muted-foreground">
              {currentStep + 1} / {STEP_KEYS.length}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 w-full rounded-full bg-border/50 overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Step dots */}
          <div className="flex items-center gap-1 pt-1">
            {STEP_KEYS.map((_, i) => {
              const StepIcon = STEP_ICONS[i];
              const isActive = i === currentStep;
              const isDone = i < currentStep;
              return (
                <div key={i} className="flex items-center flex-1 min-w-0">
                  <div
                    className={cn(
                      "flex-shrink-0 transition-all duration-300",
                      isActive
                        ? "w-6 h-6 rounded-full bg-primary flex items-center justify-center"
                        : isDone
                        ? "w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center"
                        : "w-4 h-4 rounded-full bg-border/50"
                    )}
                  >
                    {(isActive || isDone) && (
                      <StepIcon
                        className={cn(
                          isActive ? "w-3 h-3 text-primary-foreground" : "w-2.5 h-2.5 text-primary"
                        )}
                      />
                    )}
                  </div>
                  {i < STEP_KEYS.length - 1 && (
                    <div
                      className={cn(
                        "h-px flex-1 mx-1 rounded-full transition-all duration-500",
                        isDone ? "bg-primary" : "bg-border/40"
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-lg mx-auto">
          {currentStep === 0 && <StepPerfilOperacao answers={stepAnswers} onChange={updateStepAnswer} />}
          {currentStep === 1 && <StepEstruturaComercial answers={stepAnswers} onChange={updateStepAnswer} />}
          {currentStep === 2 && <StepProcessoVendas answers={stepAnswers} onChange={updateStepAnswer} />}
          {currentStep === 3 && (
            <StepConfiguracaoInicial
              answers={localAnswers}
              onApply={handleApplyConfig}
              isApplying={isApplying}
            />
          )}
          {currentStep === 4 && <StepEquipe onNext={() => setCurrentStep(5)} />}
          {currentStep === 5 && <StepWhatsApp onNext={() => setCurrentStep(6)} />}
          {currentStep === 6 && <StepPrimeiroLead onNext={() => setCurrentStep(7)} />}
          {currentStep === 7 && <StepRevisao suggestions={suggestions} onFinish={handleFinish} />}
        </div>
      </div>

      {/* Bottom nav — only for quiz steps (0-2) */}
      {QUIZ_STEPS.has(currentStep) && (
        <div className="px-6 py-4 border-t border-border/30">
          <div className="max-w-lg mx-auto flex items-center justify-between">
            <button
              onClick={goBack}
              disabled={currentStep === 0}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Voltar
            </button>
            <button
              onClick={goNext}
              disabled={!canAdvance || isSaving}
              className="py-2.5 px-6 rounded-xl bg-primary text-primary-foreground font-medium text-sm transition-all hover:opacity-90 disabled:opacity-50"
            >
              {isSaving ? "Salvando..." : "Continuar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
