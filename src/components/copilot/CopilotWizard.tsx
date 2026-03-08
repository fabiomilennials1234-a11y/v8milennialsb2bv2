/**
 * Wizard Configuration-Driven para Criação de Copilot Agent
 *
 * Fluxo em 2 fases:
 * 1. Seleção de template (mostra os 5 tipos)
 * 2. Steps específicos carregados da config do tipo selecionado
 *
 * Cada tipo tem quantidade e ordem de steps diferentes:
 * - Agendador: ~7 steps
 * - Follow-up: ~8 steps
 * - Qualificador: ~12 steps
 * - Prospectador: ~13 steps
 * - SDR: ~15 steps
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Check, X, Eye, Info, Loader2, CheckCircle2, Rocket, Settings, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useCreateCopilotAgent, useCopilotAgentForEdit, useUpdateCopilotAgentFromWizard } from "@/hooks/useCopilotAgents";
import { useUploadAgentDocument } from "@/hooks/useAgentDocuments";
import { useUploadCopilotAgentAudio } from "@/hooks/useCopilotAgentAudios";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import type { CopilotWizardData } from "@/types/copilot";
import type { AgentDocument } from "@/hooks/useAgentDocuments";

import { TemplateStep } from "./wizard-steps/TemplateStep";
import { getWizardConfig, STEP_REGISTRY } from "./wizard-configs";
import type { WizardTypeConfig } from "./wizard-configs";
import { PromptPreviewSheet } from "./PromptPreviewSheet";
import { mapWizardDataToAgentPreview } from "@/lib/copilot/prompt-utils";
import { serializeCustomInstructions } from "@/lib/copilot/custom-instructions-utils";
import { generatePrompt } from "@/hooks/useCopilotPromptBuilder";
import {
  computePromptQuality,
  getQualityColor,
  getQualityBgColor,
  getQualityLabel,
} from "@/lib/copilot/prompt-quality";
import { STEP_TIPS } from "@/lib/copilot/step-tips";

// Schema de validação (permissivo - validação por step é feita via config)
const wizardSchema = z.object({
  templateType: z.string().min(1, "Selecione um template"),
  name: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
  personality: z.object({
    tone: z.string(),
    style: z.string(),
    energy: z.string(),
  }),
  skills: z.array(z.string()).min(1, "Selecione pelo menos uma habilidade"),
  allowedTopics: z.array(z.string()),
  forbiddenTopics: z.array(z.string()),
  faqs: z.array(
    z.object({
      question: z.string().min(1, "Pergunta obrigatória"),
      answer: z.string().min(1, "Resposta obrigatória"),
    })
  ),
  businessContext: z.object({
    companyName: z.string().min(2, "Informe o nome da empresa"),
    productSummary: z.string().min(30, "Descreva o produto/serviço com mais detalhes (mín. 30 chars)"),
    idealCustomerProfile: z.string().min(30, "Descreva o ICP com mais detalhes (mín. 30 chars)"),
    serviceRegion: z.string().optional().or(z.literal("")),
    valueProps: z.string().min(30, "Informe os diferenciais com mais detalhes (mín. 30 chars)"),
    customerPains: z.string().min(20, "Informe as dores que resolve (mín. 20 chars)"),
    socialProof: z.string().optional().or(z.literal("")),
    pricingPolicy: z.string().optional().or(z.literal("")),
    commercialTerms: z.string().optional().or(z.literal("")),
    businessHoursSla: z.string().optional().or(z.literal("")),
    primaryCta: z.string().min(5, "Informe o próximo passo padrão"),
    compliancePolicy: z.string().optional().or(z.literal("")),
  }),
  conversationStyle: z.object({
    responseLength: z.enum(["curto", "medio", "detalhado"]),
    maxQuestions: z.enum(["1", "2"]),
    emojiPolicy: z.enum(["nunca", "raro", "moderado"]),
    openingStyle: z.string().optional().or(z.literal("")),
    closingStyle: z.string().optional().or(z.literal("")),
    whatsappGuidelines: z.string().optional().or(z.literal("")),
    humanizationTips: z.string().optional().or(z.literal("")),
    hideAiIdentity: z.boolean().optional().default(false),
  }),
  qualification: z.object({
    requiredFields: z.array(z.string()).min(1, "Selecione ao menos 1 campo obrigatório"),
    optionalFields: z.array(z.string()),
    notes: z.string().optional().or(z.literal("")),
  }),
  examples: z.array(
    z.object({
      lead: z.string().min(1, "Mensagem do lead obrigatória"),
      agent: z.string().min(1, "Resposta do agente obrigatória"),
    })
  ).optional().default([]),
  availability: z.object({
    mode: z.enum(["always", "scheduled"]),
    timezone: z.string().min(1, "Informe o fuso horário"),
    days: z.array(z.string()).min(1, "Selecione ao menos um dia"),
    start: z.string().min(1, "Informe o horário de início"),
    end: z.string().min(1, "Informe o horário de fim"),
  }),
  responseDelaySeconds: z
    .number()
    .min(0, "Não pode ser negativo")
    .max(30, "Máximo de 30 segundos"),
  mainObjective: z
    .string()
    .min(10, "Descreva o objetivo com mais detalhes")
    .max(500, "Objetivo muito longo (máximo 500 caracteres)"),
  objectiveComposite: z.object({
    mission: z.string().min(20, "Missão deve ter pelo menos 20 caracteres"),
    success_criteria: z.string().min(10, "Critério de sucesso deve ter pelo menos 10 caracteres"),
    limits: z.string().optional().or(z.literal("")),
  }),
  customInstructions: z.preprocess(
    (v) => {
      if (v === undefined || v === null) return { dos: "", donts: "" };
      if (typeof v === "string") return { dos: v, donts: "" };
      return v;
    },
    z.object({
      dos: z.string().max(2000, "Máximo 2000 caracteres").default(""),
      donts: z.string().max(2000, "Máximo 2000 caracteres").default(""),
    })
  ).default({ dos: "", donts: "" }),
  knowledgeBaseFiles: z.array(z.any()).optional().default([]),
  canQualifyLead: z.boolean().default(true),
  canScheduleMeeting: z.boolean().default(true),
  canSendFollowup: z.boolean().default(true),
  canUpdateCrm: z.boolean().default(false),
  canAnswerFaq: z.boolean().default(true),
  canCreateLead: z.boolean().default(true),
  canTransferHuman: z.boolean().default(true),
  canMoveCards: z.boolean().default(false),
  maxConversationTurns: z.number().min(5).max(50).default(20),
  responseDelayMs: z.number().min(0).max(45000).default(1000),
  llmTemperatureMode: z.enum(['criativo', 'balanceado', 'preciso']).default('balanceado'),
  personaDescription: z.string().optional().default(""),
  skillsAndTopics: z.string().optional().default(""),
  kanbanRules: z.array(z.any()),
  followupRules: z.array(z.any()).optional().default([]),
  attendUnknownContacts: z.boolean().optional().default(false),
  operationMode: z.enum(["inbound", "outbound", "hybrid"]),
  activationTriggers: z.object({
    required: z.object({
      tags: z.array(z.string()),
      origins: z.array(z.string()),
      hasPhone: z.boolean(),
      hasEmail: z.boolean(),
    }),
    optional: z.array(z.object({
      field: z.string(),
      operator: z.string(),
      value: z.string(),
    })),
  }),
  outboundConfig: z.object({
    delayMinutes: z.number().min(0).max(1440),
    firstMessageTemplate: z.string(),
    availableVariables: z.array(z.string()),
    maxRetries: z.number().min(1).max(5),
    retryIntervalMinutes: z.number().min(1).max(60),
    audioEnabled: z.boolean().optional(),
    audioSendOrder: z.enum(["text_first", "audio_first"]).optional(),
  }),
  automationActions: z.object({
    onQualify: z.object({
      moveToStage: z.string().optional().or(z.literal("")),
      moveToPipe: z.object({ pipe: z.enum(["confirmacao", "propostas"]), stage: z.string() }).optional().nullable(),
      addTags: z.array(z.string()),
      notifyUserId: z.string().nullable(),
      sendMessage: z.boolean(),
      messageTemplate: z.string().optional().or(z.literal("")),
    }).refine(
      (data) => {
        if (!data.sendMessage) return true;
        return data.messageTemplate !== undefined &&
               data.messageTemplate !== null &&
               typeof data.messageTemplate === 'string' &&
               data.messageTemplate.trim().length > 0;
      },
      {
        message: "Template da mensagem é obrigatório quando 'Enviar mensagem automática' está ativado",
        path: ["messageTemplate"],
      }
    ),
    onDisqualify: z.object({
      moveToStage: z.string().optional().or(z.literal("")),
      moveToPipe: z.object({ pipe: z.enum(["confirmacao", "propostas"]), stage: z.string() }).optional().nullable(),
      addTags: z.array(z.string()),
      notifyUserId: z.string().nullable(),
      sendMessage: z.boolean(),
      messageTemplate: z.string().optional().or(z.literal("")),
    }).refine(
      (data) => {
        if (!data.sendMessage) return true;
        return data.messageTemplate !== undefined &&
               data.messageTemplate !== null &&
               typeof data.messageTemplate === 'string' &&
               data.messageTemplate.trim().length > 0;
      },
      {
        message: "Template da mensagem é obrigatório quando 'Enviar mensagem automática' está ativado",
        path: ["messageTemplate"],
      }
    ),
    onNeedHuman: z.object({
      moveToStage: z.string().optional().or(z.literal("")),
      moveToPipe: z.object({ pipe: z.enum(["confirmacao", "propostas"]), stage: z.string() }).optional().nullable(),
      addTags: z.array(z.string()),
      notifyUserId: z.string().nullable(),
      sendMessage: z.boolean(),
      messageTemplate: z.string().optional().or(z.literal("")),
    }).refine(
      (data) => {
        if (!data.sendMessage) return true;
        return data.messageTemplate !== undefined &&
               data.messageTemplate !== null &&
               typeof data.messageTemplate === 'string' &&
               data.messageTemplate.trim().length > 0;
      },
      {
        message: "Template da mensagem é obrigatório quando 'Enviar mensagem automática' está ativado",
        path: ["messageTemplate"],
      }
    ),
  }),
});

const BASE_DEFAULTS: CopilotWizardData = {
  templateType: "",
  name: "",
  personality: { tone: "profissional", style: "consultivo", energy: "moderada" },
  skills: [],
  allowedTopics: [],
  forbiddenTopics: [],
  faqs: [],
  businessContext: {
    companyName: "",
    productSummary: "",
    idealCustomerProfile: "",
    serviceRegion: "",
    valueProps: "",
    customerPains: "",
    socialProof: "",
    pricingPolicy: "",
    commercialTerms: "",
    businessHoursSla: "",
    primaryCta: "",
    compliancePolicy: "",
  },
  conversationStyle: {
    responseLength: "curto",
    maxQuestions: "1",
    emojiPolicy: "raro",
    openingStyle: "",
    closingStyle: "",
    whatsappGuidelines: "Use mensagens curtas, com quebras de linha. Evite blocos longos.",
    humanizationTips: "Confirme entendimento antes de perguntar algo novo. Evite soar robótico.",
  },
  qualification: {
    requiredFields: ["Necessidade / Dor principal", "Volume / Escopo", "Urgência / Prazo"],
    optionalFields: [],
    notes: "",
  },
  examples: [],
  availability: {
    mode: "always",
    timezone: "America/Sao_Paulo",
    days: ["mon", "tue", "wed", "thu", "fri"],
    start: "09:00",
    end: "18:00",
  },
  responseDelaySeconds: 8,
  mainObjective: "",
  objectiveComposite: { mission: "", success_criteria: "", limits: "" },
  customInstructions: { dos: "", donts: "" },
  knowledgeBaseFiles: [],
  canQualifyLead: true,
  canScheduleMeeting: true,
  canSendFollowup: true,
  canUpdateCrm: false,
  canAnswerFaq: true,
  canCreateLead: true,
  canTransferHuman: true,
  canMoveCards: false,
  maxConversationTurns: 20,
  responseDelayMs: 1000,
  llmTemperatureMode: 'balanceado' as const,
  personaDescription: "",
  skillsAndTopics: "",
  kanbanRules: [],
  followupRules: [],
  attendUnknownContacts: false,
  operationMode: "inbound",
  activationTriggers: {
    required: { tags: [], origins: [], hasPhone: true, hasEmail: false },
    optional: [],
  },
  outboundConfig: {
    delayMinutes: 5,
    firstMessageTemplate: "Oi {nome}! Vi que você demonstrou interesse em {interesse}. O que mais te chamou atenção?",
    availableVariables: ["nome", "empresa", "email", "telefone", "origem", "interesse", "segmento", "campanha"],
    maxRetries: 3,
    retryIntervalMinutes: 30,
    audioEnabled: false,
    audioSendOrder: "text_first" as const,
  },
  automationActions: {
    onQualify: {
      moveToStage: "agendado",
      moveToPipe: null,
      addTags: ["qualificado"],
      notifyUserId: null,
      sendMessage: false,
      messageTemplate: "",
    },
    onDisqualify: {
      moveToStage: "descartado",
      moveToPipe: null,
      addTags: ["sem_fit"],
      notifyUserId: null,
      sendMessage: true,
      messageTemplate: "Entendo! Caso mude de ideia no futuro, estamos à disposição. Tenha um ótimo dia!",
    },
    onNeedHuman: {
      moveToStage: "aguardando_humano",
      moveToPipe: null,
      addTags: ["precisa_humano"],
      notifyUserId: null,
      sendMessage: true,
      messageTemplate: "Um momento, vou transferir você para um de nossos especialistas.",
    },
  },
};

/** Resolve step IDs da config para componentes + títulos */
function resolveSteps(config: WizardTypeConfig) {
  return config.steps
    .map((stepId) => {
      const entry = STEP_REGISTRY[stepId];
      if (!entry) {
        console.warn(`Step "${stepId}" not found in registry`);
        return null;
      }
      return {
        id: stepId,
        title: entry.title,
        component: entry.component,
        fieldToValidate: entry.fieldToValidate,
      };
    })
    .filter(Boolean) as Array<{
      id: string;
      title: string;
      component: React.ComponentType;
      fieldToValidate: keyof CopilotWizardData | (keyof CopilotWizardData)[];
    }>;
}

