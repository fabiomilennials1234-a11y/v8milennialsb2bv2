import type { Node, Edge } from "@xyflow/react";

/**
 * A forma de um componente de template aprovado, como a listagem da Meta a
 * devolve (#1688).
 *
 * Declarada aqui, estruturalmente idêntica a `NotificameTemplateComponent` de
 * `modules/communication`, em vez de importada: `src/types/` é cross-cutting e
 * puxar o barrel de um módulo de domínio daqui cruzaria fronteira e convidaria
 * um ciclo. Sendo estrutural, os dois lados continuam atribuíveis um ao outro —
 * e um campo novo lá que este tipo não tenha simplesmente não é lido aqui.
 */
export interface WorkflowTemplateComponent {
  type: string;
  format?: string | null;
  text?: string | null;
  buttons?: unknown[] | null;
  example?: unknown;
}

// =====================================================
// ENUMS
// =====================================================

export type WorkflowTriggerType =
  | "lead_created"
  | "stage_changed"
  | "tag_added"
  | "score_reached"
  | "cron"
  // Novos triggers
  | "lead_replied"
  | "lead_no_reply"
  | "meeting_confirmed"
  | "meeting_not_confirmed"
  | "proposal_accepted"
  | "proposal_lost"
  | "followup_overdue"
  | "webhook_received"
  | "lead_assigned"
  | "campaign_status_changed"
  | "lead_added_to_campaign"
  | "lead_removed_from_campaign"
  | "campaign_lead_replied"
  | "campaign_lead_no_reply"
  | "campaign_completed"
  | "field_changed"
  | "scheduled_date";

export type WorkflowNodeType =
  | "trigger"
  | "action"
  | "condition"
  | "delay"
  | "copilot"
  | "end"
  // Novos nós de controle de fluxo
  | "wait_response"
  | "split_ab"
  | "webhook_call"
  | "goto"
  | "wait_business_window"
  | "assign_responsible";

/**
 * Instance Routing Policy (PRD #1331) — a regra declarada no WhatsApp Message
 * Node para escolher a Instance de saída.
 *
 *   conversation — a Instance em que a conversa com o Lead está viva
 *   responsible  — a Instance vinculada ao responsável pelo Lead
 *   fixed        — a Instance nomeada no nó
 *
 * A leitura do nó legado e as transições vivem em
 * `modules/workflows/lib/instance-routing`.
 */
export type InstanceRoutingPolicy = "conversation" | "responsible" | "fixed";

export type MessageType =
  | "texto"
  | "imagem"
  | "video"
  | "audio"
  | "sticker"
  | "menu"
  | "pix";

export type WorkflowActionType =
  // Comunicação
  | "send_whatsapp_message" // node unificado (ADR-0012)
  | "send_whatsapp"
  | "send_whatsapp_audio"
  | "send_whatsapp_image"
  | "send_whatsapp_video"
  | "send_whatsapp_sticker"
  | "send_whatsapp_document"
  | "send_whatsapp_template"
  | "send_whatsapp_menu"
  | "send_whatsapp_pix_button"
  | "send_meta_message"
  | "send_semi_automatic"
  | "send_to_number"
  // Lead Management
  | "move_stage"
  | "add_tag"
  | "remove_tag"
  | "update_lead_field"
  | "update_custom_field"
  | "update_rating"
  | "calculate_score"
  | "duplicate_to_pipe"
  | "remove_from_pipe"
  | "mark_as_lost"
  // Campanhas
  | "add_to_campaign"
  | "remove_from_campaign"
  | "move_campaign_stage"
  | "send_campaign_message"
  | "pause_campaign_sequence"
  | "resume_campaign_sequence"
  // Agenda
  | "create_calendar_event"
  | "schedule_meeting"
  // TinyERP
  | "create_tinyerp_order"
  | "create_tinyerp_upsell_order"
  // Equipe
  | "assign_responsible"
  | "assign_sdr"
  | "assign_closer" // @deprecated — legado, mapeado para sale_responsible
  | "notify_team_member"
  // Follow-up
  | "create_followup"
  // Checklists
  | "apply_checklist"
  | "mark_checklist_item"
  // Copilot / IA
  | "generate_ai_message"
  | "summarize_conversation"
  | "evaluate_conversation";

export type WorkflowExecutionStatus =
  | "running"
  /** Reclamada pelo worker — estado transitório entre o claim e a escrita do executor. */
  | "processing"
  | "paused"
  | "completed"
  | "failed"
  /**
   * Terminal deliberado. Reusa o status que a UI já sabe exibir (badge + stat
   * card em AutomacoesExecucoes) em vez de inventar `expired`: `STATUS_CONFIG`
   * cai em `running` para status desconhecido, então um terminal novo
   * apareceria como "Executando" com spinner — eterno na tela.
   * O motivo específico vai no prefixo de `error` (`expired:*`).
   */
  | "cancelled"
  | "loop_limit_reached"
  | "waiting_response";

export type WorkflowStepStatus =
  | "success"
  | "failed"
  | "skipped";

