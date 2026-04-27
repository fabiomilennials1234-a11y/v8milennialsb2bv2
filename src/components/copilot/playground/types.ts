/**
 * Types para o Copilot Playground
 */

import type { AgentTemplateType, AgentOperationMode, OutboundConfig, ActivationTriggers, AutomationActions } from "@/types/copilot";
import type { BehaviorEnforcement, BehaviorWindow } from "@/components/copilot/BehaviorWindowsEditor";

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
  /** Instrução default autônoma — pre-preenche o campo instruction ao ativar */
  defaultInstruction: string;
}

export interface PlaygroundToolState {
  enabled: boolean;
  config: Record<string, any>;
  /** Instrução livre de quando/como o copilot deve usar esta ferramenta */
  instruction: string;
}

// =====================================================
// KNOWLEDGE BASE
// =====================================================

export type KnowledgeFileType = "document" | "image" | "video";

export interface KnowledgeDocument {
  id: string;
  name: string;
  file?: File;
  size?: number;
  status: "pending" | "uploaded" | "processing" | "ready";
  /** Existing doc from DB */
  existingId?: string;
  filePath?: string;
  /** Media type classification */
  fileType: KnowledgeFileType;
  /** Human description of content (required for media) */
  description?: string;
  /** When should the copilot send this (natural language instruction) */
  sendWhen?: string;
}

export interface KnowledgeLink {
  id: string;
  alias: string;
  url: string;
}

// =====================================================
// PROMPT SECTIONS
// =====================================================

export interface PromptSections {
  /** Quem é o copilot — persona, tom de voz, como age */
  personality: string;
  /** Missão principal, critério de sucesso, limites */
  objective: string;
  /** Fluxo de atendimento/conversa — etapas, como conduzir */
  flow: string;
  /** Catálogo de produtos/serviços — descrição, preço, diferenciais (opcional, sempre preenchido com "" via DEFAULT_PROMPT_SECTIONS) */
  products?: string;
  /** Do's e Don'ts — regras rígidas */
  instructions: string;
}

export const DEFAULT_PROMPT_SECTIONS: PromptSections = {
  personality: "",
  objective: "",
  flow: "",
  products: "",
  instructions: "",
};

// =====================================================
// PLAYGROUND STATE
// =====================================================

export interface PlaygroundData {
  // Identity
  name: string;
  templateType: AgentTemplateType | "";

  // Prompt sections (structured)
  promptSections: PromptSections;

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

