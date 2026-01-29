/**
 * Wizard Multi-Step para Criação de Copilot Agent
 *
 * Fluxo de 8 etapas para configurar um agente de IA personalizado:
 * 1. Template, 2. Nome, 3. Personalidade, 4. Habilidades,
 * 5. Tópicos Permitidos, 6. Tópicos Proibidos, 7. FAQs, 8. Objetivo
 */

import { useState, useEffect, useMemo } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useCreateCopilotAgent } from "@/hooks/useCopilotAgents";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { CopilotWizardData } from "@/types/copilot";

// Importar steps
import { TemplateStep } from "./wizard-steps/TemplateStep";
import { NameStep } from "./wizard-steps/NameStep";
import { PersonalityStep } from "./wizard-steps/PersonalityStep";
import { SkillsStep } from "./wizard-steps/SkillsStep";
import { AllowedTopicsStep } from "./wizard-steps/AllowedTopicsStep";
import { ForbiddenTopicsStep } from "./wizard-steps/ForbiddenTopicsStep";
import { FaqStep } from "./wizard-steps/FaqStep";
import { BusinessContextStep } from "./wizard-steps/BusinessContextStep";
import { ConversationStyleStep } from "./wizard-steps/ConversationStyleStep";
import { QualificationStep } from "./wizard-steps/QualificationStep";
import { ExamplesStep } from "./wizard-steps/ExamplesStep";
import { AvailabilityStep } from "./wizard-steps/AvailabilityStep";
import { ObjectiveStep } from "./wizard-steps/ObjectiveStep";
import { OperationModeStep } from "./wizard-steps/OperationModeStep";
import { ActivationTriggersStep } from "./wizard-steps/ActivationTriggersStep";
import { OutboundConfigStep } from "./wizard-steps/OutboundConfigStep";
import { AutomationActionsStep } from "./wizard-steps/AutomationActionsStep";
import { FollowupRulesStep } from "./wizard-steps/FollowupRulesStep";

