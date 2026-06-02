/**
 * tool-executor — Copilot v2 DB-backed tool execution (Slice 3 integration).
 *
 * Dispatches a tool call to its handler. INVARIANT: organization_id ALWAYS comes
 * from the trusted ToolContext (resolved by the worker from the instance/secret),
 * NEVER from the LLM-provided args — a tool arg named organization_id is ignored.
 *
 * Tools whose backing store belongs to a later slice (e.g. a custom-pipe
 * move_lead_stage) throw `not_implemented` until that slice lands — honest,
 * never a silent no-op (the v1 NOOP-action bug class). send_media is now live
 * (Slice 6): it reads ONLY from copilot_v2_send_media (never the knowledge base
 * — separate stores, ADR #12) and returns an explicit fallback on every failure
 * path (never a silent drop — VitrineVET lesson).
 */

import { TOOL_REGISTRY } from "./tool-registry.ts";
import { mapSignalsToTier, type Rubric, type Signals } from "./rubric-engine.ts";
import { generateEmbedding } from "../embeddings.ts";
import { fuseHybridResults, type KnowledgeHit } from "./hybrid-search.ts";
import { RAG_THRESHOLDS } from "./rag-threshold.ts";
import { decideSendMedia, type SendMediaItem } from "./send-media-selector.ts";
import { resolveMediaDelivery, type SendMediaKind } from "./media-mime.ts";
import { computeFreeSlots, decideScheduleSlot } from "./agenda.ts";

export interface ToolContext {
  organizationId: string;
  leadId?: string | null;
  conversationId?: string | null;
  canonicalPhone?: string | null;
  /** The active agent for this turn (needed to load its rubric). */
  agentId?: string | null;
  /**
   * I/O sink for the actual WhatsApp delivery (injected by the worker). Pure
   * tests pass a fake. Absent → send_media returns a fallback (never throws into
   * a silent drop). Returns the provider's send result.
   */
  sendMediaViaProvider?: (p: {
    number: string; type: "image" | "video" | "audio"; file: string;
    caption?: string; mediaId: string;
  }) => Promise<{ success: boolean; message_id?: string; error?: string }>;
  /** Injected clock (tests pin it); the worker passes new Date(). */
  now?: Date;
  /**
   * Calendar freeBusy I/O (injected by the worker). Pure tests pass a fake.
   * Returns busy intervals for the lead's responsible user, or ok:false when no
   * connected calendar (→ honest no_calendar fallback, never a silent empty).
   */
  getCalendarFreeBusy?: (p: { userId: string; window: { start: string; end: string } }) =>
    Promise<{ ok: boolean; busy: { start: string; end: string }[] }>;
  /** Scheduling I/O sink (injected by the worker) — Task 4. */
  scheduleMeetingViaCalendar?: (p: {
    userId: string; leadId: string; datetime: string; title: string;
  }) => Promise<{ created: boolean; meetLink?: string | null; error?: string }>;
  /** Persists the confirmacao pipe entry (injected; worker backs with pipeline-adapter) — Task 4. */
  upsertConfirmacaoEntry?: (p: { leadId: string; orgId: string; meetingAt: string; meetLink?: string | null }) =>
    Promise<{ pipeId: string | null }>;
  /** Handoff notification dispatch (injected by the worker; infra = Slice 5) — Task 5. */
  dispatchHandoffNotification?: (p: {
    leadId: string; reason: string; summary: string | null; targetArchetype: "vendedor";
  }) => Promise<{ dispatched: boolean; reason?: string }>;
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

const searchKnowledge: Handler = async (supabase, ctx, args) => {
  const query = String(args.query ?? "").trim();
  if (!query) throw new ToolError("missing_context", "search_knowledge:query");

  // Falha de credencial/embedding é NÃO-silenciosa: throw -> o cognition-loop
  // registra como tool error no trace (nunca um "nenhum resultado" enganoso).
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) throw new Error("search_knowledge: OPENROUTER_API_KEY ausente");
  const embedding = await generateEmbedding(query, apiKey);
  if (!embedding || embedding.length === 0) throw new Error("search_knowledge: embedding vazio");

  // RPC org-scoped — org SEMPRE do ctx, nunca dos args do LLM.
  const { data, error } = await supabase.rpc("copilot_v2_match_knowledge", {
    query_embedding: `[${embedding.join(",")}]`,
    p_org_id: ctx.organizationId,
    query_text: query,
    match_count: 8,
    similarity_threshold: RAG_THRESHOLDS.doc,
  });
  if (error) throw new Error(`search_knowledge: ${error.message}`);

