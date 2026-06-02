/**
 * tool-registry — Copilot v2 single source of truth for the agent's tools.
 *
 * Defines the function-calling schemas the LLM sees + each tool's kind (read/
 * write), gating capability, and introspect target arg. This is what keeps the
 * front (schemas) and back (capability-gate, introspect-guard) aligned — the
 * registry, capability-gate, and base prompts must agree on tool names. The
 * actual DB execution lives in the tool executor (integration); this file is
 * pure contract.
 */

export type ToolKind = "read" | "write";

export interface ToolMeta {
  name: string;
  kind: ToolKind;
  description: string;
  /** Capability flag that must be on for a write tool (undefined for reads). */
  capability?: string;
  /** Arg whose value is the introspect target (stage_key/field_key), if any. */
  targetArg?: string;
  parameters: Record<string, unknown>;
}

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: props,
  required,
  additionalProperties: false,
});
const str = (description: string) => ({ type: "string", description });

export const TOOL_REGISTRY: ToolMeta[] = [
  // ── Read / introspect ──
  { name: "get_lead_360", kind: "read", description: "Snapshot do lead no CRM (dados, responsáveis, pipes).", parameters: obj({}) },
  { name: "get_contact_status", kind: "read", description: "Status do contato pelo telefone: NOVO / LEAD_NO_PIPELINE / QUALIFIED / CLIENTE_CARTEIRA.", parameters: obj({}) },
  { name: "get_conversation_history", kind: "read", description: "Histórico recente da conversa.", parameters: obj({ limit: { type: "number" } }) },
  { name: "list_pipeline_stages", kind: "read", description: "Estágios reais e atuais do pipeline (introspecção antes de mover).", parameters: obj({ pipe: str("pipe alvo, opcional") }) },
  { name: "list_custom_fields", kind: "read", description: "Campos do lead reais e atuais (introspecção antes de preencher).", parameters: obj({}) },
  { name: "search_knowledge", kind: "read", description: "Busca híbrida na base de conhecimento da org (catálogo/specs ingeridos como texto).", parameters: obj({ query: str("o que buscar") }, ["query"]) },
  { name: "check_agenda_availability", kind: "read", description: "Horários realmente livres (introspecção antes de agendar).", parameters: obj({ date_range: str("janela desejada") }) },

  // ── Write (gated; every structural write preceded by its introspect read) ──
  { name: "move_lead_stage", kind: "write", capability: "can_move_stage", targetArg: "stage", description: "Move o lead para um estágio que existe (após list_pipeline_stages).", parameters: obj({ stage: str("stage_key alvo"), pipe: str("pipe alvo, opcional") }, ["stage"]) },
  { name: "fill_lead_field", kind: "write", capability: "can_fill_field", targetArg: "field", description: "Grava um campo que existe (após list_custom_fields).", parameters: obj({ field: str("field_key"), value: str("valor") }, ["field", "value"]) },
  { name: "schedule_meeting", kind: "write", capability: "can_schedule_meeting", targetArg: "datetime", description: "Agenda reunião em horário confirmado livre (após check_agenda_availability).", parameters: obj({ datetime: str("ISO 8601 — um dos horários retornados por check_agenda_availability"), title: str("título") }, ["datetime"]) },
  { name: "set_qualification_tier", kind: "write", capability: "can_set_tier", description: "Registra os SINAIS B2B extraídos; a rúbrica determinística decide o tier (o LLM nunca decide).", parameters: obj({ signals: { type: "object", description: "faturamento/volume/recorrencia/urgencia/icp/regiao com evidência" } }, ["signals"]) },
  { name: "send_media", kind: "write", capability: "can_send_media", description: "Envia mídia da biblioteca aprovada (imagem, vídeo ou áudio/ptt) quando o gatilho casa (gate de momento/repetição no harness; entrega via Slice 6).", parameters: obj({ media_id: str("id do item da biblioteca") }, ["media_id"]) },
  { name: "transfer_to_human", kind: "write", capability: "can_transfer", description: "Transfere a conversa para um humano com notificação estruturada (lead/tier/motivo/resumo).", parameters: obj({ reason: str("motivo curto"), summary: str("resumo da conversa") }, ["reason"]) },
  { name: "handoff_to_vendedor", kind: "write", capability: "can_handoff", description: "Passa o lead qualificado ao Vendedor com contexto.", parameters: obj({ summary: str("resumo + sinais") }, ["summary"]) },
];

/** Function-calling schemas the LLM sees. */
export const TOOL_SCHEMAS = TOOL_REGISTRY.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.parameters,
}));

const TARGET_ARG_BY_TOOL: Record<string, string> = Object.fromEntries(
  TOOL_REGISTRY.filter((t) => t.targetArg).map((t) => [t.name, t.targetArg!]),
);

/** Introspect target of a write tool call (stage_key/field_key), or null. */
export function writeTargetOf(name: string, args: Record<string, unknown>): string | null {
  const arg = TARGET_ARG_BY_TOOL[name];
  if (!arg) return null;
  const value = args[arg];
  return typeof value === "string" ? value : null;
}
