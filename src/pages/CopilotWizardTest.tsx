/**
 * Página de teste visual para os componentes do wizard refatorado.
 * Rota: /copilot/teste-wizard
 *
 * Renderiza cada step isoladamente com dados mock para verificação rápida.
 * REMOVER ANTES DO DEPLOY EM PRODUÇÃO.
 */

import { useState } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PersonaTomStep } from "@/components/copilot/wizard-steps/PersonaTomStep";
import { ObjectiveInstructionsStep } from "@/components/copilot/wizard-steps/ObjectiveInstructionsStep";
import { RulesLimitsStep } from "@/components/copilot/wizard-steps/RulesLimitsStep";
import { KanbanRulesReviewStep } from "@/components/copilot/wizard-steps/KanbanRulesReviewStep";
import { ExamplesStep } from "@/components/copilot/wizard-steps/ExamplesStep";
import type { CopilotWizardData } from "@/types/copilot";
import { FlaskConical } from "lucide-react";

const MOCK_DEFAULTS: Partial<CopilotWizardData> = {
  templateType: "sdr",
  name: "SDR Teste",
  businessContext: {
    companyName: "V8 Millennials",
    productSummary:
      "Plataforma de CRM e automação de vendas B2B com IA para WhatsApp, incluindo copilots inteligentes, kanban de vendas e métricas.",
    idealCustomerProfile:
      "Empresas B2B com equipe de vendas de 5+ pessoas que usam WhatsApp como canal principal.",
    valueProps:
      "Automação inteligente de follow-ups, qualificação automática por IA, integração nativa com WhatsApp.",
    customerPains:
      "Leads esfriando por falta de follow-up, vendedores sobrecarregados, sem visibilidade do funil.",
  },
  personaDescription:
    "Sou a Ana, consultora da V8 Millennials. Falo de forma casual mas profissional, uso emojis com moderação. Sou direta e objetiva, mas sempre empática. Nunca pressiono o lead, prefiro criar curiosidade.",
  skillsAndTopics:
    "Posso falar sobre: funcionalidades do CRM, automação de WhatsApp, copilots de IA, métricas de vendas, integração com ferramentas.\n\nNão posso falar sobre: preços (direcionar para consultor), contratos, informações técnicas de infraestrutura, concorrentes.",
  objectiveComposite: {
    mission:
      "Qualificar leads inbound identificando budget, autoridade, necessidade e timeline (BANT).",
    success_criteria:
      "Lead qualificado com reunião agendada. Meta: 40% dos leads qualificados devem agendar.",
  },
  customInstructions: {
    dos: "Fazer perguntas abertas para entender a dor do cliente. Sempre confirmar o nome do lead. Oferecer material relevante quando fizer sentido.",
    donts:
      "Nunca falar preço sem antes qualificar. Não insistir após 2 recusas claras. Não enviar áudios longos.",
  },
  personality: { tone: "casual", style: "consultivo", energy: "moderada" },
  kanbanRules: [
    {
      pipeType: "whatsapp",
      stageName: "novo",
      goal: "Criar rapport e gerar interesse inicial no produto/serviço.",
      behavior:
        "Seja amigável e direto. Faça 1 pergunta por mensagem. Não envie textão.",
      allowedActions: ["update_lead"],
      forbiddenActions: ["schedule_meeting"],
    },
    {
      pipeType: "whatsapp",
      stageName: "abordado",
      goal: "Aprofundar interesse e identificar dor do lead.",
      behavior:
        "Use perguntas abertas para entender necessidade. Compartilhe case relevante.",
      allowedActions: ["update_lead"],
      forbiddenActions: ["schedule_meeting"],
    },
    {
      pipeType: "whatsapp",
      stageName: "respondeu",
      goal: "Converter interesse em reunião agendada.",
      behavior:
        "Proponha call/reunião quando perceber fit. Ofereça horários específicos.",
      allowedActions: ["schedule_meeting", "update_lead", "transfer_to_human"],
      forbiddenActions: [],
    },
  ],
  examples: [
    {
      lead: "Oi, vi o anúncio de vocês. Como funciona?",
      agent:
        "Oi! Que bom que chegou até nós! A V8 é uma plataforma que automatiza seu funil de vendas pelo WhatsApp com IA. Qual o tamanho da sua equipe de vendas hoje?",
    },
  ],
  canQualifyLead: true,
  canScheduleMeeting: true,
  canSendFollowup: true,
  canCreateLead: false,
  canMoveCards: false,
  canTransferHuman: true,
  maxConversationTurns: 20,
  hideAiIdentity: false,
  responseDelaySeconds: 8,
  availability: {
    mode: "always" as const,
    days: ["seg", "ter", "qua", "qui", "sex"],
    start: "08:00",
    end: "18:00",
  },
  operationMode: "inbound",
  faqs: [],
  followupRules: [],
  attendUnknownContacts: false,
  activationTriggers: {
    onNewLead: true,
    onStageChange: false,
    onTagAdded: false,
    triggerTags: [],
    triggerStages: [],
  },
  outboundConfig: {
    delayMinutes: 3,
    firstMessageTemplate: "",
    availableVariables: [],
    maxRetries: 2,
    retryIntervalMinutes: 60,
    audioEnabled: false,
    audioSendOrder: "text_first" as const,
  },
  automationActions: {
    onQualify: {
      moveToStage: "respondeu",
      moveToPipe: null,
      addTags: ["qualificado"],
      notifyUserId: null,
      sendMessage: false,
      messageTemplate: "",
    },
    onDisqualify: {
      moveToStage: "esfriou",
      moveToPipe: null,
      addTags: ["desqualificado"],
      notifyUserId: null,
      sendMessage: true,
      messageTemplate: "Obrigado pelo interesse!",
    },
    onNeedHuman: {
      moveToStage: "respondeu",
      moveToPipe: null,
      addTags: ["precisa_humano"],
      notifyUserId: null,
      sendMessage: true,
      messageTemplate: "Vou te transferir para um especialista.",
    },
  },
  mainObjective: "",
  knowledgeBaseFiles: [],
  llmTemperatureMode: "balanceado" as const,
};