  const rows = (data ?? []) as Array<{ id: number; content: string; similarity: number; source: string }>;
  const semantic: KnowledgeHit[] = rows.filter((r) => r.source === "semantic");
  const keyword: KnowledgeHit[] = rows.filter((r) => r.source === "keyword");
  const fused = fuseHybridResults(semantic, keyword, { docThreshold: RAG_THRESHOLDS.doc, limit: 5 });

  if (fused.length === 0) return `Nenhuma informação encontrada na base para: "${query}"`;
  return ["=== BASE DE CONHECIMENTO ===", ...fused.map((h) => h.content)].join("\n\n");
};

/** Parse "<ISO>/<ISO>" (date_range) → window; default = próximas 48h. */
function parseWindow(dateRange: unknown, now: Date): { start: string; end: string } {
  if (typeof dateRange === "string" && dateRange.includes("/")) {
    const [start, end] = dateRange.split("/");
    if (!isNaN(new Date(start).getTime()) && !isNaN(new Date(end).getTime())) return { start, end };
  }
  return { start: now.toISOString(), end: new Date(now.getTime() + 48 * 3600_000).toISOString() };
}

async function resolveResponsibleUserId(supabase: any, ctx: ToolContext): Promise<string | null> {
  if (!ctx.leadId) return null;
  const { data: lead } = await supabase
    .from("leads").select("responsible_id, sdr_id")
    .eq("organization_id", ctx.organizationId).eq("id", ctx.leadId).maybeSingle();
  return lead?.responsible_id ?? lead?.sdr_id ?? null;
}

