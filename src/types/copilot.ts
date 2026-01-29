/**
 * Types e Interfaces para Feature Copilot - Agentes de IA
 *
 * Este arquivo define todos os tipos TypeScript usados no sistema Copilot.
 * Integra com os types auto-gerados do Supabase.
 */

import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

// =====================================================
// BASE TYPES DO SUPABASE
// =====================================================

export type CopilotAgent = Tables<"copilot_agents">;
export type CopilotAgentInsert = TablesInsert<"copilot_agents">;
export type CopilotAgentUpdate = TablesUpdate<"copilot_agents">;

export type CopilotAgentFaq = Tables<"copilot_agent_faqs">;
export type CopilotAgentFaqInsert = TablesInsert<"copilot_agent_faqs">;

export type CopilotAgentKanbanRule = Tables<"copilot_agent_kanban_rules">;
export type CopilotAgentKanbanRuleInsert = TablesInsert<"copilot_agent_kanban_rules">;

// =====================================================
// ENUMS
// =====================================================

export type AgentTemplateType =
  | "qualificador"
  | "sdr"
  | "followup"
  | "agendador"
  | "prospectador"
  | "custom";

export type AgentTone =
  | "formal"
  | "casual"
  | "profissional"
  | "amigavel"
  | "energetico"
  | "consultivo";

export type AgentStyle =
  | "direto"
  | "detalhado"
  | "consultivo"
  | "persuasivo"
  | "educativo";

export type AgentEnergy = "baixa" | "moderada" | "alta" | "muito_alta";

export type AgentResponseLength = "curto" | "medio" | "detalhado";
export type AgentEmojiPolicy = "nunca" | "raro" | "moderado";
export type AgentAvailabilityMode = "always" | "scheduled";
export type AgentOperationMode = "inbound" | "outbound" | "hybrid";
export type TriggerOperator = "=" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "not_contains";

// Tipos para Follow-up Rules
export type FollowupTriggerType = "no_response" | "scheduled" | "event";
export type FollowupStyle = "direct" | "value" | "curiosity" | "breakup";
export type LeadTemperature = "cold" | "warm" | "hot";

// =====================================================
// WIZARD FORM DATA
// =====================================================

/**
 * Estrutura de dados do Wizard de criação de agente
 * Usado com React Hook Form para gerenciar o estado multi-step
 */
export interface CopilotWizardData {
  // Step 1: Template
  templateType: AgentTemplateType;

  // Step 2: Name
  name: string;

  // Step 3: Personality
  personality: {
    tone: AgentTone;
    style: AgentStyle;
    energy: AgentEnergy;
  };

  // Step 4: Skills
  skills: string[];

  // Step 5: Allowed Topics
  allowedTopics: string[];

  // Step 6: Forbidden Topics
  forbiddenTopics: string[];

  // Step 7: FAQs
  faqs: Array<{
    question: string;
    answer: string;
  }>;

  // Step 8: Contexto do Negócio
  businessContext: {
    companyName: string;
    productSummary: string;
    idealCustomerProfile: string;
    serviceRegion: string;
    valueProps: string;
    customerPains: string;
    socialProof: string;
    pricingPolicy: string;
    commercialTerms: string;
    businessHoursSla: string;
    primaryCta: string;
    compliancePolicy: string;
  };

  // Step 9: Estilo de Conversa
  conversationStyle: {
    responseLength: AgentResponseLength;
    maxQuestions: "1" | "2";
    emojiPolicy: AgentEmojiPolicy;
    openingStyle: string;
    closingStyle: string;
    whatsappGuidelines: string;
    humanizationTips: string;
  };

  // Step 10: Qualificação Mínima
  qualification: {
    requiredFields: string[];
    optionalFields: string[];
    notes: string;
  };

  // Step 11: Exemplos de Conversa (few-shot)
  examples: Array<{
    lead: string;
    agent: string;
  }>;

  // Step 12: Disponibilidade e tempo de resposta
  availability: {
    mode: AgentAvailabilityMode;
    timezone: string;
    days: string[];
    start: string;
    end: string;
  };
  responseDelaySeconds: number;

  // Step 13: Main Objective & Kanban Rules
  mainObjective: string;
  kanbanRules: Array<{
    pipeType: string;
    stageName: string;
    goal: string;
    behavior: string;
    allowedActions: string[];
    forbiddenActions: string[];
  }>;

  // Step 14: Modo de Operação (Outbound/BDR)
  operationMode: AgentOperationMode;
  
  // Step 15: Gatilhos de Ativação
  activationTriggers: ActivationTriggers;
  
  // Step 16: Configuração de Outbound
  outboundConfig: OutboundConfig;
  
  // Step 17: Ações Automáticas
  automationActions: AutomationActions;

  // Step 18: Regras de Follow-up
  followupRules: FollowupRule[];
}

// =====================================================
// OUTBOUND / BDR CONFIGURATION
// =====================================================