export type ConditionOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "greater_than"
  | "less_than"
  | "greater_or_equal"
  | "less_or_equal"
  | "is_empty"
  | "is_not_empty"
  | "has_tag"
  | "not_has_tag"
  | "in_stage"
  | "not_in_stage"
  | "starts_with"
  | "ends_with"
  | "in_list"
  | "not_in_list"
  | "is_true"
  | "is_false"
  | "regex_match";

export type DelayUnit = "seconds" | "minutes" | "hours" | "days";

export type ConditionMode = "field" | "time_window";

export interface TimeWindowConfig {
  days: string[];           // ["seg","ter","qua","qui","sex"] — same format as followupSchedule
  startTime: string;        // "HH:MM" e.g. "08:00"
  endTime: string;          // "HH:MM" e.g. "18:00"
  timezone: string;         // e.g. "America/Sao_Paulo"
}

export const WEEKDAY_OPTIONS = [
  { value: "seg", label: "Seg" },
  { value: "ter", label: "Ter" },
  { value: "qua", label: "Qua" },
  { value: "qui", label: "Qui" },
  { value: "sex", label: "Sex" },
  { value: "sab", label: "Sab" },
  { value: "dom", label: "Dom" },
] as const;

// =====================================================
// TRIGGER CONFIG
// =====================================================

export interface TriggerConfigLeadCreated {
  filter_origin?: string;
  filter_pipe?: string;
  filter_pipeline_id?: string;    // UUID for custom pipelines
}

export interface TriggerConfigStageChanged {
  pipe_type?: string;       // "whatsapp" | "confirmacao" | "propostas" | etc.
  pipeline_id?: string;     // UUID for custom pipelines
  campanha_id?: string;     // UUID for campaigns
  from_stage?: string;
  to_stage?: string;
  stages?: string[];        // multiple target stages (replaces to_stage for multi-select)
}

export interface TriggerConfigTagAdded {
  tag_id?: string;
  tag_name?: string;
}

export interface TriggerConfigScoreReached {
  min_score: number;
}

export interface TriggerConfigCron {
  cron_expression: string;
  description?: string;
}

export interface TriggerConfigLeadReplied {
  channel?: "whatsapp" | "meta" | "any";
  contains_text?: string;
}

export interface TriggerConfigLeadNoReply {
  timeout_hours: number;
  channel?: "whatsapp" | "meta" | "any";
}

export interface TriggerConfigMeetingConfirmed {
  pipe_type?: string;
}

export interface TriggerConfigMeetingNotConfirmed {
  hours_before: number;
}

export interface TriggerConfigProposalResult {
  result_type?: "vendido" | "perdido";
}

export interface TriggerConfigWebhookReceived {
  webhook_key: string;
  description?: string;
}

export interface TriggerConfigLeadAssigned {
  role?: "sdr" | "closer" | "sale" | "any";
}

export interface TriggerConfigCampaignStatus {
  campaign_id?: string;
  new_status?: "active" | "paused" | "completed";
}

export interface TriggerConfigFieldChanged {
  field_name: string;
  old_value?: string;
  new_value?: string;
}

/**
 * Trigger "Antes de uma data" (scheduled_date).
 *
 * Alvo = data da reunião marcada de cada lead (`pipeline_entries.metadata->>'meeting_date'`),
 * por-lead (não uma data global fixa). Audiência = 1 pipe + etapa(s) + origem opcional.
 * Cada item de `dispatches` dispara uma vez por lead por reunião; remarcar re-arma todos os itens.
 */
export type ScheduledDispatchUnit = "days" | "hours" | "minutes";

/** Dispara assim que a reunião é marcada (Fatia 2). Repete a cada remarcação. */
export interface ScheduledDispatchOnBook {
  anchor: "ao_marcar";
  send_time?: string;       // "HH:MM" — opcional
}

/** Dispara `value` `unit` antes da reunião, no horário `send_time` (fuso da org). */
export interface ScheduledDispatchBefore {
  anchor: "antes_da_reuniao";
  value: number;
  unit: ScheduledDispatchUnit;
  send_time?: string;       // "HH:MM" — default "09:00"
}

export type ScheduledDispatchItem = ScheduledDispatchOnBook | ScheduledDispatchBefore;

export interface TriggerConfigScheduledDate {
  pipe_type?: string;       // slug do pipe de sistema: "whatsapp" | "confirmacao" | "propostas"
  pipeline_id?: string;     // UUID para funis custom (alternativa a pipe_type)
  stages?: string[];        // etapa(s) selecionada(s); vazio = qualquer etapa do pipe
  filter_origin?: string;   // origem opcional
  dispatches: ScheduledDispatchItem[];
}

export type TriggerConfig =
  | TriggerConfigLeadCreated
  | TriggerConfigStageChanged
  | TriggerConfigTagAdded
  | TriggerConfigScoreReached
  | TriggerConfigCron
  | TriggerConfigLeadReplied
  | TriggerConfigLeadNoReply
  | TriggerConfigMeetingConfirmed
  | TriggerConfigMeetingNotConfirmed
  | TriggerConfigProposalResult
  | TriggerConfigWebhookReceived
  | TriggerConfigLeadAssigned
  | TriggerConfigCampaignStatus
  | TriggerConfigFieldChanged
  | TriggerConfigScheduledDate;