  // Time-Aware Behavior (até 6 janelas com comportamento por horário)
  behaviorWindows: BehaviorWindow[];
  behaviorEnforcement: BehaviorEnforcement;

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

export function createDefaultBehaviorWindows(): BehaviorWindow[] {
  return [
    {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `w-${Date.now()}`,
      name: "Horário comercial",
      days: ["mon", "tue", "wed", "thu", "fri"],
      start: "09:00",
      end: "18:00",
      behavior: "",
    },
    {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `w-${Date.now()}-2`,
      name: "Fora de expediente",
      days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      start: "18:00",
      end: "09:00",
      behavior: "",
    },
    {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `w-${Date.now()}-3`,
      name: "Fim de semana",
      days: ["sat", "sun"],
      start: "09:00",
      end: "18:00",
      behavior: "",
    },
  ];
}

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
    promptSections: { ...DEFAULT_PROMPT_SECTIONS },
    llmTemperatureMode: "balanceado",
    responseDelayMs: 1000,
    availability: { ...DEFAULT_AVAILABILITY },
    behaviorWindows: createDefaultBehaviorWindows(),
    behaviorEnforcement: "hard",
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
    defaultInstruction: "Conforme o lead compartilha informacoes durante a conversa (nome, empresa, cargo, necessidade, orcamento, timeline), registre progressivamente — nao espere coletar tudo. Quando os campos obrigatorios estiverem completos, qualifique o lead automaticamente. Se claramente nao se encaixa no perfil ideal, desqualifique com motivo.",
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
    defaultInstruction: "Quando o lead demonstrar interesse claro (pedir preco, perguntar sobre implementacao, querer saber proximos passos), sugira proativamente uma reuniao. Apresente opcoes de horario quando disponiveis. Ao confirmar, agende imediatamente.",
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
    defaultInstruction: "Mova o lead entre etapas do funil automaticamente conforme a conversa progride. Lead respondeu → mover para 'Respondeu'. Lead qualificado → mover para 'Qualificado'. Lead nao responde apos follow-ups → mover para 'Esfriou'. Nao peca permissao — aja conforme o contexto da conversa.",
    parameters: [
      {
        key: "pipe",
        label: "Pipe",
        type: "select",
        options: [
          { value: "whatsapp", label: "Pipe WhatsApp" },
          { value: "confirmacao", label: "Pipe Confirmação" },
          { value: "propostas", label: "Pipe Propostas" },
          { value: "upsell_base", label: "Carteira Base" },
          { value: "upsell_gestao", label: "Carteira Gestão" },
          { value: "campanha", label: "Campanhas" },
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
    defaultInstruction: "Envie follow-up quando o lead parar de responder. Respeite o intervalo minimo configurado. Varie a abordagem entre: valor (compartilhar conteudo relevante), curiosidade (pergunta aberta sobre cenario atual), check-in (verificacao amigavel). Na ultima tentativa, use abordagem de 'breakup'.",
    parameters: [
      { key: "minIntervalHours", label: "Intervalo minimo (horas)", type: "number", placeholder: "24" },
    ],
  },
  {
    id: "TRANSFERIR_HUMANO",
    name: "Transferir para Humano",
    description: "Transfere a conversa para um atendente humano",
    icon: "Headphones",
    defaultInstruction: "Transfira para um humano apenas quando: (1) o lead pedir explicitamente, (2) a duvida for tecnica demais e nao estiver na base de conhecimento, (3) o lead demonstrar frustracao ou a conversa entrar em loop. Antes de transferir, resuma o contexto da conversa para o atendente.",
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
    defaultInstruction: "Quando um contato desconhecido iniciar conversa e fornecer nome e pelo menos um meio de contato (telefone ou email), crie o lead automaticamente. Extraia todas as informacoes disponiveis da conversa para preencher os campos iniciais.",
    parameters: [
      { key: "requiredFields", label: "Campos obrigatorios", type: "text", placeholder: "Ex: Nome, Telefone" },
    ],
  },
  {
    id: "PREENCHER_CAMPOS",
    name: "Preencher Campos do Lead",
    description: "Preenche campos padrao e customizados no card do lead",
    icon: "Database",
    defaultInstruction: "Sempre que o lead mencionar informacoes relevantes (empresa, cargo, segmento, numero de funcionarios, orcamento, ferramenta atual, etc.), preencha o campo correspondente imediatamente. Extraia dados naturalmente da conversa — nao pergunte 'posso salvar isso?'. Se nao existir campo dedicado para a informacao, registre em notas.",
    parameters: [
      { key: "standardFields", label: "Campos padrao a preencher", type: "text", placeholder: "Ex: empresa, segmento, urgencia, faturamento, rating" },
      { key: "customFields", label: "Campos custom a preencher", type: "text", placeholder: "Ex: Orcamento, Ferramenta Atual, Qtd Funcionarios" },
    ],
  },
  {
    id: "CRIAR_CAMPO",
    name: "Criar Campo Personalizado",
    description: "Cria campos customizados no CRM para registrar informacoes novas",
    icon: "FilePlus",
    defaultInstruction: "Quando o lead fornecer informacao relevante para a qual nao existe campo (padrao ou customizado), crie um novo campo personalizado e preencha o valor. Exemplo: se mencionarem 'temos 15 lojas' e nao ha campo para isso, crie 'Numero de Lojas' como numerico e preencha com 15.",
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
    defaultInstruction: "SEMPRE consulte a base de conhecimento antes de responder qualquer pergunta sobre produto, servico, preco ou empresa. Se encontrar documento relevante, envie proativamente. Nunca invente informacoes — se nao encontrar na base, diga que vai verificar com a equipe.",
    parameters: [],
  },
];