export function CopilotWizard() {
  const { id: editAgentId } = useParams<{ id: string }>();
  const isEditMode = !!editAgentId;

  const [currentStep, setCurrentStep] = useState(0);
  const [activeConfig, setActiveConfig] = useState<WizardTypeConfig | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [existingDocuments, setExistingDocuments] = useState<AgentDocument[]>([]);
  const [documentsToRemove, setDocumentsToRemove] = useState<Array<{ documentId: string; filePath: string }>>([]);
  const [visitedSteps, setVisitedSteps] = useState<Set<number>>(new Set([0]));
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  const editDataLoaded = useRef(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const DRAFT_KEY = "copilot_wizard_draft";
  const navigate = useNavigate();
  const createAgent = useCreateCopilotAgent();
  const updateAgent = useUpdateCopilotAgentFromWizard();
  const uploadDocument = useUploadAgentDocument();
  const uploadAgentAudio = useUploadCopilotAgentAudio();

  // Buscar dados do agente para edição
  const { data: editData, isLoading: isLoadingEdit } = useCopilotAgentForEdit(editAgentId);

  const methods = useForm<CopilotWizardData>({
    resolver: zodResolver(wizardSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: BASE_DEFAULTS,
  });

  const { handleSubmit, trigger, formState, getValues, watch, reset } = methods;
  const templateType = watch("templateType");

  // Modo edição: carregar dados do agente no form (uma vez)
  useEffect(() => {
    if (!isEditMode || !editData || editDataLoaded.current) return;

    const { wizardData, existingDocuments: docs } = editData;

    // Carregar config do template
    const config = getWizardConfig(wizardData.templateType);
    if (config) {
      setActiveConfig(config);
      setCurrentStep(0);
    }

    // Preencher form com dados existentes
    reset(wizardData, { keepDirtyValues: false });

    // Guardar documentos existentes
    setExistingDocuments(docs);

    editDataLoaded.current = true;
  }, [isEditMode, editData, reset]);

  // Modo criação: quando template muda, carregar config e aplicar defaults
  useEffect(() => {
    if (isEditMode) return; // Não interferir no modo edição

    if (!templateType) {
      setActiveConfig(null);
      return;
    }

    const config = getWizardConfig(templateType);
    if (config) {
      setActiveConfig(config);
      setCurrentStep(0); // Voltar ao primeiro step da config

      // Aplicar defaults da config sobre os defaults base
      const mergedDefaults = {
        ...BASE_DEFAULTS,
        ...config.defaults,
        // Manter o templateType selecionado
        templateType,
        // Pré-popular kanban rules sugeridas
        kanbanRules: config.suggestedKanbanRules.map((rule) => ({
          pipeType: rule.pipe_type,
          stageName: rule.stage_name,
          goal: rule.goal,
          behavior: rule.behavior,
          allowedActions: rule.allowed_actions,
          forbiddenActions: rule.forbidden_actions,
        })),
      };

      // Reset form com novos defaults
      reset(mergedDefaults, { keepDirtyValues: false });
    }
  }, [templateType, reset, isEditMode]);

  // Resolver steps da config ativa
  const resolvedSteps = useMemo(() => {
    if (!activeConfig) return [];
    return resolveSteps(activeConfig);
  }, [activeConfig]);

  // Ajustar currentStep se steps mudaram
  useEffect(() => {
    if (resolvedSteps.length > 0 && currentStep >= resolvedSteps.length) {
      setCurrentStep(Math.max(0, resolvedSteps.length - 1));
    }
  }, [resolvedSteps.length, currentStep]);

  // Resetar steps visitados quando config muda
  useEffect(() => {
    setVisitedSteps(new Set([0]));
    setCurrentStep(0);
  }, [activeConfig?.type]);

  // Observar dados do formulário para quality score
  const watchedData = watch();

  // Auto-save draft no localStorage (apenas modo criação, debounced 1s)
  useEffect(() => {
    if (isEditMode || !activeConfig) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      try {
        const values = getValues();
        if (values.templateType) {
          localStorage.setItem(DRAFT_KEY, JSON.stringify(values));
        }
      } catch {/* ignore storage errors */}
    }, 1000);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [watchedData, isEditMode, activeConfig, getValues]);

  // Restaurar rascunho ao selecionar template (apenas criação)
  useEffect(() => {
    if (isEditMode || !activeConfig) return;
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as CopilotWizardData;
      if (parsed.templateType !== activeConfig.type) return;
      // Só restaura se há dados significativos (nome preenchido)
      if (!parsed.name || parsed.name.trim().length < 3) return;
      // Normalizar customInstructions para o novo formato (migração de string → objeto)
      if (typeof (parsed as any).customInstructions === "string") {
        const raw = (parsed as any).customInstructions as string;
        parsed.customInstructions = { dos: raw, donts: "" };
      } else if (!parsed.customInstructions || typeof parsed.customInstructions !== "object") {
        parsed.customInstructions = { dos: "", donts: "" };
      }
      reset(parsed, { keepDirtyValues: false });
      toast.info("Rascunho restaurado", {
        description: `Continuando de onde você parou: "${parsed.name}"`,
        action: {
          label: "Descartar",
          onClick: () => {
            localStorage.removeItem(DRAFT_KEY);
            const config = getWizardConfig(activeConfig.type);
            if (config) {
              reset(
                { ...BASE_DEFAULTS, ...config.defaults, templateType: activeConfig.type,
                  kanbanRules: config.suggestedKanbanRules.map((r) => ({
                    pipeType: r.pipe_type, stageName: r.stage_name,
                    goal: r.goal, behavior: r.behavior,
                    allowedActions: r.allowed_actions, forbiddenActions: r.forbidden_actions,
                  })),
                },
                { keepDirtyValues: false }
              );
            }
          },
        },
      });
    } catch {/* ignore */}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConfig?.type, isEditMode]);

  // Quality score computado a partir dos dados do form (template-aware)
  const quality = useMemo(
    () => computePromptQuality(watchedData, watchedData.templateType),
    [watchedData]
  );

  // Gerar preview do prompt sob demanda
  const previewPrompt = useMemo(() => {
    if (!previewOpen) return "";
    try {
      const { agent, faqs } = mapWizardDataToAgentPreview(watchedData as CopilotWizardData);
      const kanbanRules = (watchedData.kanbanRules || []).map((r: any) => ({
        id: `kr-${r.stageName}`,
        agent_id: "preview",
        pipe_type: r.pipeType || "whatsapp",
        stage_name: r.stageName || "",
        goal: r.goal || "",
        behavior: r.behavior || "",
        allowed_actions: r.allowedActions || [],
        forbidden_actions: r.forbiddenActions || [],
        position: 0,
        created_at: new Date().toISOString(),
      }));
      const result = generatePrompt(agent, faqs, kanbanRules);
      return result?.systemPrompt || "(Prompt vazio — preencha mais campos)";
    } catch (err) {
      console.error("[PromptPreview] Erro ao gerar preview:", err);
      return `(Erro ao gerar preview: ${err instanceof Error ? err.message : String(err)})`;
    }
  }, [previewOpen, watchedData]);

  const totalSteps = resolvedSteps.length;
  const progress = totalSteps > 0 ? ((currentStep + 1) / totalSteps) * 100 : 0;
  const currentStepData = resolvedSteps[currentStep];
  const CurrentStepComponent = currentStepData?.component;
  const isLastStep = currentStep === totalSteps - 1;

  const handleNext = useCallback(async () => {
    if (!currentStepData) return;

    const fieldToValidate = currentStepData.fieldToValidate;
    const isValid = await trigger(fieldToValidate as any);

    if (isValid && currentStep < totalSteps - 1) {
      const nextStep = currentStep + 1;
      setCurrentStep(nextStep);
      setVisitedSteps((prev) => new Set([...prev, nextStep]));
    }
  }, [currentStepData, currentStep, totalSteps, trigger]);

  const handlePrevious = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

  const handleCancel = useCallback(() => {
    if (isEditMode && formState.isDirty) {
      const confirmed = window.confirm("Você tem alterações não salvas. Deseja sair?");
      if (!confirmed) return;
    }
    navigate("/copilot");
  }, [navigate, isEditMode, formState.isDirty]);

  const handleBackToTemplate = useCallback(() => {
    setActiveConfig(null);
    setCurrentStep(0);
    reset(BASE_DEFAULTS);
  }, [reset]);

  // Flag de pending unificada para ambos os modos
  const isSaving = isEditMode ? updateAgent.isPending : createAgent.isPending;

  const onSubmit = async (data: CopilotWizardData) => {
    try {
      const isValid = await trigger();
      if (!isValid) {
        const errorMessages = Object.entries(formState.errors)
          .map(([key, error]) => {
            if (error && typeof error === 'object' && 'message' in error) {
              return `${key}: ${error.message}`;
            }
            return `${key}: Erro de validação`;
          })
          .filter(Boolean);

        toast.error("Formulário inválido", {
          description: errorMessages.length > 0
            ? errorMessages.slice(0, 3).join(", ") + (errorMessages.length > 3 ? "..." : "")
            : "Por favor, verifique todos os campos obrigatórios",
          duration: 5000,
        });
        return;
      }

      // =====================================================
      // MODO EDIÇÃO
      // =====================================================
      if (isEditMode && editAgentId) {
        const updatedAgent = await updateAgent.mutateAsync({
          agentId: editAgentId,
          data,
          documentsToRemove,
        });

        // Upload de novos documentos da knowledge base (se houver)
        const filesToUpload = data.knowledgeBaseFiles || [];
        if (filesToUpload.length > 0 && updatedAgent?.id && updatedAgent?.organization_id) {
          for (const file of filesToUpload) {
            try {
              await uploadDocument.mutateAsync({
                agentId: updatedAgent.id,
                organizationId: updatedAgent.organization_id,
                file,
              });
            } catch (uploadErr) {
              console.error("Erro ao enviar documento:", uploadErr);
            }
          }
        }

        setTimeout(() => {
          try {
            navigate("/copilot");
          } catch (navError) {
            window.location.href = "/copilot";
          }
        }, 500);
        return;
      }

      // =====================================================
      // MODO CRIAÇÃO (fluxo original, intocado)
      // =====================================================
      const agentPayload: any = {
        name: data.name,
        template_type: data.templateType,
        personality_tone: data.personality.tone,
        personality_style: data.personality.style,
        personality_energy: data.personality.energy,
        skills: data.skills || [],
        allowed_topics: data.allowedTopics || [],
        forbidden_topics: data.forbiddenTopics || [],
        main_objective: data.objectiveComposite?.mission || data.mainObjective,
        objective_composite: data.objectiveComposite?.mission
          ? data.objectiveComposite
          : null,
        custom_instructions: serializeCustomInstructions(
          data.customInstructions?.dos || "",
          data.customInstructions?.donts || ""
        ),
        business_context: { ...(data.businessContext || {}), skillsAndTopics: data.skillsAndTopics || "" },
        conversation_style: { ...(data.conversationStyle || {}), personaDescription: data.personaDescription || "" },
        qualification_rules: data.qualification || {},
        few_shot_examples: data.examples || [],
        availability: data.availability || {},
        response_delay_seconds: data.responseDelaySeconds ?? 0,
        is_active: false,
        operation_mode: data.operationMode || "inbound",
        attend_unknown_contacts: data.attendUnknownContacts ?? false,
        wizard_version: 2,
      };

      if (data.activationTriggers) {
        agentPayload.activation_triggers = data.activationTriggers;
      }
      if (data.operationMode === "outbound" || data.operationMode === "hybrid") {
        if (data.outboundConfig) {
          agentPayload.outbound_config = data.outboundConfig;
        }
      } else {
        agentPayload.outbound_config = null;
      }
      if (data.automationActions) {
        agentPayload.automation_actions = data.automationActions;
      }

      // Capabilities escolhidas pelo usuário no wizard
      agentPayload.can_qualify_lead = data.canQualifyLead ?? true;
      agentPayload.can_schedule_meeting = data.canScheduleMeeting ?? true;
      agentPayload.can_send_followup = data.canSendFollowup ?? true;
      agentPayload.can_update_crm = data.canUpdateCrm ?? false;
      agentPayload.can_answer_faq = data.canAnswerFaq ?? true;
      agentPayload.can_create_lead = data.canCreateLead ?? true;
      agentPayload.can_transfer_human = data.canTransferHuman ?? true;
      agentPayload.can_move_cards = data.canMoveCards ?? false;
      agentPayload.max_conversation_turns = data.maxConversationTurns ?? 20;
      agentPayload.response_delay_ms = data.responseDelayMs ?? 1000;
      agentPayload.llm_temperature_mode = data.llmTemperatureMode ?? 'balanceado';

      // Filtrar regras desativadas pelo usuário no funil de confirmação
      const activeKanbanRules = (data.kanbanRules || [])
        .filter((r: any) => !r._disabled)
        .map(({ _disabled, ...rule }: any) => rule);

      const createdAgent = await createAgent.mutateAsync({
        agent: agentPayload,
        faqs: data.faqs || [],
        kanbanRules: activeKanbanRules,
        followupRules: data.followupRules || [],
      });

      // Upload de documentos da knowledge base (se houver)
      const filesToUpload = data.knowledgeBaseFiles || [];
      if (filesToUpload.length > 0 && createdAgent?.id && createdAgent?.organization_id) {
        for (const file of filesToUpload) {
          try {
            await uploadDocument.mutateAsync({
              agentId: createdAgent.id,
              organizationId: createdAgent.organization_id,
              file,
            });
          } catch (uploadErr) {
            console.error("Erro ao enviar documento:", uploadErr);
          }
        }
      }

      // Upload de áudios de abordagem (se houver)
      const pendingAudioFiles = (data as any)._pendingAudioFiles || [];
      if (pendingAudioFiles.length > 0 && createdAgent?.id && createdAgent?.organization_id) {
        for (const audio of pendingAudioFiles) {
          try {
            await uploadAgentAudio.mutateAsync({
              agentId: createdAgent.id,
              organizationId: createdAgent.organization_id,
              file: audio.file,
              name: audio.name,
            });
          } catch (audioErr) {
            console.error("Erro ao enviar áudio:", audioErr);
          }
        }
      }

      // Limpar draft e mostrar tela de sucesso
      try { localStorage.removeItem(DRAFT_KEY); } catch {/* ignore */}
      setCreatedAgentId(createdAgent?.id || "new");
    } catch (error: any) {
      let errorMessage = isEditMode
        ? "Erro desconhecido ao atualizar o agente"
        : "Erro desconhecido ao criar o agente";
      if (error?.message) {
        errorMessage = error.message;
      } else if (error?.error?.message) {
        errorMessage = error.error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }

      if (errorMessage.includes("unique_agent_name_per_org")) {
        errorMessage = "Já existe um agente com este nome na sua organização. Escolha um nome diferente.";
      } else if (errorMessage.includes("activation_triggers") || errorMessage.includes("column")) {
        errorMessage = "Coluna não encontrada no banco. Execute a migration pendente.";
      }

      toast.error(isEditMode ? "Erro ao atualizar Copilot" : "Erro ao criar Copilot", {
        description: errorMessage,
        duration: 10000,
      });
    }
  };

  // Loading state para modo edição
  if (isEditMode && isLoadingEdit) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto flex flex-col items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Carregando dados do copilot...</p>
        </div>
      </div>
    );
  }

  // Fase 1: Seleção de template (sem config ativa) — apenas modo criação
  if (!activeConfig && !isEditMode) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <h1 className="text-3xl font-bold text-primary mb-2">
              Criar Novo Copilot
            </h1>
            <p className="text-muted-foreground">
              Escolha o tipo de agente para começar a configuração
            </p>
          </motion.div>

          <FormProvider {...methods}>
            <Card className="p-8">
              <TemplateStep />
            </Card>

            <div className="flex justify-between mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
              >
                <X className="w-4 h-4 mr-2" />
                Cancelar
              </Button>
            </div>
          </FormProvider>
        </div>
      </div>
    );
  }

  // Se modo edição e config ainda não carregou, aguardar
  if (!activeConfig) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto flex flex-col items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Preparando wizard...</p>
        </div>
      </div>
    );
  }

  // Tela de sucesso após criação
  if (createdAgentId) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-2xl mx-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="text-center py-12"
          >
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 rounded-full bg-green-500/10 border-2 border-green-500/30 flex items-center justify-center">
                <CheckCircle2 className="w-10 h-10 text-green-500" />
              </div>
            </div>
            <h1 className="text-3xl font-bold mb-3">Copilot criado com sucesso!</h1>
            <p className="text-muted-foreground text-lg mb-10">
              Seu agente está pronto. Configure o WhatsApp e ative para começar.
            </p>

            <div className="grid gap-4 mb-10">
              <Card className="p-5 text-left border-primary/20 bg-primary/5">
                <div className="flex items-start gap-4">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-primary font-bold text-sm">1</span>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Conectar ao WhatsApp</h3>
                    <p className="text-sm text-muted-foreground">
                      Vincule um número ao seu agente na aba de configurações do Copilot.
                    </p>
                  </div>
                </div>
              </Card>

              <Card className="p-5 text-left border-primary/20 bg-primary/5">
                <div className="flex items-start gap-4">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-primary font-bold text-sm">2</span>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Ativar o agente</h3>
                    <p className="text-sm text-muted-foreground">
                      Ative o agente no painel de Copilots para ele começar a responder automaticamente.
                    </p>
                  </div>
                </div>
              </Card>

              <Card className="p-5 text-left">
                <div className="flex items-start gap-4">
                  <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    <span className="text-muted-foreground font-bold text-sm">3</span>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Monitorar conversas</h3>
                    <p className="text-sm text-muted-foreground">
                      Acompanhe as interações do agente e refine as respostas conforme necessário.
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                variant="outline"
                onClick={() => navigate("/copilot")}
                className="gap-2"
              >
                Ver todos os Copilots
                <ArrowRight className="w-4 h-4" />
              </Button>
              <Button
                onClick={() => navigate(`/copilot/${createdAgentId}/edit`)}
                className="gap-2"
              >
                <Settings className="w-4 h-4" />
                Configurar agente
              </Button>
              <Button
                variant="default"
                className="gap-2 bg-green-600 hover:bg-green-700"
                onClick={() => navigate("/copilot")}
              >
                <Rocket className="w-4 h-4" />
                Ativar agora
              </Button>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  // Fase 2: Wizard config-driven
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-3xl font-bold text-primary mb-2">
            {isEditMode ? `Editar: ${activeConfig.label}` : activeConfig.label}
          </h1>
          <p className="text-muted-foreground">
            {isEditMode
              ? `Editando copilot — ${totalSteps} etapas`
              : `${activeConfig.description} — ${totalSteps} etapas`}
          </p>
        </motion.div>

        {/* Progress + Quality Badge */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              Etapa {currentStep + 1} de {totalSteps}
            </span>
            <div className="flex items-center gap-3">
              <Badge
                variant="outline"
                className={`${getQualityBgColor(quality.level)} ${getQualityColor(quality.level)} border text-xs`}
              >
                {getQualityLabel(quality.level)} ({quality.score}%)
              </Badge>
              <span className="text-sm text-muted-foreground">
                {currentStepData?.title || ""}
              </span>
            </div>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Steps Indicator */}
        <div className="flex justify-between mb-8 overflow-x-auto pb-2">
          {resolvedSteps.map((step, index) => {
            const isAccessible = isEditMode || visitedSteps.has(index);
            return (
              <div key={step.id} className="flex flex-col items-center gap-2">
                <motion.div
                  className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                    isAccessible ? "cursor-pointer" : "cursor-default"
                  } ${
                    index < currentStep
                      ? "bg-primary border-primary text-primary-foreground"
                      : index === currentStep
                      ? "border-primary text-primary"
                      : "border-muted text-muted-foreground"
                  }`}
                  whileHover={{ scale: isAccessible ? 1.1 : 1 }}
                  onClick={() => isAccessible && setCurrentStep(index)}
                  title={isAccessible ? `Ir para: ${step.title}` : undefined}
                >
                  {index < currentStep ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <span className="text-sm font-medium">{index + 1}</span>
                  )}
                </motion.div>
                <span
                  className={`text-xs text-center max-w-[80px] ${
                    index === currentStep
                      ? "text-foreground font-medium"
                      : "text-muted-foreground"
                  }`}
                >
                  {step.title}
                </span>
              </div>
            );
          })}
        </div>

        {/* Form Content */}
        <FormProvider {...methods}>
          <form onSubmit={(e) => e.preventDefault()}>
            <Card className="p-8 mb-4">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${activeConfig.type}-${currentStep}`}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                >
                  {CurrentStepComponent ? (
                    <CurrentStepComponent />
                  ) : (
                    <div className="text-center p-8">
                      <p className="text-muted-foreground">Carregando etapa...</p>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </Card>

            {/* Step Tip */}
            {currentStepData && STEP_TIPS[currentStepData.id] && (
              <div className="mb-6 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 flex items-start gap-3">
                <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-blue-500">
                    {STEP_TIPS[currentStepData.id].title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {STEP_TIPS[currentStepData.id].body}
                  </p>
                </div>
              </div>
            )}

            {/* Navigation Buttons */}
            <div className="flex justify-between">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isSaving}
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancelar
                </Button>
                {currentStep === 0 && !isEditMode ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBackToTemplate}
                    disabled={isSaving}
                  >
                    <ChevronLeft className="w-4 h-4 mr-2" />
                    Trocar Tipo
                  </Button>
                ) : currentStep > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlePrevious}
                    disabled={isSaving}
                  >
                    <ChevronLeft className="w-4 h-4 mr-2" />
                    Anterior
                  </Button>
                ) : null}
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPreviewOpen(true)}
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Preview
                </Button>

                {isLastStep ? (
                  <Button
                    type="button"
                    disabled={isSaving}
                    onClick={() => handleSubmit(onSubmit, (errors) => {
                      const keys = Object.keys(errors);
                      const labels: Record<string, string> = {
                        businessContext: "Contexto do Negócio",
                        objectiveComposite: "Objetivo",
                        examples: "Exemplos",
                        skills: "Habilidades",
                        qualification: "Qualificação",
                        mainObjective: "Objetivo principal",
                        name: "Nome",
                        availability: "Disponibilidade",
                      };
                      const readable = keys.slice(0, 4).map(k => labels[k] || k).join(", ");
                      toast.error("Campos obrigatórios não preenchidos", {
                        description: `Verifique: ${readable}${keys.length > 4 ? " e outros..." : ""}`,
                        duration: 6000,
                      });
                    })()}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {isSaving ? (
                      isEditMode ? "Salvando..." : "Criando..."
                    ) : (
                      <>
                        {isEditMode ? "Salvar Alterações" : "Criar Copilot"}
                        <Check className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={handleNext}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    Próximo
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </Button>
                )}
              </div>
            </div>
          </form>

          {/* Prompt Preview Sheet */}
          <PromptPreviewSheet
            open={previewOpen}
            onOpenChange={setPreviewOpen}
            promptText={previewPrompt}
          />
        </FormProvider>
      </div>
    </div>
  );
}