// =====================================================
// NODE DATA
// =====================================================

export interface TriggerNodeData {
  type: "trigger";
  triggerType: WorkflowTriggerType;
  config: TriggerConfig;
  label: string;
  [key: string]: unknown;
}

export interface ActionNodeData {
  type: "action";
  actionType: WorkflowActionType;
  label: string;
  // Instance Routing Policy (PRD #1331) — de qual Instance a mensagem sai.
  // `whatsappInstanceId` é o campo legado e passa a ser a Instance da política
  // `fixed`; vazio significa `conversation`. Ver modules/workflows/lib/instance-routing.
  instanceRoutingPolicy?: InstanceRoutingPolicy;
  whatsappInstanceId?: string;
  whatsappInstanceName?: string;
  // Instance usada quando a política não resolve por ausência de conversa.
  fallbackInstanceId?: string;
  fallbackInstanceName?: string;
  // Unified "Enviar Mensagem" node (ADR-0012) — discriminator + semi-auto toggle
  messageType?: MessageType;
  semiAutomatic?: boolean;
  // Send WhatsApp (texto)
  messageTemplate?: string;
  /** @deprecated Legado do nó de template antigo. Ver `templateName` (#1688). */
  templateId?: string;
  // Send WhatsApp Template (canal oficial, #1688) — o nó guarda a FORMA do
  // template aprovado, não uma referência a catálogo local. Ver
  // `action-configs/TemplateNodeConfig.tsx`.
  templateName?: string;
  templateLanguage?: string;
  /** Os `components` como vieram da listagem da Meta — a forma, para o executor remontar. */
  templateComponents?: WorkflowTemplateComponent[];
  /**
   * Token do template → expressão do Torque. `{ "1": "{{nome}}" }`.
   * ⚠️ Dois namespaces: a chave é da Meta, o valor é nosso.
   */
  templateVariables?: Record<string, string>;
  /** Vazio significa "use o arquivo que veio aprovado com o template". */
  templateHeaderMediaUrl?: string;
  // ── Escape de janela do nó de TEXTO (canal oficial, #1689) ────────────────
  // Qual template usar quando a janela de 24h estiver fechada e a Meta recusar
  // mensagem livre. Campos SEPARADOS dos do nó de template de propósito: um nó
  // de texto pode ter os dois assuntos (o texto e o escape) e reaproveitar as
  // mesmas chaves faria um sobrescrever o outro. Sem `escapeTemplateName` o nó
  // falha com motivo legível — ver `_shared/decisao-de-envio.ts`.
  escapeTemplateName?: string;
  escapeTemplateLanguage?: string;
  escapeTemplateComponents?: WorkflowTemplateComponent[];
  escapeTemplateVariables?: Record<string, string>;
  escapeTemplateHeaderMediaUrl?: string;
  useTemplate?: boolean;
  templateMode?: "free" | "campaign_template" | "meta_template" | "ai";
  templateSourceId?: string;
  // Send WhatsApp (áudio)
  audioId?: string;
  audioName?: string;
  audioUrl?: string;
  audioMode?: "recorded" | "template";
  audioSourceId?: string;
  // Send WhatsApp (imagem)
  imageUrl?: string;
  imageCaption?: string;
  // Send WhatsApp (vídeo — MP4, até 16MB)
  videoUrl?: string;
  videoCaption?: string;
  /** Reservado p/ biblioteca de vídeos futura — sem UI hoje (sempre "upload"). */
  videoMode?: "upload" | "library";
  /** Reservado p/ biblioteca de vídeos futura — sem UI hoje. */
  videoSourceId?: string;
  // Send WhatsApp (figurinha)
  stickerUrl?: string;
  // Send WhatsApp (documento — PDF/DOC, até 16MB)
  documentUrl?: string;
  documentName?: string;
  documentCaption?: string;
  // Send WhatsApp Menu (Uazapi-only)
  menuType?: "button" | "list" | "poll" | "carousel";
  menuText?: string;
  menuFooter?: string;
  menuChoices?: string[];
  menuSelectableCount?: number;
  // Send WhatsApp PIX Button (Uazapi-only)
  pixkey?: string;
  pixkeyType?: "cpf" | "cnpj" | "email" | "phone" | "random";
  pixAmount?: number;
  pixMerchantName?: string;
  pixText?: string;
  // Instagram Direct (`send_meta_message`)
  //
  // ⚠️ `metaChannel` é LEGADO da rota da Meta direta, que oferecia Messenger. O
  // nó é do Instagram e só; a tela não o oferece mais e o executor recusa
  // qualquer outro valor em vez de silenciosamente mandar pela caixa errada.
  /** @deprecated O nó é Instagram-only. Ver `_shared/instagram-node.ts`. */
  metaChannel?: "instagram";
  metaMessage?: string;
  /** Texto, imagem, vídeo ou áudio. Documento e figurinha não existem no Direct. */
  metaMessageType?: "texto" | "imagem" | "video" | "audio";
  /** URL https PÚBLICA — quem baixa o arquivo é o fornecedor, não nós. */
  metaMediaUrl?: string;
  metaCaption?: string;
  // Semi-automático
  semiAutoMessage?: string;
  semiAutoApprover?: string;
  // Enviar para número fixo (send_to_number) — destinos fixos, NÃO o número do lead.
  // messageTemplate (acima) carrega o texto; reusa o mesmo resolvedor de variáveis.
  notifyPhones?: string[];
  includeConversationSummary?: boolean;
  // Move stage
  pipeType?: string;
  targetStage?: string;
  // Tag
  tagId?: string;
  tagName?: string;
  // Update lead field
  fieldName?: string;
  fieldValue?: string;
  // Update custom field
  customFieldName?: string;
  customFieldValue?: string;
  // Update rating
  ratingValue?: number;
  // Duplicate to pipe
  targetPipeType?: string;
  targetPipeStage?: string;
  // Mark as lost
  lostReason?: string;
  // Campaign
  campaignId?: string;
  campaignName?: string;
  campaignStageId?: string;
  campaignStageName?: string;
  campaignTemplateId?: string;
  campaignTemplateName?: string;
  // Calendar
  eventTitle?: string;
  eventDescription?: string;
  eventDurationMinutes?: number;
  eventAttendeesField?: string;
  // Schedule meeting
  meetingDate?: string;
  meetingCloserId?: string;
  // TinyERP
  tinyProductId?: string;
  tinyProductName?: string;
  // Notify
  notifyMemberId?: string;
  notifyMemberName?: string;
  notifyMessage?: string;
  notifyChannel?: "app" | "whatsapp" | "both";
  // Follow-up
  followupTitle?: string;
  followupDescription?: string;
  followupPriority?: "low" | "medium" | "high";
  // Assign
  assigneeId?: string;
  assigneeName?: string;
  assignMode?: "specific" | "round_robin";
  // Checklist
  checklistTemplateId?: string;
  checklistTemplateName?: string;
  // Mark checklist item (ADR-0016): endereça o item pela linhagem do template.
  checklistItemTemplateId?: string;
  checklistItemTitle?: string;
  checklistItemAction?: "mark" | "unmark";
  // IA
  aiAgentId?: string;
  aiAgentName?: string;
  aiPrompt?: string;
  aiOutputVariable?: string;
  [key: string]: unknown;
}

