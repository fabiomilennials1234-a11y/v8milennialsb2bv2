/**
 * Types para o Copilot Playground
 */

import type { AgentTemplateType, AgentOperationMode, OutboundConfig, ActivationTriggers, AutomationActions } from "@/types/copilot";

// =====================================================
// TOOL DEFINITIONS
// =====================================================

export interface ToolParameter {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "multi-select";
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export interface PlaygroundToolDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  parameters: ToolParameter[];
}

export interface PlaygroundToolState {
  enabled: boolean;
  config: Record<string, any>;
}

// =====================================================
// KNOWLEDGE BASE
// =====================================================

export interface KnowledgeDocument {
  id: string;
  name: string;
  file?: File;
  size?: number;
  status: "pending" | "uploaded" | "processing" | "ready";
  /** Existing doc from DB */
  existingId?: string;
  filePath?: string;
}

export interface KnowledgeLink {
  id: string;
  alias: string;
  url: string;
}

// =====================================================
// PLAYGROUND STATE
// =====================================================

export interface PlaygroundData {
  // Identity
  name: string;
  templateType: AgentTemplateType | "";

  // Prompt (the core)
  prompt: string;

  // Settings
  llmTemperatureMode: "criativo" | "balanceado" | "preciso";
  responseDelayMs: number;
  availability: {
    mode: "always" | "scheduled";
    timezone: string;
    days: string[];
    start: string;
    end: string;
  };

  // Proactive agent
  isProactive: boolean;
  operationMode: AgentOperationMode;
  activationTriggers: ActivationTriggers;
  outboundConfig: OutboundConfig;
  audioEnabled: boolean;
  audioSendOrder: "text_first" | "audio_first";

  // Tools
  tools: Record<string, PlaygroundToolState>;

  // Knowledge
  documents: KnowledgeDocument[];
  links: KnowledgeLink[];

  // Existing agent ID (edit mode)
  agentId?: string;
}

// =====================================================
// MENTION TYPES (for @autocomplete)
// =====================================================

export type MentionType = "tool" | "document" | "link";

export interface MentionItem {
  type: MentionType;
  id: string;
  label: string;
  icon?: string;
}

// =====================================================
// DEFAULTS
// =====================================================

export const DEFAULT_AVAILABILITY = {
  mode: "always" as const,
  timezone: "America/Sao_Paulo",
  days: ["mon", "tue", "wed", "thu", "fri"],
  start: "09:00",
  end: "18:00",
};

export const DEFAULT_ACTIVATION_TRIGGERS: ActivationTriggers = {
  required: { tags: [], origins: [], hasPhone: true, hasEmail: false },
  optional: [],
};

export const DEFAULT_OUTBOUND_CONFIG: OutboundConfig = {
  delayMinutes: 5,
  firstMessageTemplate: "",
  availableVariables: ["nome", "empresa", "email", "telefone", "origem", "interesse", "segmento", "campanha"],
  maxRetries: 3,
  retryIntervalMinutes: 30,
  audioEnabled: false,
  audioSendOrder: "text_first",
};

export function createDefaultPlaygroundData(): PlaygroundData {
  return {
    name: "",
    templateType: "",
    prompt: "",
    llmTemperatureMode: "balanceado",
    responseDelayMs: 1000,
    availability: { ...DEFAULT_AVAILABILITY },
    isProactive: false,
    operationMode: "inbound",
    activationTriggers: { ...DEFAULT_ACTIVATION_TRIGGERS, required: { ...DEFAULT_ACTIVATION_TRIGGERS.required } },
    outboundConfig: { ...DEFAULT_OUTBOUND_CONFIG },
    audioEnabled: false,
    audioSendOrder: "text_first",
    tools: {},
    documents: [],
    links: [],
  };
}

// =====================================================
// TOOL REGISTRY
// =====================================================

