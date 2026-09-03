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
export type NaturalMessagingIntensity = "suave" | "natural" | "conversacional";
export type TriggerOperator = "=" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "not_contains";

// Tipos para Follow-up Rules
export type FollowupTriggerType =
  | "no_response"
  | "after_qualification"
  | "after_meeting_scheduled"
  | "post_sale"
  | "proposal_no_response";
export type FollowupStyle = "direct" | "value" | "curiosity" | "breakup";
export type LeadTemperature = "cold" | "warm" | "hot";

// =====================================================
// OBJECTIVE COMPOSITE
// =====================================================

/**
 * Objetivo estruturado em 3 partes — substitui o main_objective (string única)
 * Mapeia para a coluna JSONB objective_composite no banco
 */
export interface ObjectiveComposite {
  mission: string;           // O que o agente deve fazer
  success_criteria: string;  // Quando a interação é considerada bem-sucedida
  limits: string;            // O que o agente NÃO deve fazer
}

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
    hideAiIdentity?: boolean;
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
  behaviorWindows: Array<{
    id: string;
    name: string;
    days: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">;
    start: string;
    end: string;
    behavior: string;
  }>;
  behaviorEnforcement: "hard" | "soft";
  responseDelaySeconds: number;

  // Step 13: Main Objective & Kanban Rules
  mainObjective: string;
  objectiveComposite: ObjectiveComposite;
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

  // Step 19: Instruções personalizadas do usuário (Do's & Don'ts)
  customInstructions: {
    dos: string;
    donts: string;
  };

  // Step 20: Base de Conhecimento (RAG)
  knowledgeBaseFiles: File[];

  // ===== NOVOS CAMPOS (Wizard v3 — Steps Reestruturados) =====

  // Persona e Tom de Voz (campo livre — substitui personality dropdowns + conversationStyle)
  personaDescription: string;

  // Habilidades e Tópicos (campo livre — substitui skills[] + allowedTopics[] + forbiddenTopics[])
  skillsAndTopics: string;

  // Step 21: Capacidades / Permissões do Agente
  canQualifyLead: boolean;
  canScheduleMeeting: boolean;
  canSendFollowup: boolean;
  canUpdateCrm: boolean;
  canAnswerFaq: boolean;
  canCreateLead: boolean;
  canTransferHuman: boolean;
  canMoveCards: boolean;
  // Opcionais: o Playground é a única superfície que edita estas duas. Ausente
  // significa "não mexa na flag do banco" — nunca false.
  canSendDocument?: boolean;
  canTransferSzChat?: boolean;
  maxConversationTurns: number;
  responseDelayMs: number;

  // Configuração: Atender contatos sem lead (shadow leads)
  attendUnknownContacts: boolean;

  // Item #7: Temperatura do LLM (Criativo / Balanceado / Preciso)
  llmTemperatureMode: 'criativo' | 'balanceado' | 'preciso';

  // Mensagens Naturais — quebra respostas em múltiplas mensagens curtas
  naturalMessagingEnabled: boolean;
  naturalMessagingIntensity: NaturalMessagingIntensity;
}

// =====================================================
// NATURAL MESSAGING CONFIG
// =====================================================

/**
 * Configuração de mensagens naturais — quebra respostas longas em
 * múltiplas mensagens curtas para simular conversa real no WhatsApp
 */
export interface NaturalMessagingConfig {
  enabled: boolean;
  intensity: NaturalMessagingIntensity;
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
  audioEnabled?: boolean;                  // Habilitar envio de áudio na abordagem
  audioSendOrder?: "text_first" | "audio_first"; // Ordem de envio texto/áudio
}

/**
 * Áudio pré-gravado para abordagem outbound
 */
export interface CopilotAgentAudio {
  id: string;
  agent_id: string;
  organization_id: string;
  name: string;
  storage_path: string;
  public_url: string;
  mime_type: string;
  file_size: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Configuração de TTS (Text-to-Speech) via ElevenLabs
 * NULL na coluna = feature desabilitada
 */
export interface TtsConfig {
  provider: "elevenlabs";
  voice_id: string;
  mode: "always" | "mirror";
  max_chars: number;
  model_id?: string;
  stability?: number;
  similarity_boost?: number;
}

/**
 * Mover lead para outro pipe (Confirmação ou Propostas) em uma etapa
 */
export interface MoveToPipeConfig {
  pipe: "confirmacao" | "propostas";
  stage: string;
}

/**
 * Ações a executar em determinado resultado
 */
export interface ResultAction {
  moveToStage: string;        // Mover para qual etapa (pipe WhatsApp)
  moveToPipe?: MoveToPipeConfig | null; // Mover para pipe Confirmação ou Propostas
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
  currentPipe: string; // slug do funil ('whatsapp', 'confirmacao', ..., ou slug de funil custom) ou 'campanha'
  currentStage: string; // Status específico da etapa (stage_key)
  /** SCRUM-628: identidade real do funil/etapa — permite casar regras salvas no formato novo (uuid). */
  currentPipelineId?: string;
  currentStageId?: string;
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

// SCRUM-641: PIPE_TYPES (catálogo cravado "Pipe Confirmação"/"Pipe Propostas"/
// "Pipe WhatsApp") morreu — as telas resolvem as opções com os funis REAIS da
// org via `usePipeTypeOptions` (@/modules/copilot/hooks).

/**
 * @deprecated Use useAllPipelineStageOptions() ou usePipelineStageOptions(type) do hook usePipelineStages.
 * Mantido temporariamente para compatibilidade.
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
    { value: "proposta_enviada", label: "Proposta Enviada" },
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
 * Single step in a multi-step follow-up cadence.
 * Stored as JSONB array in copilot_agent_followup_rules.sequence_steps.
 */
export interface SequenceStep {
  order: number;
  delayHours: number;
  delayMinutes: number;
  style: FollowupStyle;
  messageTemplate?: string;
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

  // Cadencia multi-step (quando presente, sobrescreve single-shot)
  sequenceSteps?: SequenceStep[];

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