export interface ConditionNodeData {
  type: "condition";
  label: string;
  field: string;
  operator: ConditionOperator;
  value: string;
  conditionMode?: ConditionMode;
  timeWindow?: TimeWindowConfig;
  [key: string]: unknown;
}

export interface DelayNodeData {
  type: "delay";
  label: string;
  amount: number;
  unit: DelayUnit;
  randomized?: boolean;
  amountMin?: number;
  amountMax?: number;
  [key: string]: unknown;
}

export interface CopilotNodeData {
  type: "copilot";
  label: string;
  agentId: string;
  agentName?: string;
  [key: string]: unknown;
}

export interface EndNodeData {
  type: "end";
  label: string;
  [key: string]: unknown;
}

export interface WaitResponseNodeData {
  type: "wait_response";
  label: string;
  timeoutHours: number;
  timeoutMinutes: number;
  channel: "whatsapp" | "meta" | "any";
  [key: string]: unknown;
}

export interface SplitVariant {
  id: string;
  label: string;
  percentage: number;
  /**
   * Optional tag names (case-insensitive) that force a lead into this path.
   * Stored by NAME (not id) so they travel through export/import in the
   * definition jsonb and degrade safely if the destination org lacks the tag.
   * Tag match has PRIORITY over the weighted random roll.
   */
  tags?: string[];
}

export interface SplitAbNodeData {
  type: "split_ab";
  label: string;
  variants: SplitVariant[];
  // Legacy fields — kept optional for migration from old workflows
  splitPercentA?: number;
  variantALabel?: string;
  variantBLabel?: string;
  [key: string]: unknown;
}

/** Converts legacy A/B-only data to the new variants[] format */
export function migrateSplitAbData(data: Record<string, unknown>): SplitAbNodeData {
  // Already migrated
  if (Array.isArray(data.variants) && data.variants.length > 0) {
    return data as unknown as SplitAbNodeData;
  }

  // Legacy format: splitPercentA / variantALabel / variantBLabel
  const percentA = Number(data.splitPercentA) || 50;
  const percentB = 100 - percentA;

  return {
    type: "split_ab",
    label: (data.label as string) || "Split A/B",
    variants: [
      { id: "a", label: (data.variantALabel as string) || "A", percentage: percentA },
      { id: "b", label: (data.variantBLabel as string) || "B", percentage: percentB },
    ],
  };
}

/** Distributes percentages evenly across N variants, ensuring sum === 100 */
export function distributePercentages(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor((100 / count) * 100) / 100; // 2 decimal places
  const percentages = Array(count).fill(base);
  // Assign remainder to the last variant so sum === 100
  const remainder = 100 - base * count;
  percentages[count - 1] = Math.round((percentages[count - 1] + remainder) * 100) / 100;
  return percentages;
}

