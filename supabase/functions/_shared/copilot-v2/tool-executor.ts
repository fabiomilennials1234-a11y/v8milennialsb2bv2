/**
 * tool-executor — Copilot v2 DB-backed tool execution (Slice 3 integration).
 *
 * Dispatches a tool call to its handler. INVARIANT: organization_id ALWAYS comes
 * from the trusted ToolContext (resolved by the worker from the instance/secret),
 * NEVER from the LLM-provided args — a tool arg named organization_id is ignored.
 *
 * Tools whose backing table belongs to a later slice (search_knowledge →
 * copilot_v2_knowledge, set_qualification_tier → copilot_v2_rubric, send_media →
 * copilot_v2_send_media, plus get_contact_status/list_custom_fields which need
 * extra sourcing) throw `not_implemented` until that slice lands — honest, never
 * a silent no-op (the v1 NOOP-action bug class).
 */

import { TOOL_REGISTRY } from "./tool-registry.ts";

export interface ToolContext {
  organizationId: string;
  leadId?: string | null;
  conversationId?: string | null;
  canonicalPhone?: string | null;
}

export type ToolErrorCode = "unknown_tool" | "not_implemented" | "missing_context";

export class ToolError extends Error {
  constructor(public code: ToolErrorCode, public tool: string) {
    super(`${code}: ${tool}`);
    this.name = "ToolError";
  }
}

type Handler = (supabase: any, ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown>;

// ── Read / introspect handlers (unblocked against existing schema) ──

const getLead360: Handler = async (supabase, ctx) => {
  let query = supabase
    .from("leads")
    .select("id, name, company, email, phone, segment, faturamento, urgency, rating, origin, qualification_tier, qualification_score, responsible_id, sale_responsible_id, pre_sale_responsible_id")
    .eq("organization_id", ctx.organizationId)
    .is("deleted_at", null);
  query = ctx.leadId
    ? query.eq("id", ctx.leadId)
    : query.eq("normalized_phone", ctx.canonicalPhone ?? "__none__");
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`get_lead_360: ${error.message}`);
  return data;
};

const listPipelineStages: Handler = async (supabase, ctx, args) => {
  let query = supabase
    .from("pipeline_stages")
    .select("stage_key, name, position, is_final_positive, is_final_negative")
    .eq("organization_id", ctx.organizationId)
    .eq("is_active", true);
  if (typeof args.pipe === "string") query = query.eq("pipeline_type", args.pipe);
  const { data, error } = await query.order("position", { ascending: true });
  if (error) throw new Error(`list_pipeline_stages: ${error.message}`);
  return data ?? [];
};

const getConversationHistory: Handler = async (supabase, ctx, args) => {
  let conversationId = ctx.conversationId ?? null;
  if (!conversationId) {
    if (!ctx.leadId) throw new ToolError("missing_context", "get_conversation_history");
    const { data: conv } = await supabase
      .from("conversations")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("lead_id", ctx.leadId)
      .maybeSingle();
    conversationId = conv?.id ?? null;
  }
  if (!conversationId) return [];
  const limit = typeof args.limit === "number" ? args.limit : 20;
  const { data, error } = await supabase
    .from("conversation_messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`get_conversation_history: ${error.message}`);
  return data ?? [];
};

// ── Write handlers (gated by capability + write-after-introspect upstream) ──

const SYSTEM_PIPE_TABLE: Record<string, string> = {
  whatsapp: "pipe_whatsapp",
  confirmacao: "pipe_confirmacao",
  propostas: "pipe_propostas",
};

const moveLeadStage: Handler = async (supabase, ctx, args) => {
  const pipe = String(args.pipe ?? "whatsapp");
  const table = SYSTEM_PIPE_TABLE[pipe];
  // Custom pipelines store stage on custom_pipe_entries.stage_id (FK) — later slice.
  if (!table) throw new ToolError("not_implemented", `move_lead_stage:${pipe}`);
  if (!ctx.leadId) throw new ToolError("missing_context", "move_lead_stage");
  const stage = String(args.stage ?? "");
  if (!stage) throw new ToolError("missing_context", "move_lead_stage:stage");
  const { error } = await supabase
    .from(table)
    .update({ status: stage, updated_at: new Date().toISOString() })
    .eq("organization_id", ctx.organizationId)
    .eq("lead_id", ctx.leadId);
  if (error) throw new Error(`move_lead_stage: ${error.message}`);
  return { moved: true, pipe, stage };
};

const HANDLERS: Record<string, Handler> = {
  get_lead_360: getLead360,
  list_pipeline_stages: listPipelineStages,
  get_conversation_history: getConversationHistory,
  move_lead_stage: moveLeadStage,
};

/**
 * Builds the executeTool(name, args) the cognition-loop calls. org is bound from
 * ctx; unknown tools throw `unknown_tool`; registered-but-unbuilt tools throw
 * `not_implemented`.
 */
export function createToolExecutor(supabase: any, ctx: ToolContext) {
  return async function executeTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const meta = TOOL_REGISTRY.find((t) => t.name === name);
    if (!meta) throw new ToolError("unknown_tool", name);
    const handler = HANDLERS[name];
    if (!handler) throw new ToolError("not_implemented", name);
    return handler(supabase, ctx, args);
  };
}

/** Tools with a live handler today (the rest are not_implemented until their slice). */
export const IMPLEMENTED_TOOLS = Object.keys(HANDLERS);
