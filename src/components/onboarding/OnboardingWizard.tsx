import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useOnboarding, type OnboardingAnswers } from "@/hooks/useOnboarding";
import { useOrganization } from "@/hooks/useOrganization";
import { generateSuggestions, type SuggestedPipeline, type SuggestedAutomation } from "@/lib/onboarding-suggestions";
import { generatePipelineDisplayConfig, applyPipelineDisplayConfig } from "@/lib/pipeline-config-from-quiz";
import { track } from "@/lib/analytics";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { StepPerfilOperacao } from "./steps/StepPerfilOperacao";
import { StepEstruturaComercial } from "./steps/StepEstruturaComercial";
import { StepProcessoVendas } from "./steps/StepProcessoVendas";
import { StepConfiguracaoInicial } from "./steps/StepConfiguracaoInicial";
import { StepAtivacao } from "./steps/StepAtivacao";
import { StepRevisao } from "./steps/StepRevisao";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import torqueLogo from "@/assets/torque-logo.png";
import torqueLogoDark from "@/assets/torque-logo-dark.png";
import { useTheme } from "next-themes";

const STEP_KEYS = ["perfil", "estrutura", "processo", "configuracao", "ativacao", "revisao"] as const;
const STEP_LABELS = ["Perfil", "Estrutura", "Processo", "Configuração", "Ativação", "Revisão"];

export function OnboardingWizard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const { onboarding, saveStepAnswers, complete, skip, markApplied, isSaving } = useOnboarding();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const initialStep = onboarding?.current_step ?? 0;
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [localAnswers, setLocalAnswers] = useState<OnboardingAnswers>(onboarding?.answers ?? {});
  const [isApplying, setIsApplying] = useState(false);

  const currentStepKey = STEP_KEYS[currentStep];
  const stepAnswers = (localAnswers as Record<string, Record<string, unknown>>)[currentStepKey] ?? {};

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
      for (const pipe of pipelines) {
        const slug = pipe.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        const { data: created, error: pipeErr } = await supabase
          .from("custom_pipelines")
          .insert({ organization_id: organizationId, name: pipe.name, slug, icon: pipe.icon, color: pipe.color, position: 0, is_active: true })
          .select("id")
          .single();
        if (pipeErr) { console.error("Pipeline create error:", pipeErr); continue; }
        const stageRows = pipe.stages.map((s, i) => ({
          organization_id: organizationId,
          pipeline_id: created.id,
          name: s.name,
          stage_key: s.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-"),
          color: s.color,
          position: i,
          is_active: true,
          is_final_positive: s.is_final_positive,
          is_final_negative: s.is_final_negative,
        }));
        await supabase.from("custom_pipeline_stages").insert(stageRows);
      }
      // Apply pipeline display config from quiz answers (names + visibility)
      const pipelineConfig = generatePipelineDisplayConfig(localAnswers);
      await applyPipelineDisplayConfig(supabase, organizationId, pipelineConfig);

      await markApplied();
      toast.success("Sistema configurado com sucesso!");
      setCurrentStep(4);
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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/30">
        <img src={isDark ? torqueLogo : torqueLogoDark} alt="Torque" className="h-6 object-contain" />
        <button onClick={handleSkip} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Pular e explorar
        </button>
      </div>

      <div className="px-6 py-4">
        <div className="flex gap-1.5 max-w-lg mx-auto">
          {STEP_KEYS.map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-all duration-300",
                i <= currentStep ? "bg-primary" : "bg-border/50"
              )}
            />
          ))}
        </div>
        <p className="text-center text-xs text-muted-foreground mt-2">
          {STEP_LABELS[currentStep]} ({currentStep + 1}/{STEP_KEYS.length})
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-lg mx-auto">
          {currentStep === 0 && <StepPerfilOperacao answers={stepAnswers} onChange={updateStepAnswer} />}
          {currentStep === 1 && <StepEstruturaComercial answers={stepAnswers} onChange={updateStepAnswer} />}
          {currentStep === 2 && <StepProcessoVendas answers={stepAnswers} onChange={updateStepAnswer} />}
          {currentStep === 3 && <StepConfiguracaoInicial answers={localAnswers} onApply={handleApplyConfig} isApplying={isApplying} />}
          {currentStep === 4 && <StepAtivacao priorities={suggestions.checklistPriorities} onDefer={() => setCurrentStep(5)} />}
          {currentStep === 5 && <StepRevisao suggestions={suggestions} onFinish={handleFinish} />}
        </div>
      </div>

      {currentStep < 3 && (
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