/** Metrics returned by get_split_ab_metrics RPC */
export interface SplitAbVariantMetrics {
  variant_id: string;
  variant_label: string;
  total_leads: number;
  total_executions: number;
  messages_sent: number;
  completed: number;
  failed: number;
  waiting_response: number;
  in_progress: number;
}

export interface WebhookCallNodeData {
  type: "webhook_call";
  label: string;
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  bodyTemplate?: string;
  outputVariable?: string;
  [key: string]: unknown;
}

export interface GotoNodeData {
  type: "goto";
  label: string;
  targetNodeId: string;
  targetNodeLabel?: string;
  [key: string]: unknown;
}

export type AssignMode = "round_robin" | "random" | "manual";
export type AssignTarget = "responsible" | "sdr" | "closer" | "sale";

/**
 * Time-Aware Workflow Window.
 *
 * Semântica (CTO 2026-08-19): **a janela desenhada é o horário em que a
 * mensagem dispara.** Dentro de uma janela de envio o fluxo segue; fora de toda
 * janela, dorme até a próxima abrir.
 *
 * Ações que a UI grava HOJE:
 *   - "pass": esta janela é horário de envio — o fluxo continua pela edge default
 *   - "route:branchKey": sai pela edge cujo sourceHandle === branchKey
 *
 * O literal `"pass"` NÃO é renomeado por decisão: o rótulo na UI mudou
 * ("Enviar nesta janela"), o valor gravado não. Renomear arriscaria 8 workflows
 * vivos e não compraria nada.
 */
export type WindowAction =
  | "pass"
  | `route:${string}`;

/**
 * Vocabulário legado, ainda presente em definições gravadas — **lido, nunca
 * escrito**. `hold_until:` com alvo VAZIO é interpretado como janela de envio
 * (a UI antiga oferecia o alvo e nunca o exigia); com alvo NOMEADO é bloqueio
 * deliberado. O intérprete único vive em
 * `supabase/functions/_shared/workflow-window-role.ts`.
 */
export type LegacyWindowAction = `hold_until:${string}`;

/** O que pode aparecer numa definição salva: o vocabulário novo mais o legado. */
export type StoredWindowAction = WindowAction | LegacyWindowAction;

export interface WorkflowBehaviorWindow {
  id: string;
  name: string;
  /** Subset of "mon"|"tue"|"wed"|"thu"|"fri"|"sat"|"sun" */
  days: string[];
  /** "HH:MM" */
  start: string;
  /** "HH:MM" */
  end: string;
  action: StoredWindowAction;
}

export interface WaitBusinessWindowNodeData {
  type: "wait_business_window";
  label: string;
  /** Legacy (retrocompat — usado se windows[] vazio): janela única hold-only. */
  days?: string[];
  startTime?: string;
  endTime?: string;
  timezone?: string;
  /** Até 6 janelas customizáveis. First-match wins. */
  windows?: WorkflowBehaviorWindow[];
  /**
   * @deprecated Decorativo — **nunca lido em runtime**. O executor só o ecoava
   * no payload do step; o comportamento sempre veio de `windows[].action`. O
   * campo permanece no tipo para que definições antigas round-trippem intactas
   * ao salvar, e sumiu da UI.
   */
  mode?: "hold" | "route" | "hybrid";
  [key: string]: unknown;
}

export interface AssignResponsibleNodeData {
  type: "assign_responsible";
  label: string;
  assignMode: AssignMode;
  assignTarget: AssignTarget;
  assigneeId?: string;      // manual mode
  assigneeName?: string;    // manual mode display
  memberIds?: string[];     // subset filter for round_robin/random (empty = all active)
  [key: string]: unknown;
}

export type WorkflowNodeData =
  | TriggerNodeData
  | ActionNodeData
  | ConditionNodeData
  | DelayNodeData
  | CopilotNodeData
  | EndNodeData
  | WaitResponseNodeData
  | SplitAbNodeData
  | WebhookCallNodeData
  | GotoNodeData
  | WaitBusinessWindowNodeData
  | AssignResponsibleNodeData;

// =====================================================
// REACT FLOW NODE/EDGE TYPES
// =====================================================

export type WorkflowNode = Node<WorkflowNodeData, WorkflowNodeType>;
export type WorkflowEdge = Edge & {
  data?: {
    loopLimit?: number;
  };
};

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// =====================================================
// DATABASE TYPES
// =====================================================

export interface Workflow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  trigger_type: WorkflowTriggerType;
  trigger_config: TriggerConfig;
  definition: WorkflowDefinition;
  loop_limit: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowInsert {
  name: string;
  description?: string | null;
  is_active?: boolean;
  trigger_type: WorkflowTriggerType;
  trigger_config: TriggerConfig;
  definition: WorkflowDefinition;
  loop_limit?: number;
}

export interface WorkflowUpdate {
  name?: string;
  description?: string | null;
  is_active?: boolean;
  trigger_type?: WorkflowTriggerType;
  trigger_config?: TriggerConfig;
  definition?: WorkflowDefinition;
  loop_limit?: number;
}