// Schema de validação
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
    productSummary: z.string().min(10, "Descreva o produto/serviço"),
    idealCustomerProfile: z.string().min(10, "Descreva o ICP"),
    serviceRegion: z.string().optional().or(z.literal("")),
    valueProps: z.string().min(10, "Informe os diferenciais principais"),
    customerPains: z.string().min(10, "Informe as dores que resolve"),
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
  ).min(1, "Adicione pelo menos 1 exemplo"),
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
  kanbanRules: z.array(z.any()),
  followupRules: z.array(z.any()).optional().default([]),
  // Outbound / BDR
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
  }),
  automationActions: z.object({
    onQualify: z.object({
      moveToStage: z.string().optional().or(z.literal("")),
      addTags: z.array(z.string()),
      notifyUserId: z.string().nullable(),
      sendMessage: z.boolean(),
      messageTemplate: z.string().optional().or(z.literal("")),
    }).refine(
      (data) => {
        // Se sendMessage é false, não precisa validar messageTemplate
        if (!data.sendMessage) return true;
        // Se sendMessage é true, messageTemplate deve existir e não estar vazio
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

const STEPS = [
  { number: 1, title: "Template", component: TemplateStep },
  { number: 2, title: "Nome", component: NameStep },
  { number: 3, title: "Personalidade", component: PersonalityStep },
  { number: 4, title: "Habilidades", component: SkillsStep },
  { number: 5, title: "Permitidos", component: AllowedTopicsStep },
  { number: 6, title: "Proibidos", component: ForbiddenTopicsStep },
  { number: 7, title: "FAQs", component: FaqStep },
  { number: 8, title: "Negócio", component: BusinessContextStep },
  { number: 9, title: "Estilo", component: ConversationStyleStep },
  { number: 10, title: "Qualificação", component: QualificationStep },
  { number: 11, title: "Exemplos", component: ExamplesStep },
  { number: 12, title: "Disponibilidade", component: AvailabilityStep },
  { number: 13, title: "Objetivo", component: ObjectiveStep },
  { number: 14, title: "Modo BDR", component: OperationModeStep },
  { number: 15, title: "Gatilhos", component: ActivationTriggersStep },
  { number: 16, title: "Outbound", component: OutboundConfigStep },
  { number: 17, title: "Ações", component: AutomationActionsStep },
  { number: 18, title: "Follow-up", component: FollowupRulesStep },
];

export function CopilotWizard() {
  const [currentStep, setCurrentStep] = useState(0);
  const navigate = useNavigate();
  const createAgent = useCreateCopilotAgent();

  const methods = useForm<CopilotWizardData>({
    resolver: zodResolver(wizardSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: {
      templateType: "",
      name: "",
      personality: {
        tone: "profissional",
        style: "consultivo",
        energy: "moderada",
      },
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
        requiredFields: [
          "Necessidade / Dor principal",
          "Volume / Escopo",
          "Urgência / Prazo",
        ],
        optionalFields: [],
        notes: "",
      },
      examples: [{ lead: "", agent: "" }],
      availability: {
        mode: "always",
        timezone: "America/Sao_Paulo",
        days: ["mon", "tue", "wed", "thu", "fri"],
        start: "09:00",
        end: "18:00",
      },
      responseDelaySeconds: 0,
      mainObjective: "",
      kanbanRules: [],
      followupRules: [],
      // Outbound / BDR defaults
      operationMode: "inbound",
      activationTriggers: {
        required: {
          tags: [],
          origins: [],
          hasPhone: true,
          hasEmail: false,
        },
        optional: [],
      },
      outboundConfig: {
        delayMinutes: 5,
        firstMessageTemplate: "Oi {nome}! 👋 Vi que você demonstrou interesse em {interesse}. O que mais te chamou atenção?",
        availableVariables: ["nome", "empresa", "email", "telefone", "origem", "interesse", "segmento", "campanha"],
        maxRetries: 3,
        retryIntervalMinutes: 30,
      },
      automationActions: {
        onQualify: {
          moveToStage: "agendado",
          addTags: ["qualificado"],
          notifyUserId: null,
          sendMessage: false,
          messageTemplate: "",
        },
        onDisqualify: {
          moveToStage: "descartado",
          addTags: ["sem_fit"],
          notifyUserId: null,
          sendMessage: true,
          messageTemplate: "Entendo! Caso mude de ideia no futuro, estamos à disposição. Tenha um ótimo dia!",
        },
        onNeedHuman: {
          moveToStage: "aguardando_humano",
          addTags: ["precisa_humano"],
          notifyUserId: null,
          sendMessage: true,
          messageTemplate: "Um momento, vou transferir você para um de nossos especialistas.",
        },
      },
    },
  });

  const { handleSubmit, trigger, formState, getValues, watch } = methods;
  
  // Observar operationMode e templateType para filtrar steps
  const operationMode = watch("operationMode");
  const templateType = watch("templateType");
  
  // Filtrar steps: remover Outbound se inbound; adicionar Follow-up só quando template for "followup"
  const filteredSteps = useMemo(() => {
    let steps = operationMode === "inbound"
      ? STEPS.filter(step => step.number !== 16 && step.number !== 18)
      : STEPS.filter(step => step.number !== 18);
    if (templateType === "followup") {
      steps = [...steps, { number: 18, title: "Follow-up", component: FollowupRulesStep }];
    }
    return steps;
  }, [operationMode, templateType]);
  
  // Ajustar currentStep se a lista de steps mudar e o step atual não existir mais (ex.: troca de template/inbound)
  useEffect(() => {
    if (filteredSteps[currentStep] === undefined) {
      setCurrentStep(prev => Math.min(Math.max(0, prev - 1), filteredSteps.length - 1));
    }
  }, [templateType, operationMode, currentStep, filteredSteps]);
  
  const progress = ((currentStep + 1) / filteredSteps.length) * 100;
  const CurrentStepComponent = filteredSteps[currentStep]?.component;
  const isLastStep = currentStep === filteredSteps.length - 1;

  // Validar todos os campos quando chegar no último step
  useEffect(() => {
    if (isLastStep) {
      // Validar todos os campos para atualizar formState.isValid
      // Usar setTimeout para evitar validação durante renderização
      const timer = setTimeout(() => {
        trigger().catch((err) => {
          console.error("Erro na validação:", err);
        });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isLastStep]); // Remover trigger das dependências para evitar loop

  const handleNext = async () => {
    // Validar apenas os campos do step atual antes de avançar.
    // Usar step.number (1–17) para identificar o step, pois filteredSteps pode ter step 16 removido (inbound).
    const currentStepData = filteredSteps[currentStep];
    const stepNumber = currentStepData?.number ?? currentStep + 1;
    
    let fieldToValidate: keyof CopilotWizardData | (keyof CopilotWizardData)[] = [];
    
    switch (stepNumber) {
      case 1: // Template
        fieldToValidate = "templateType";
        break;
      case 2: // Nome
        fieldToValidate = "name";
        break;
      case 3: // Personalidade
        fieldToValidate = "personality";
        break;
      case 4: // Habilidades
        fieldToValidate = "skills";
        break;
      case 5: // Tópicos Permitidos
        fieldToValidate = "allowedTopics";
        break;
      case 6: // Tópicos Proibidos
        fieldToValidate = "forbiddenTopics";
        break;
      case 7: // FAQs
        fieldToValidate = "faqs";
        break;
      case 8: // Negócio
        fieldToValidate = "businessContext";
        break;
      case 9: // Estilo
        fieldToValidate = "conversationStyle";
        break;
      case 10: // Qualificação
        fieldToValidate = "qualification";
        break;
      case 11: // Exemplos
        fieldToValidate = "examples";
        break;
      case 12: // Disponibilidade
        fieldToValidate = "availability";
        break;
      case 13: // Objetivo
        fieldToValidate = "mainObjective";
        break;
      case 14: // Modo BDR
        fieldToValidate = "operationMode";
        break;
      case 15: // Gatilhos
        fieldToValidate = "activationTriggers";
        break;
      case 16: // Outbound (só existe quando operationMode !== "inbound")
        fieldToValidate = "outboundConfig";
        break;
      case 17: // Ações Automáticas
        fieldToValidate = "automationActions";
        break;
      case 18: // Follow-up (só quando templateType === "followup")
        fieldToValidate = "followupRules";
        break;
      default:
        fieldToValidate = [];
    }
    
    console.log("🔍 Validando step", currentStep, "campo:", fieldToValidate);
    
    // Validar o campo específico
    const isValid = await trigger(fieldToValidate as any);
    
    console.log("✅ Resultado da validação:", {
      isValid,
      fieldValue: getValues(fieldToValidate as any),
      errors: formState.errors[fieldToValidate as keyof typeof formState.errors],
    });
    
    if (isValid && currentStep < filteredSteps.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      // Log para debug
      console.error("❌ Validação falhou no step", currentStep, {
        fieldToValidate,
        fieldValue: getValues(fieldToValidate as any),
        errors: formState.errors,
      });
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleCancel = () => {
    navigate("/copilot");
  };

  const onSubmit = async (data: CopilotWizardData) => {
    try {
      // Validar todos os campos antes de submeter
      const isValid = await trigger();
      if (!isValid) {
        console.error("❌ Formulário inválido:", formState.errors);
        
        // Mostrar erros de validação ao usuário
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

      console.log("✅ Todos os campos válidos, criando agente...");
      
      // Preparar payload do agente, removendo campos undefined/null que podem causar erro
      const agentPayload: any = {
        name: data.name,
        template_type: data.templateType,
        personality_tone: data.personality.tone,
        personality_style: data.personality.style,
        personality_energy: data.personality.energy,
        skills: data.skills || [],
        allowed_topics: data.allowedTopics || [],
        forbidden_topics: data.forbiddenTopics || [],
        main_objective: data.mainObjective,
        business_context: data.businessContext || {},
        conversation_style: data.conversationStyle || {},
        qualification_rules: data.qualification || {},
        few_shot_examples: data.examples || [],
        availability: data.availability || {},
        response_delay_seconds: data.responseDelaySeconds ?? 0,
        is_active: false,
        // Outbound / BDR - apenas adicionar se existirem
        operation_mode: data.operationMode || 'inbound',
      };

      // Adicionar campos opcionais apenas se existirem e não forem undefined
      if (data.activationTriggers) {
        agentPayload.activation_triggers = data.activationTriggers;
      }
      // Outbound config só se operationMode for "outbound" ou "hybrid"
      if (data.operationMode && (data.operationMode === "outbound" || data.operationMode === "hybrid")) {
        if (data.outboundConfig) {
          agentPayload.outbound_config = data.outboundConfig;
        }
      } else {
        // Se for "inbound", não enviar outboundConfig
        agentPayload.outbound_config = null;
      }
      if (data.automationActions) {
        agentPayload.automation_actions = data.automationActions;
      }

      console.log("📦 Payload do agente:", JSON.stringify(agentPayload, null, 2));
      
      await createAgent.mutateAsync({
        agent: agentPayload,
        faqs: data.faqs || [],
        kanbanRules: data.kanbanRules || [],
        followupRules: data.followupRules || [],
      });

      console.log("✅ Agente criado com sucesso, redirecionando...");
      
      // Usar setTimeout para garantir que o toast seja exibido antes do redirect
      setTimeout(() => {
        try {
          navigate("/copilot");
        } catch (navError) {
          console.error("❌ Erro ao navegar:", navError);
          // Se o navigate falhar, recarregar a página
          window.location.href = "/copilot";
        }
      }, 500);
    } catch (error: any) {
      console.error("❌ Erro ao criar agente:", error);
      
      // Extrair mensagem de erro mais detalhada
      let errorMessage = "Erro desconhecido ao criar o agente";
      
      if (error?.message) {
        errorMessage = error.message;
      } else if (error?.error?.message) {
        errorMessage = error.error.message;
      } else if (error?.error?.hint) {
        errorMessage = `${error.error.message || "Erro no banco de dados"}: ${error.error.hint}`;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      
      // Se for erro de coluna não encontrada, dar instrução específica
      if (errorMessage.includes("activation_triggers") || errorMessage.includes("column")) {
        errorMessage = "Coluna não encontrada no banco. Execute a migration: 20260127200000_fix_copilot_agents_columns.sql";
      }
      
      toast.error("Erro ao criar Copilot", {
        description: errorMessage,
        duration: 10000,
      });
      
      // Log completo do erro para debug
      console.error("❌ Detalhes completos do erro:", {
        error,
        message: error?.message,
        errorObject: error?.error,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
      });
      
      if (error?.stack) {
        console.error("Stack trace:", error.stack);
      }
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-3xl font-bold text-millennials-yellow mb-2">
            Criar Novo Copilot
          </h1>
          <p className="text-muted-foreground">
            Configure seu agente de IA personalizado em {filteredSteps.length} etapas
            simples
          </p>
        </motion.div>

        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              Etapa {currentStep + 1} de {filteredSteps.length}
            </span>
            <span className="text-sm text-muted-foreground">
              {filteredSteps[currentStep]?.title || ""}
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Steps Indicator */}
        <div className="flex justify-between mb-8 overflow-x-auto pb-2">
          {filteredSteps.map((step, index) => (
            <div key={step.number} className="flex flex-col items-center gap-2">
              <motion.div
                className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                  index < currentStep
                    ? "bg-millennials-yellow border-millennials-yellow text-black"
                    : index === currentStep
                    ? "border-millennials-yellow text-millennials-yellow"
                    : "border-muted text-muted-foreground"
                }`}
                whileHover={{ scale: 1.1 }}
              >
                {index < currentStep ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <span className="text-sm font-medium">{step.number}</span>
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
          ))}
        </div>

        {/* Form Content */}
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit)}>
            <Card className="p-8 mb-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentStep}
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

            {/* Navigation Buttons */}
            <div className="flex justify-between">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={createAgent.isPending}
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancelar
                </Button>
                {currentStep > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlePrevious}
                    disabled={createAgent.isPending}
                  >
                    <ChevronLeft className="w-4 h-4 mr-2" />
                    Anterior
                  </Button>
                )}
              </div>

              {isLastStep ? (
                <Button
                  type="submit"
                  disabled={createAgent.isPending}
                  className="bg-millennials-yellow hover:bg-millennials-yellow/90 text-black"
                >
                  {createAgent.isPending ? (
                    "Criando..."
                  ) : (
                    <>
                      Criar Copilot
                      <Check className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={handleNext}
                  className="bg-millennials-yellow hover:bg-millennials-yellow/90 text-black"
                >
                  Próximo
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              )}
            </div>
          </form>
        </FormProvider>
      </div>
    </div>
  );
}