/**
 * Condição de gatilho baseada em campo personalizado
 */
export interface TriggerCondition {
  field: string;
  operator: TriggerOperator;
  value: string;
}

/**
 * Gatilhos de ativação do agente (condições IF)
 */
export interface ActivationTriggers {
  // Condições obrigatórias (TODAS devem ser verdadeiras)
  required: {
    tags: string[];           // Tags que o lead DEVE ter
    origins: string[];        // Origens aceitas (meta_ads, google_ads, etc)
    hasPhone: boolean;        // Lead deve ter telefone válido
    hasEmail: boolean;        // Lead deve ter email válido
  };
  // Condições opcionais (pelo menos UMA deve ser verdadeira)
  optional: TriggerCondition[];
}

/**
 * Configuração de outbound
 */
export interface OutboundConfig {
  delayMinutes: number;                    // Delay antes de enviar primeira mensagem
  firstMessageTemplate: string;            // Template da primeira mensagem
  availableVariables: string[];            // Variáveis disponíveis no template
  maxRetries: number;                      // Máximo de tentativas se falhar
  retryIntervalMinutes: number;            // Intervalo entre tentativas
}

/**
 * Ações a executar em determinado resultado
 */
export interface ResultAction {
  moveToStage: string;        // Mover para qual etapa
  addTags: string[];          // Tags a adicionar
  notifyUserId: string | null; // ID do usuário a notificar
  sendMessage: boolean;       // Enviar mensagem automática
  messageTemplate: string;    // Template da mensagem (se sendMessage = true)
}

/**
 * Ações automáticas baseadas no resultado da conversa
 */
export interface AutomationActions {
  onQualify: ResultAction;      // Quando qualificar com sucesso
  onDisqualify: ResultAction;   // Quando não qualificar
  onNeedHuman: ResultAction;    // Quando precisar de humano
}

// =====================================================
// TEMPLATE CONFIGURATION
// =====================================================

/**
 * Configuração de um template pré-definido de agente
 */
export interface AgentTemplate {
  type: AgentTemplateType;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  presetData: Partial<CopilotWizardData>;
}

// =====================================================
// CONTEXTO DINÂMICO PARA PROMPT
// =====================================================

/**
 * Contexto dinâmico passado ao agente em cada conversa
 * Usado para adaptar o comportamento do agente à situação atual
 */
export interface AgentContext {
  leadName?: string;
  leadCompany?: string;
  currentPipe: string; // 'confirmacao', 'propostas', 'whatsapp', 'campanha'
  currentStage: string; // Status específico da etapa
  leadHistory?: string[]; // Histórico de ações do lead
  leadTags?: string[]; // Tags associadas ao lead
  leadScore?: number; // Score de 0-100
}

// =====================================================
// SYSTEM PROMPT GERADO
// =====================================================

/**
 * Resultado da geração do System Prompt
 * Inclui o prompt completo e metadata para tracking
 */
export interface GeneratedPrompt {
  systemPrompt: string;
  metadata: {
    agentName: string;
    templateType: AgentTemplateType;
    generatedAt: string;
    version: number;
  };
}

// =====================================================
// AGENTE COMPLETO COM RELACIONAMENTOS
// =====================================================

/**
 * Agente com dados relacionados carregados (FAQs + Kanban Rules)
 * Usado na visualização detalhada e edição
 */
export interface CopilotAgentWithRelations extends CopilotAgent {
  copilot_agent_faqs: CopilotAgentFaq[];
  copilot_agent_kanban_rules: CopilotAgentKanbanRule[];
}

// =====================================================
// MUTATION PAYLOADS
// =====================================================

/**
 * Payload para criação de agente completo
 * Inclui agente + FAQs + Kanban Rules em uma transação
 */
export interface CreateAgentPayload {
  agent: CopilotAgentInsert;
  faqs: Array<{ question: string; answer: string }>;
  kanbanRules: Array<{
    pipeType: string;
    stageName: string;
    goal: string;
    behavior: string;
    allowedActions: string[];
    forbiddenActions: string[];
  }>;
  /** Regras de follow-up (usado quando template_type === 'followup') */
  followupRules?: Partial<FollowupRule>[];
}

/**
 * Payload para atualização de agente
 */
export interface UpdateAgentPayload extends CopilotAgentUpdate {
  id: string;
}

// =====================================================
// STATUS E FILTERS
// =====================================================

/**
 * Filtros para listagem de agentes
 */
export interface AgentFilters {
  isActive?: boolean;
  templateType?: AgentTemplateType;
  organizationId?: string;
}

/**
 * Estatísticas de uso do agente (futuro)
 */
export interface AgentStats {
  totalConversations: number;
  averageResponseTime: number;
  successRate: number;
  lastUsed: string | null;
}

// =====================================================
// CONSTANTS
// =====================================================

/**
 * Habilidades pré-definidas disponíveis para seleção
 */