export interface WorkflowExecution {
  id: string;
  workflow_id: string;
  organization_id: string;
  lead_id: string;
  status: WorkflowExecutionStatus;
  current_node_id: string | null;
  loop_counters: Record<string, number>;
  context: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

export interface WorkflowExecutionStep {
  id: string;
  execution_id: string;
  node_id: string;
  node_type: WorkflowNodeType;
  node_label: string;
  status: WorkflowStepStatus;
  input_data: Record<string, unknown> | null;
  output_data: Record<string, unknown> | null;
  error: string | null;
  executed_at: string;
}

// =====================================================
// UI HELPERS
// =====================================================

export const NODE_COLORS: Record<WorkflowNodeType, { border: string; bgLight: string; bgDark: string }> = {
  trigger:        { border: "border-blue-500",    bgLight: "bg-blue-50",    bgDark: "dark:bg-blue-950" },
  action:         { border: "border-green-500",   bgLight: "bg-green-50",   bgDark: "dark:bg-green-950" },
  condition:      { border: "border-yellow-500",  bgLight: "bg-yellow-50",  bgDark: "dark:bg-yellow-950" },
  delay:          { border: "border-purple-500",  bgLight: "bg-purple-50",  bgDark: "dark:bg-purple-950" },
  copilot:        { border: "border-cyan-500",    bgLight: "bg-cyan-50",    bgDark: "dark:bg-cyan-950" },
  end:            { border: "border-border",      bgLight: "bg-muted",      bgDark: "dark:bg-muted" },
  wait_response:  { border: "border-orange-500",  bgLight: "bg-orange-50",  bgDark: "dark:bg-orange-950" },
  split_ab:       { border: "border-pink-500",    bgLight: "bg-pink-50",    bgDark: "dark:bg-pink-950" },
  webhook_call:   { border: "border-indigo-500",  bgLight: "bg-indigo-50",  bgDark: "dark:bg-indigo-950" },
  goto:                  { border: "border-teal-500",    bgLight: "bg-teal-50",    bgDark: "dark:bg-teal-950" },
  wait_business_window:  { border: "border-amber-500",   bgLight: "bg-amber-50",   bgDark: "dark:bg-amber-950" },
  assign_responsible:    { border: "border-rose-500",    bgLight: "bg-rose-50",    bgDark: "dark:bg-rose-950" },
};

export const NODE_LABELS: Record<WorkflowNodeType, string> = {
  trigger: "Trigger",
  action: "Ação",
  condition: "Condição",
  delay: "Delay",
  copilot: "Copilot",
  end: "Fim",
  wait_response: "Esperar Resposta",
  split_ab: "Split A/B",
  webhook_call: "Webhook",
  goto: "Ir Para",
  wait_business_window: "Janela Comercial",
  assign_responsible: "Definir Responsável",
};

export const ACTION_LABELS: Record<WorkflowActionType, string> = {
  // Comunicação
  send_whatsapp_message: "Enviar Mensagem",
  send_whatsapp: "Enviar WhatsApp (Texto)",
  send_whatsapp_audio: "Enviar WhatsApp (Áudio)",
  send_whatsapp_image: "Enviar WhatsApp (Imagem)",
  send_whatsapp_video: "Enviar WhatsApp (Vídeo)",
  send_whatsapp_sticker: "Enviar WhatsApp (Figurinha)",
  send_whatsapp_document: "Enviar WhatsApp (Documento)",
  send_whatsapp_template: "Enviar Template WhatsApp",
  send_whatsapp_menu: "Enviar Menu Interativo (Uazapi)",
  send_whatsapp_pix_button: "Enviar Botão PIX (Uazapi)",
  send_meta_message: "Enviar Mensagem no Instagram",
  send_semi_automatic: "Envio Semi-Automático",
  send_to_number: "Enviar p/ número fixo",
  // Lead Management
  move_stage: "Mover Estágio",
  add_tag: "Adicionar Tag",
  remove_tag: "Remover Tag",
  update_lead_field: "Atualizar Campo do Lead",
  update_custom_field: "Atualizar Campo Customizado",
  update_rating: "Atualizar Rating",
  calculate_score: "Calcular Lead Score (IA)",
  duplicate_to_pipe: "Duplicar em Outro Pipe",
  remove_from_pipe: "Remover do Pipe",
  mark_as_lost: "Marcar como Perdido",
  // Campanhas
  add_to_campaign: "Adicionar à Campanha",
  remove_from_campaign: "Remover da Campanha",
  move_campaign_stage: "Mover Estágio na Campanha",
  send_campaign_message: "Enviar Mensagem da Campanha",
  pause_campaign_sequence: "Pausar Sequência da Campanha",
  resume_campaign_sequence: "Retomar Sequência da Campanha",
  // Agenda
  create_calendar_event: "Criar Evento no Calendar",
  schedule_meeting: "Agendar Reunião",
  // TinyERP
  create_tinyerp_order: "Criar Pedido TinyERP",
  create_tinyerp_upsell_order: "Criar Pedido Upsell TinyERP",
  // Equipe
  assign_responsible: "Atribuir Responsável",
  assign_sdr: "Atribuir Pré-Venda",
  assign_closer: "Atribuir Vendedor",
  notify_team_member: "Notificar Membro da Equipe",
  // Follow-up
  create_followup: "Criar Follow-up",
  // Checklists
  apply_checklist: "Aplicar Checklist",
  mark_checklist_item: "Marcar Item do Checklist",
  // IA
  generate_ai_message: "Gerar Mensagem com IA",
  summarize_conversation: "Resumir Conversa (IA)",
  evaluate_conversation: "Avaliar Conversa (IA)",
};

export const TRIGGER_LABELS: Record<WorkflowTriggerType, string> = {
  lead_created: "Lead Criado",
  stage_changed: "Mudança de Estágio",
  tag_added: "Tag Adicionada",
  score_reached: "Score Atingido",
  cron: "Agendamento (Cron)",
  lead_replied: "Lead Respondeu",
  lead_no_reply: "Lead Não Respondeu",
  meeting_confirmed: "Reunião Confirmada",
  meeting_not_confirmed: "Reunião Não Confirmada",
  proposal_accepted: "Proposta Aceita",
  proposal_lost: "Proposta Perdida",
  followup_overdue: "Follow-up Vencido",
  webhook_received: "Webhook Recebido",
  lead_assigned: "Lead Atribuído",
  campaign_status_changed: "Status de Campanha Mudou",
  lead_added_to_campaign: "Lead Entrou na Campanha",
  lead_removed_from_campaign: "Lead Saiu da Campanha",
  campaign_lead_replied: "Lead Respondeu na Campanha",
  campaign_lead_no_reply: "Lead Não Respondeu na Campanha",
  campaign_completed: "Lead Concluiu a Campanha",
  field_changed: "Campo do Lead Alterado",
  scheduled_date: "Antes de uma data",
};

export const CONDITION_OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: "Igual a",
  not_equals: "Diferente de",
  contains: "Contém",
  not_contains: "Não contém",
  greater_than: "Maior que",
  less_than: "Menor que",
  greater_or_equal: "Maior ou igual a",
  less_or_equal: "Menor ou igual a",
  is_empty: "Está vazio",
  is_not_empty: "Não está vazio",
  has_tag: "Tem a tag",
  not_has_tag: "Não tem a tag",
  in_stage: "Está no estágio",
  not_in_stage: "Não está no estágio",
  starts_with: "Começa com",
  ends_with: "Termina com",
  in_list: "Está na lista",
  not_in_list: "Não está na lista",
  is_true: "É verdadeiro",
  is_false: "É falso",
  regex_match: "Regex (padrão)",
};