const checkAgendaAvailability: Handler = async (supabase, ctx, args) => {
  const now = ctx.now ?? new Date();
  const userId = await resolveResponsibleUserId(supabase, ctx);
  if (!userId || !ctx.getCalendarFreeBusy) return { slots: [], reason: "no_calendar" };

  const window = parseWindow(args.date_range, now);
  const fb = await ctx.getCalendarFreeBusy({ userId, window });
  if (!fb.ok) return { slots: [], reason: "no_calendar" };

  const slots = computeFreeSlots({ busy: fb.busy, window, slotMinutes: 60, now });
  return { slots, window, reason: null };
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

const setQualificationTier: Handler = async (supabase, ctx, args) => {
  if (!ctx.agentId) throw new ToolError("missing_context", "set_qualification_tier:agent");
  if (!ctx.leadId) throw new ToolError("missing_context", "set_qualification_tier:lead");

  // The LLM provides SIGNALS; the deterministic rubric decides the tier (ADR #3).
  const { data: rubricRow, error: rubricErr } = await supabase
    .from("copilot_v2_rubric")
    .select("rules")
    .eq("agent_id", ctx.agentId)
    .maybeSingle();
  if (rubricErr) throw new Error(`set_qualification_tier: ${rubricErr.message}`);
  if (!rubricRow) return { applied: false, reason: "no_rubric", tier: null };

  const rubric: Rubric = { rules: Array.isArray(rubricRow.rules) ? rubricRow.rules : [] };
  const tier = mapSignalsToTier((args.signals ?? {}) as Signals, rubric);

  const { error } = await supabase
    .from("leads")
    .update({ qualification_tier: tier, updated_at: new Date().toISOString() })
    .eq("organization_id", ctx.organizationId)
    .eq("id", ctx.leadId);
  if (error) throw new Error(`set_qualification_tier: ${error.message}`);
  return { applied: true, tier, signals: args.signals ?? {} };
};

const CONFIRMACAO_STAGE = "reuniao_marcada";

const scheduleMeeting: Handler = async (supabase, ctx, args) => {
  if (!ctx.leadId) throw new ToolError("missing_context", "schedule_meeting:lead");
  const datetime = String(args.datetime ?? "");
  if (!datetime) throw new ToolError("missing_context", "schedule_meeting:datetime");
  const now = ctx.now ?? new Date();

  // Defesa em profundidade: o introspect-guard (Task 1) já garantiu que o
  // datetime estava nos slots introspectados; aqui revalidamos só passado/ISO
  // (clock-skew) sem re-bater no Calendar — fail-CLOSED com motivo explícito.
  const slot = decideScheduleSlot({ datetime, freeSlots: [datetime], now });
  if (!slot.ok) return { scheduled: false, reason: slot.reason };

  // 1. Grava o pipe_confirmacao (sempre — o agendamento é o efeito de negócio).
  if (!ctx.upsertConfirmacaoEntry) return { scheduled: false, reason: "no_pipe_writer" };
  const { pipeId } = await ctx.upsertConfirmacaoEntry({
    leadId: ctx.leadId, orgId: ctx.organizationId, meetingAt: datetime,
  });

  // 2. Google Calendar — GRACEFUL: falha NÃO desfaz o agendamento (só sem link).
  let meetLink: string | null = null;
  let calendar: "ok" | "failed" | "skipped" = "skipped";
  if (ctx.scheduleMeetingViaCalendar) {
    const userId = await resolveResponsibleUserId(supabase, ctx);
    if (userId) {
      const res = await ctx.scheduleMeetingViaCalendar({
        userId, leadId: ctx.leadId, datetime, title: String(args.title ?? "Reunião"),
      });
      if (res.created) { meetLink = res.meetLink ?? null; calendar = "ok"; }
      else calendar = "failed";
    }
  }

  return { scheduled: true, stage: CONFIRMACAO_STAGE, pipeId, meetLink, calendar, datetime };
};

const QUALIFIED_TIERS = ["diamante", "ouro", "prata", "bronze"];

const getContactStatus: Handler = async (supabase, ctx) => {
  let leadQ = supabase.from("leads").select("id, qualification_tier")
    .eq("organization_id", ctx.organizationId).is("deleted_at", null);
  leadQ = ctx.leadId ? leadQ.eq("id", ctx.leadId) : leadQ.eq("normalized_phone", ctx.canonicalPhone ?? "__none__");
  const { data: lead, error } = await leadQ.maybeSingle();
  if (error) throw new Error(`get_contact_status: ${error.message}`);
  if (!lead) return { status: "NOVO", leadId: null };

  // Carteira = existing customer in the portfolio (upsell_clients).
  const { data: client } = await supabase
    .from("upsell_clients").select("id")
    .eq("organization_id", ctx.organizationId).eq("lead_id", lead.id).maybeSingle();
  if (client) return { status: "CLIENTE_CARTEIRA", leadId: lead.id };

  if (lead.qualification_tier && QUALIFIED_TIERS.includes(lead.qualification_tier)) {
    return { status: "QUALIFIED", leadId: lead.id };
  }
  return { status: "LEAD_NO_PIPELINE", leadId: lead.id };
};

const listCustomFields: Handler = async (supabase, ctx) => {
  const { data, error } = await supabase
    .from("lead_custom_fields")
    .select("field_name, field_type, is_required")
    .eq("organization_id", ctx.organizationId)
    .order("display_order", { ascending: true });
  if (error) throw new Error(`list_custom_fields: ${error.message}`);
  // field_name is the introspect target the write-guard checks against.
  return (data ?? []).map((f: any) => ({ field: f.field_name, type: f.field_type, required: f.is_required }));
};

const transferToHuman: Handler = async (supabase, ctx, args) => {
  if (!ctx.canonicalPhone) throw new ToolError("missing_context", "transfer_to_human:phone");
  const reason = String(args.reason ?? "transfer");
  // Critical (sensitive path): pause the agent phone-keyed so it goes silent for
  // the human takeover. This is the security-essential part and is verified.
  const until = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const { error } = await supabase.rpc("copilot_v2_set_human_pause", {
    p_org_id: ctx.organizationId, p_canonical_phone: ctx.canonicalPhone, p_until: until, p_reason: `transfer:${reason}`,
  });
  if (error) throw new Error(`transfer_to_human: ${error.message}`);
  // The structured notification dispatch (WhatsApp + in-app, to the configured
  // handoff target) is the outbound layer (needs target-user from config) — not
  // done here. We return the structured payload for that layer to consume.
  return {
    transferred: true,
    reason,
    paused_until: until,
    handoff: { leadId: ctx.leadId ?? null, reason, summary: args.summary ?? null },
  };
};

const fillLeadField: Handler = async (supabase, ctx, args) => {
  if (!ctx.leadId) throw new ToolError("missing_context", "fill_lead_field:lead");
  const field = String(args.field ?? "");
  if (!field) throw new ToolError("missing_context", "fill_lead_field:field");

  // Resolve the custom-field definition (introspect target the write-guard checks).
  const { data: def, error: defErr } = await supabase
    .from("lead_custom_fields").select("id")
    .eq("organization_id", ctx.organizationId).eq("field_name", field).maybeSingle();
  if (defErr) throw new Error(`fill_lead_field: ${defErr.message}`);
  if (!def) return { filled: false, reason: "unknown_field", field };

  // Safe upsert — lead_custom_field_values has a unique (lead_id, field_id).
  const { error } = await supabase
    .from("lead_custom_field_values")
    .upsert(
      { lead_id: ctx.leadId, field_id: def.id, value: String(args.value ?? ""), updated_at: new Date().toISOString() },
      { onConflict: "lead_id,field_id" },
    );
  if (error) throw new Error(`fill_lead_field: ${error.message}`);
  return { filled: true, field };
};

const SEND_MEDIA_BUCKET = "copilot-v2-send-media";

const sendMedia: Handler = async (supabase, ctx, args) => {
  if (!ctx.canonicalPhone) throw new ToolError("missing_context", "send_media:phone");
  const mediaId = String(args.media_id ?? "");
  if (!mediaId) throw new ToolError("missing_context", "send_media:media_id");

  // 1. Resolve o item — org SEMPRE do ctx, nunca dos args/LLM.
  const { data: item, error } = await supabase
    .from("copilot_v2_send_media")
    .select("id, organization_id, kind, storage_path, is_active, mime_type")
    .eq("organization_id", ctx.organizationId)
    .eq("id", mediaId)
    .maybeSingle();
  if (error) throw new Error(`send_media: ${error.message}`);

  // 2. Já-enviados nesta conversa (anti-repetição) — gate de momento/repetição.
  let alreadySent: string[] = [];
  if (ctx.conversationId) {
    const { data: prior } = await supabase
      .from("copilot_v2_trace_steps")
      .select("meta")
      .eq("step", "send_media");
    alreadySent = (prior ?? [])
      .map((r: any) => r?.meta?.media_id)
      .filter((x: any): x is string => typeof x === "string");
  }

  // 3. Gate puro (fail-CLOSED) — bloqueio devolve motivo EXPLÍCITO, sem silent-drop.
  const gate = decideSendMedia({
    orgId: ctx.organizationId,
    item: (item as SendMediaItem | null),
    alreadySentMediaIds: alreadySent,
  });
  if (!gate.allowed) return { sent: false, reason: gate.reason };

  // 4. Valida MIME/messageType (heurística única).
  const delivery = resolveMediaDelivery(item.kind as SendMediaKind, item.mime_type);
  if (!delivery.valid || !delivery.messageType) return { sent: false, reason: "invalid_mime" };

  // 5. Signed URL (1h) — bucket PRIVADO, nunca link público.
  const { data: signed, error: urlErr } = await supabase.storage
    .from(SEND_MEDIA_BUCKET).createSignedUrl(item.storage_path, 3600);
  if (urlErr || !signed?.signedUrl) return { sent: false, reason: "signed_url_failed" };

  // 6. Entrega real é I/O injetada (ausente em teste/contexto sem provider).
  if (!ctx.sendMediaViaProvider) return { sent: false, reason: "no_provider" };
  const res = await ctx.sendMediaViaProvider({
    number: ctx.canonicalPhone, type: delivery.messageType, file: signed.signedUrl, mediaId: item.id,
  });
  if (!res.success) return { sent: false, reason: res.error ?? "provider_failed", media_id: item.id };

  return { sent: true, media_id: item.id, kind: item.kind, message_id: res.message_id ?? null };
};

const HANDLERS: Record<string, Handler> = {
  get_lead_360: getLead360,
  list_pipeline_stages: listPipelineStages,
  get_conversation_history: getConversationHistory,
  get_contact_status: getContactStatus,
  list_custom_fields: listCustomFields,
  check_agenda_availability: checkAgendaAvailability,
  search_knowledge: searchKnowledge,
  move_lead_stage: moveLeadStage,
  set_qualification_tier: setQualificationTier,
  schedule_meeting: scheduleMeeting,
  fill_lead_field: fillLeadField,
  transfer_to_human: transferToHuman,
  send_media: sendMedia,
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