type StepKey =
  | "personaTom"
  | "objectiveInstructions"
  | "rulesLimits"
  | "kanbanRules"
  | "examples";

const STEPS: { key: StepKey; label: string; description: string }[] = [
  {
    key: "personaTom",
    label: "Persona e Tom de Voz",
    description: "Campo livre para definir a personalidade do agente",
  },
  {
    key: "objectiveInstructions",
    label: "Objetivo e Instruções",
    description: "Missão + Do's/Don'ts + Critérios de Sucesso",
  },
  {
    key: "rulesLimits",
    label: "Regras e Limites",
    description: "Habilidades/tópicos + capacidades + turnos",
  },
  {
    key: "kanbanRules",
    label: "Kanban Rules (Multi-funil)",
    description: "Seletor de funis + regras por etapa",
  },
  {
    key: "examples",
    label: "Exemplos de Conversa",
    description: "Few-shot examples + geração com IA",
  },
];

const STEP_COMPONENTS: Record<StepKey, React.ComponentType> = {
  personaTom: PersonaTomStep,
  objectiveInstructions: ObjectiveInstructionsStep,
  rulesLimits: RulesLimitsStep,
  kanbanRules: KanbanRulesReviewStep,
  examples: ExamplesStep,
};

export default function CopilotWizardTest() {
  const [activeStep, setActiveStep] = useState<StepKey>("personaTom");
  const [showFormState, setShowFormState] = useState(false);

  const methods = useForm<CopilotWizardData>({
    defaultValues: MOCK_DEFAULTS as CopilotWizardData,
  });

  const ActiveComponent = STEP_COMPONENTS[activeStep];
  const formValues = methods.watch();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <FlaskConical className="w-8 h-8 text-primary" />
              Teste do Wizard v3
            </h1>
            <p className="text-muted-foreground mt-1">
              Mockup visual para verificar os componentes refatorados do wizard.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFormState(!showFormState)}
            >
              {showFormState ? "Ocultar" : "Ver"} Form State
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => methods.reset(MOCK_DEFAULTS as CopilotWizardData)}
            >
              Reset Mock
            </Button>
          </div>
        </div>

        <Separator />

        {/* Step selector */}
        <div className="flex flex-wrap gap-2">
          {STEPS.map((step) => (
            <button
              key={step.key}
              type="button"
              onClick={() => setActiveStep(step.key)}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                activeStep === step.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-input hover:bg-muted/50"
              }`}
            >
              {step.label}
            </button>
          ))}
        </div>

        {/* Active step info */}
        <div className="flex items-center gap-2">
          <Badge variant="outline">{activeStep}</Badge>
          <span className="text-sm text-muted-foreground">
            {STEPS.find((s) => s.key === activeStep)?.description}
          </span>
        </div>

        {/* Step component */}
        <FormProvider {...methods}>
          <form onSubmit={(e) => e.preventDefault()}>
            <Card>
              <CardContent className="pt-6">
                <ActiveComponent />
              </CardContent>
            </Card>
          </form>
        </FormProvider>

        {/* Form state viewer */}
        {showFormState && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                Form State (campos relevantes)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs bg-muted p-4 rounded-lg overflow-auto max-h-96">
                {JSON.stringify(
                  {
                    personaDescription: formValues.personaDescription,
                    skillsAndTopics: formValues.skillsAndTopics,
                    objectiveComposite: formValues.objectiveComposite,
                    customInstructions: formValues.customInstructions,
                    kanbanRules: formValues.kanbanRules,
                    examples: formValues.examples,
                    canQualifyLead: formValues.canQualifyLead,
                    canScheduleMeeting: formValues.canScheduleMeeting,
                    canSendFollowup: formValues.canSendFollowup,
                    canCreateLead: formValues.canCreateLead,
                    canMoveCards: formValues.canMoveCards,
                    canTransferHuman: formValues.canTransferHuman,
                    maxConversationTurns: formValues.maxConversationTurns,
                    hideAiIdentity: formValues.hideAiIdentity,
                    responseDelaySeconds: formValues.responseDelaySeconds,
                    availability: formValues.availability,
                  },
                  null,
                  2
                )}
              </pre>
            </CardContent>
          </Card>
        )}

        {/* Checklist */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Checklist de Verificação</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <CheckItem label="PersonaTomStep: textarea renderiza e salva" />
              <CheckItem label="PersonaTomStep: config técnica (delay, disponibilidade) colapsável" />
              <CheckItem label="ObjectiveInstructionsStep: 4 textareas (missão, dos, donts, critérios)" />
              <CheckItem label="ObjectiveInstructionsStep: tip de prioridade nos don'ts" />
              <CheckItem label="RulesLimitsStep: textarea de habilidades/tópicos" />
              <CheckItem label="RulesLimitsStep: 6 toggles de capacidades" />
              <CheckItem label="RulesLimitsStep: campo de máximo de turnos" />
              <CheckItem label="KanbanRules: seletor multi-funil (5 opções)" />
              <CheckItem label="KanbanRules: whatsapp pré-selecionado com 3 regras" />
              <CheckItem label="KanbanRules: adicionar outro funil carrega etapas reais" />
              <CheckItem label="KanbanRules: seções colapsáveis por funil" />
              <CheckItem label="KanbanRules: toggle ativo/inativo por etapa" />
              <CheckItem label="KanbanRules: editar goal/behavior persiste no form" />
              <CheckItem label="ExamplesStep: botão 'Gerar com IA' visível" />
              <CheckItem label="ExamplesStep: dialog com seletor de quantidade" />
              <CheckItem label="ExamplesStep: adicionar/remover exemplos manual" />
              <CheckItem label="Form State: dados atualizam em tempo real" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CheckItem({ label }: { label: string }) {
  const [checked, setChecked] = useState(false);

  return (
    <label className="flex items-start gap-2 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => setChecked(e.target.checked)}
        className="mt-0.5 w-4 h-4 rounded"
      />
      <span
        className={`${
          checked
            ? "line-through text-muted-foreground"
            : "group-hover:text-primary"
        } transition-colors`}
      >
        {label}
      </span>
    </label>
  );
}