export const PLAYGROUND_TOOLS: PlaygroundToolDef[] = [
  {
    id: "QUALIFICAR_LEAD",
    name: "Qualificar Lead",
    description: "Qualifica o lead com campos obrigatorios e opcionais",
    icon: "UserCheck",
    parameters: [
      { key: "requiredFields", label: "Campos obrigatorios", type: "text", placeholder: "Ex: Nome, Empresa, Cargo" },
      { key: "optionalFields", label: "Campos opcionais", type: "text", placeholder: "Ex: Orcamento, Timeline" },
    ],
  },
  {
    id: "AGENDAR_REUNIAO",
    name: "Agendar Reuniao",
    description: "Agenda reuniao com o lead",
    icon: "Calendar",
    parameters: [
      { key: "schedulingLink", label: "Link de agendamento", type: "text", placeholder: "https://calendly.com/..." },
      { key: "instructions", label: "Instrucoes", type: "text", placeholder: "Ex: Verificar disponibilidade antes" },
    ],
  },
  {
    id: "MOVER_CARD",
    name: "Mover Card",
    description: "Move o lead para outra etapa do funil",
    icon: "ArrowRightLeft",
    parameters: [
      {
        key: "pipe",
        label: "Pipe",
        type: "select",
        options: [
          { value: "whatsapp", label: "Pipe WhatsApp" },
          { value: "confirmacao", label: "Pipe Confirmacao" },
          { value: "propostas", label: "Pipe Propostas" },
        ],
      },
      { key: "stages", label: "Etapas disponiveis", type: "text", placeholder: "Ex: novo, abordado, respondeu" },
    ],
  },
  {
    id: "ENVIAR_FOLLOWUP",
    name: "Enviar Follow-up",
    description: "Envia mensagem de follow-up ao lead",
    icon: "MessageSquare",
    parameters: [
      { key: "minIntervalHours", label: "Intervalo minimo (horas)", type: "number", placeholder: "24" },
    ],
  },
  {
    id: "TRANSFERIR_HUMANO",
    name: "Transferir para Humano",
    description: "Transfere a conversa para um atendente humano",
    icon: "Headphones",
    parameters: [
      { key: "transferMessage", label: "Mensagem de transferencia", type: "text", placeholder: "Ex: Vou transferir voce..." },
      { key: "targetUser", label: "Para quem", type: "text", placeholder: "Ex: Equipe de vendas" },
    ],
  },
  {
    id: "CRIAR_LEAD",
    name: "Criar Lead",
    description: "Cria um novo lead no sistema",
    icon: "UserPlus",
    parameters: [
      { key: "requiredFields", label: "Campos obrigatorios", type: "text", placeholder: "Ex: Nome, Telefone" },
    ],
  },
  {
    id: "PREENCHER_CAMPOS",
    name: "Preencher Campos do Lead",
    description: "Preenche campos padrao (empresa, segmento, urgencia, faturamento, rating) e campos customizados no card do lead. Informacoes sem campo dedicado vao para notas.",
    icon: "Database",
    parameters: [
      { key: "standardFields", label: "Campos padrao a preencher", type: "text", placeholder: "Ex: empresa, segmento, urgencia, faturamento, rating" },
      { key: "customFields", label: "Campos custom a preencher", type: "text", placeholder: "Ex: Orcamento, Ferramenta Atual, Qtd Funcionarios" },
    ],
  },
  {
    id: "CRIAR_CAMPO",
    name: "Criar Campo Personalizado",
    description: "Cria um novo campo customizado no CRM quando precisa registrar informacao que nao tem campo dedicado. Pode ja preencher o valor no lead atual.",
    icon: "FilePlus",
    parameters: [
      {
        key: "defaultFieldType",
        label: "Tipo padrao dos campos criados",
        type: "select",
        options: [
          { value: "text", label: "Texto livre" },
          { value: "number", label: "Numerico" },
          { value: "date", label: "Data" },
          { value: "select", label: "Opcoes (select)" },
          { value: "boolean", label: "Sim/Nao" },
        ],
      },
    ],
  },
  {
    id: "RESPONDER_FAQ",
    name: "Responder FAQ",
    description: "Busca respostas na base de conhecimento",
    icon: "HelpCircle",
    parameters: [],
  },
];