// =====================================================
// ACTION CATEGORIES (para UI de seleção agrupada)
// =====================================================

export interface ActionCategory {
  label: string;
  actions: WorkflowActionType[];
}

export const ACTION_CATEGORIES: ActionCategory[] = [
  {
    label: "Comunicação",
    actions: [
      "send_whatsapp",
      "send_whatsapp_audio",
      "send_whatsapp_image",
      "send_whatsapp_video",
      "send_whatsapp_sticker",
      "send_whatsapp_document",
      "send_whatsapp_template",
      "send_whatsapp_menu",
      "send_whatsapp_pix_button",
      "send_meta_message",
      "send_semi_automatic",
      "send_to_number",
    ],
  },
  {
    label: "Lead",
    actions: [
      "move_stage",
      "add_tag",
      "remove_tag",
      "update_lead_field",
      "update_custom_field",
      "update_rating",
      "calculate_score",
      "duplicate_to_pipe",
      "remove_from_pipe",
      "mark_as_lost",
      "apply_checklist",
      "mark_checklist_item",
    ],
  },
  {
    label: "Campanhas",
    actions: ["add_to_campaign", "remove_from_campaign", "move_campaign_stage", "send_campaign_message", "pause_campaign_sequence", "resume_campaign_sequence"],
  },
  {
    label: "Agenda",
    actions: ["create_calendar_event", "schedule_meeting"],
  },
  {
    label: "TinyERP",
    actions: ["create_tinyerp_order", "create_tinyerp_upsell_order"],
  },
  {
    label: "Equipe",
    actions: ["assign_responsible", "notify_team_member"],
  },
  {
    label: "Follow-up",
    actions: ["create_followup"],
  },
  {
    label: "Inteligência Artificial",
    actions: ["generate_ai_message", "summarize_conversation", "evaluate_conversation"],
  },
];

/**
 * Feature flag (organizations.feature_flags) que libera o node unificado
 * "Enviar Mensagem" (ADR-0012). Rollout por org; fail-closed.
 */
export const UNIFIED_MESSAGE_NODE_FLAG = "unified_message_node";

/** Os 6 envios WhatsApp colapsados pelo node unificado quando a flag está ON. */
const LEGACY_WHATSAPP_SEND_ACTIONS: WorkflowActionType[] = [
  "send_whatsapp",
  "send_whatsapp_audio",
  "send_whatsapp_image",
  "send_whatsapp_video",
  "send_whatsapp_sticker",
  "send_whatsapp_menu",
  "send_whatsapp_pix_button",
];