export const AVAILABLE_SKILLS = [
  "Fazer perguntas estratégicas",
  "Qualificar leads",
  "Lidar com objeções",
  "Confirmar informações",
  "Direcionar para próxima etapa",
  "Agendar compromissos",
  "Identificar dor do cliente",
  "Criar urgência",
  "Reengajar leads inativos",
  "Manter relacionamento",
] as const;

/**
 * Pipelines disponíveis no sistema
 */
export const PIPE_TYPES = [
  { value: "confirmacao", label: "Pipe Confirmação" },
  { value: "propostas", label: "Pipe Propostas" },
  { value: "whatsapp", label: "Pipe WhatsApp" },
  { value: "campanha", label: "Campanhas" },
] as const;

/**
 * Etapas (stages) de cada pipeline
 */
export const PIPE_STAGES: Record<string, { value: string; label: string }[]> = {
  confirmacao: [
    { value: "reuniao_marcada", label: "Reunião Marcada" },
    { value: "confirmar_d5", label: "Confirmar D-5" },
    { value: "confirmar_d3", label: "Confirmar D-3" },
    { value: "confirmar_d2", label: "Confirmar D-2" },
    { value: "confirmar_d1", label: "Confirmar D-1" },
    { value: "confirmacao_no_dia", label: "Confirmação no Dia" },
    { value: "remarcar", label: "Remarcar" },
    { value: "compareceu", label: "Compareceu" },
    { value: "perdido", label: "Perdido" },
  ],
  propostas: [
    { value: "marcar_compromisso", label: "Marcar Compromisso" },
    { value: "reativar", label: "Reativar" },
    { value: "compromisso_marcado", label: "Compromisso Marcado" },
    { value: "esfriou", label: "Esfriou" },
    { value: "futuro", label: "Futuro" },
    { value: "vendido", label: "Vendido" },
    { value: "perdido", label: "Perdido" },
  ],
  whatsapp: [
    { value: "novo", label: "Novo" },
    { value: "abordado", label: "Abordado" },
    { value: "respondeu", label: "Respondeu" },
    { value: "esfriou", label: "Esfriou" },
    { value: "agendado", label: "Agendado" },
  ],
  campanha: [
    { value: "custom", label: "Etapas customizadas da campanha" },
  ],
};

/**
 * Interface para regras de movimentação automática
 */
export interface MoveRule {
  from: {
    pipe: string;
    stage: string;
  };
  to: {
    pipe: string;
    stage: string;
  };
  condition: "qualified" | "objective_met";
}

// =====================================================
// FOLLOW-UP RULES
// =====================================================

/**
 * Filtro por campo personalizado
 */
export interface CustomFieldFilter {
  field: string;
  operator: TriggerOperator;
  value: string;
}

/**
 * Regra de follow-up para agentes
 */
export interface FollowupRule {
  id?: string;
  name: string;
  description?: string;
  isActive: boolean;
  priority: number;
  
  // Gatilhos de tempo
  triggerType: FollowupTriggerType;
  triggerDelayHours: number;
  triggerDelayMinutes: number;
  maxFollowups: number;
  
  // Filtros de leads
  filterTags: string[];
  filterTagsExclude: string[];
  filterOrigins: string[];
  filterPipes: string[];
  filterStages: string[];
  filterCustomFields: CustomFieldFilter[];
  
  // Comportamento
  useLastContext: boolean;
  contextLookbackDays: number;
  followupStyle: FollowupStyle;
  messageTemplate?: string;
  
  // Horários
  sendOnlyBusinessHours: boolean;
  businessHoursStart: string;
  businessHoursEnd: string;
  sendDays: string[];
  timezone: string;
}

/**
 * Resumo do contexto da conversa (para follow-up inteligente)
 */
export interface ConversationContextSummary {
  leadId: string;
  lastTopic?: string;
  lastIntent?: string;
  keyPoints: string[];
  objectionsRaised: string[];
  questionsAsked: string[];
  nextAction?: string;
  qualificationData: Record<string, any>;
  leadTemperature: LeadTemperature;
  engagementScore: number;
  lastMessageAt?: string;
  messageCount: number;
  followupCount: number;
  lastFollowupAt?: string;
}

/**
 * Configuração de contexto do agente
 */
export interface AgentContextConfig {
  useLastConversation: boolean;
  maxHistoryMessages: number;
  includeLeadData: boolean;
  includeCustomFields: boolean;
  summarizeLongConversations: boolean;
}

/**
 * Detecção de intenção do lead
 */
export interface IntentDetectionRule {
  intent: string;
  keywords: string[];
  action: string;
  priority: number;
}

/**
 * Configuração de pipeline do agente
 */
export interface AgentPipelineConfig {
  activePipes: string[];
  activeStages: Record<string, string[]>;
  canMoveCards: boolean;
  autoMoveOnQualify: boolean;
  autoMoveOnObjective: boolean;
  moveRules: MoveRule[];
}