/**
 * Categorias do picker conforme a flag do node unificado.
 * - OFF (default / fail-closed): lista legada, exatamente como antes.
 * - ON: os 7 envios viram a única entrada `send_whatsapp_message`.
 * Os labels legados seguem em ACTION_LABELS para nós já salvos.
 */
export function getActionCategories(unifiedEnabled: boolean): ActionCategory[] {
  if (!unifiedEnabled) return ACTION_CATEGORIES;
  return ACTION_CATEGORIES.map((cat) =>
    cat.label !== "Comunicação"
      ? cat
      : {
          ...cat,
          actions: [
            "send_whatsapp_message",
            ...cat.actions.filter((a) => !LEGACY_WHATSAPP_SEND_ACTIONS.includes(a)),
          ],
        },
  );
}

// =====================================================
// TRIGGER CATEGORIES (para UI de seleção agrupada)
// =====================================================

export interface TriggerCategory {
  label: string;
  triggers: WorkflowTriggerType[];
}

// =====================================================
// WORKFLOW VARIABLES (for UI + documentation)
// =====================================================

export interface WorkflowVariable {
  key: string;
  label: string;
  category: string;
}

export const WORKFLOW_VARIABLES: WorkflowVariable[] = [
  // Lead
  { key: "{{nome}}",          label: "Nome do lead",                  category: "Lead" },
  { key: "{{empresa}}",       label: "Empresa",                       category: "Lead" },
  { key: "{{email}}",         label: "Email",                         category: "Lead" },
  { key: "{{telefone}}",      label: "Telefone",                      category: "Lead" },
  { key: "{{faturamento}}",   label: "Faturamento",                   category: "Lead" },
  { key: "{{segmento}}",      label: "Segmento",                      category: "Lead" },
  { key: "{{score}}",         label: "Score de qualificação",         category: "Lead" },
  { key: "{{rating}}",        label: "Rating (estrelas)",             category: "Lead" },
  { key: "{{origem}}",        label: "Origem do lead",                category: "Lead" },
  { key: "{{urgencia}}",      label: "Urgência",                      category: "Lead" },
  { key: "{{observacoes}}",   label: "Observações",                   category: "Lead" },
  // Pipeline
  { key: "{{estagio}}",       label: "Estágio atual no funil",        category: "Pipeline" },
  { key: "{{data_reuniao}}",  label: "Data da reunião",               category: "Pipeline" },
  { key: "{{valor_proposta}}",label: "Valor da proposta",             category: "Pipeline" },
  // Responsável
  { key: "{{responsavel}}",            label: "Nome do responsável",          category: "Responsável" },
  { key: "{{responsavel_telefone}}",   label: "Telefone do responsável",      category: "Responsável" },
  { key: "{{sdr}}",                    label: "SDR (legado)",                 category: "Responsável" },
  { key: "{{closer}}",                 label: "Vendedor (legado)",            category: "Responsável" },
  // Campanha
  { key: "{{campanha_nome}}",    label: "Nome da campanha",    category: "Campanha" },
  { key: "{{campanha_estagio}}", label: "Estágio na campanha", category: "Campanha" },
  // I.A.
  { key: "{{ai_resumo}}",        label: "Resumo da conversa (I.A.)",       category: "I.A." },
  { key: "{{ai_sentimento}}",    label: "Sentimento (positive/neutral/negative)", category: "I.A." },
  { key: "{{ai_temperatura}}",   label: "Temperatura do lead (cold/warm/hot)",    category: "I.A." },
  { key: "{{ai_proxima_acao}}",  label: "Próxima ação sugerida (I.A.)",    category: "I.A." },
  // Personalizado + Tags: injetados dinamicamente em VariableInserter via
  // useLeadCustomFields() / useTags() (categorias "Campos Personalizados" e "Tags").
  // Sistema
  { key: "{{saudacao}}",          label: "Saudação (Bom dia/Boa tarde/Boa noite)", category: "Sistema" },
  { key: "{{data_hoje}}",         label: "Data de hoje",           category: "Sistema" },
  { key: "{{hora_atual}}",        label: "Hora atual",             category: "Sistema" },
  { key: "{{nome_empresa_crm}}", label: "Nome da sua empresa",    category: "Sistema" },
];

export const TRIGGER_CATEGORIES: TriggerCategory[] = [
  {
    label: "Lead",
    triggers: ["lead_created", "lead_assigned", "field_changed", "score_reached", "tag_added"],
  },
  {
    label: "Comunicação",
    triggers: ["lead_replied", "lead_no_reply"],
  },
  {
    label: "Pipeline",
    triggers: ["stage_changed", "meeting_confirmed", "meeting_not_confirmed", "scheduled_date", "proposal_accepted", "proposal_lost"],
  },
  {
    label: "Campanhas",
    triggers: ["campaign_status_changed", "lead_added_to_campaign", "lead_removed_from_campaign", "campaign_lead_replied", "campaign_lead_no_reply", "campaign_completed"],
  },
  {
    label: "Automação",
    triggers: ["followup_overdue", "cron", "webhook_received"],
  },
];
