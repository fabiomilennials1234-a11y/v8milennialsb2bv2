/**
 * Trilha 3.B / T3B.2 — Context Loader (extracted from agent-engine.ts)
 *
 * Responsabilidades:
 *   - loadCapabilities(supabase, orgId, leadId?) — busca agente roteado
 *     (stage > origin > segment > default > any active) com cache LRU
 *   - Cache invalidation manual via bustCapabilitiesCache(orgId, leadId?)
 *
 * Cache strategy:
 *   - Key: `${orgId}|${leadId ?? 'default'}` — leadId pq routing depende de
 *     stage/origin/segment do lead
 *   - TTL: 5min — burst de mensagens do mesmo lead reusa, mudança config
 *     refletida em <5min
 *   - MAX: 200 entries — eviction LRU simples (Map preserva ordem inserção)
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPipeEntry, getPipeEntriesByLeads } from "../pipeline-adapter.ts";

const SELECT_AGENT = "*, copilot_agent_faqs(*), copilot_agent_kanban_rules(*)";

// ─── Cache infra ─────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 200;
const cache = new Map<string, CacheEntry<unknown>>();

function cacheKey(orgId: string, leadId?: string): string {
  return `${orgId}|${leadId ?? "default"}`;
}

export function getCachedCapabilities<T>(orgId: string, leadId?: string): T | null {
  const entry = cache.get(cacheKey(orgId, leadId));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(cacheKey(orgId, leadId));
    return null;
  }
  return entry.value as T;
}

export function setCachedCapabilities<T>(orgId: string, leadId: string | undefined, value: T): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(cacheKey(orgId, leadId), { value, expiresAt: Date.now() + TTL_MS });
}

export function bustCapabilitiesCache(orgId: string, leadId?: string): void {
  cache.delete(cacheKey(orgId, leadId));
}

export function clearCapabilitiesCache(): void {
  cache.clear();
}

export function getCacheStats(): { size: number; maxEntries: number; ttlMs: number } {
  return { size: cache.size, maxEntries: MAX_ENTRIES, ttlMs: TTL_MS };
}

// ─── loadCapabilities (extracted) ────────────────────────────────────────────

/**
 * Busca agente roteado pra atender lead. Prioridade:
 *   1. Routing por stage (overlaps routing_stages do agente vs stages ativas do lead)
 *   2. Routing por origin
 *   3. Routing por segment
 *   4. Default agent da org
 *   5. Qualquer agente ativo (último criado)
 *
 * Retorna `null` se org não tem agente ativo nenhum.
 *
 * Cache: hit retorna imediato. Miss faz queries paralelas + popula cache.
 * Bypass cache: useCache=false (útil em testes ou pós bust manual).
 */
function agentRejectsLead(
  agent: Record<string, unknown>,
  leadOrigin?: string,
): boolean {
  if (!leadOrigin) return false;
  const origins = agent.routing_origins as string[] | null;
  if (!origins || origins.length === 0) return false;
  return !origins.includes(leadOrigin);
}

export async function loadCapabilities(
  supabase: SupabaseClient,
  organizationId: string,
  leadId?: string,
  opts: { useCache?: boolean } = {},
): Promise<Record<string, unknown> | null> {
  const useCache = opts.useCache !== false;

  if (useCache) {
    const cached = getCachedCapabilities<Record<string, unknown>>(organizationId, leadId);
    if (cached) {
      console.log("[context-loader] cache HIT", { orgId: organizationId, leadId });
      return cached;
    }
  }

  let leadOrigin: string | undefined;

  // Routing por stage/origin/segment requer leadId
  if (leadId) {
    try {
      // ADR-0023 §10: o funil WhatsApp entra pelo NEGÓCIO (`pipeline_entries`), igual
      // confirmação e propostas. `leads.pipe_whatsapp` é espelho legado e não roteia mais.
      const [leadRes, upsellRes, whatsappRes, confirmacaoRes, propostasRes, campanhaRes] = await Promise.all([
        supabase.from("leads").select("origin, segment").eq("id", leadId).maybeSingle(),
        supabase.from("upsell_clients").select("tipo_cliente_tempo, gestao_stage").eq("lead_id", leadId).maybeSingle(),
        getPipeEntry(supabase, leadId, organizationId, "whatsapp"),
        getPipeEntry(supabase, leadId, organizationId, "confirmacao"),
        getPipeEntry(supabase, leadId, organizationId, "propostas"),
        supabase.from("campanha_leads").select("stage_id, campanha_stages(name)").eq("lead_id", leadId).limit(1).maybeSingle(),
      ]);

      const leadRow = leadRes.data as { origin?: string; segment?: string } | null;
      const upsellRow = upsellRes.data as { tipo_cliente_tempo?: string; gestao_stage?: string } | null;
      const whatsappRow = whatsappRes ? { status: whatsappRes.stage_key } : null;
      const confirmacaoRow = confirmacaoRes ? { status: confirmacaoRes.stage_key } : null;
      const propostasRow = propostasRes ? { status: propostasRes.stage_key } : null;
      const campanhaRow = campanhaRes.data as { campanha_stages?: { name?: string } } | null;

      leadOrigin = leadRow?.origin;

      if (leadRow || upsellRow || whatsappRow || confirmacaoRow || propostasRow || campanhaRow) {
        const allStages: string[] = [];
        if (whatsappRow?.status) allStages.push(whatsappRow.status);
        if (upsellRow?.tipo_cliente_tempo) allStages.push(upsellRow.tipo_cliente_tempo);
        if (upsellRow?.gestao_stage) allStages.push(upsellRow.gestao_stage);
        if (confirmacaoRow?.status) allStages.push(confirmacaoRow.status);
        if (propostasRow?.status) allStages.push(propostasRow.status);
        const campanhaStage = campanhaRow?.campanha_stages?.name;
        if (campanhaStage) allStages.push(campanhaStage);

        const [stageResult, originResult, segmentResult] = await Promise.all([
          allStages.length > 0
            ? supabase.from("copilot_agents").select(SELECT_AGENT).eq("organization_id", organizationId).eq("is_active", true).overlaps("routing_stages", allStages).maybeSingle()
            : Promise.resolve({ data: null }),
          leadRow?.origin
            ? supabase.from("copilot_agents").select(SELECT_AGENT).eq("organization_id", organizationId).eq("is_active", true).contains("routing_origins", [leadRow.origin]).maybeSingle()
            : Promise.resolve({ data: null }),
          leadRow?.segment
            ? supabase.from("copilot_agents").select(SELECT_AGENT).eq("organization_id", organizationId).eq("is_active", true).contains("routing_segments", [leadRow.segment]).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);

        const routedAgent = stageResult.data || originResult.data || segmentResult.data;
        if (routedAgent) {
          const routeType = stageResult.data ? "etapa" : originResult.data ? "origem" : "segmento";
          console.log(`[context-loader] routed by ${routeType}`, { agentId: (routedAgent as Record<string, unknown>).id, stages: allStages });
          if (useCache) setCachedCapabilities(organizationId, leadId, routedAgent);
          return routedAgent as Record<string, unknown>;
        }
      }
    } catch (e) {
      console.warn("[context-loader] routing lookup failed (non-fatal):", e);
    }
  }

  // Fallback 1: default
  const { data: defaultAgent } = await supabase
    .from("copilot_agents")
    .select(SELECT_AGENT)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .eq("is_default", true)
    .maybeSingle();

  if (defaultAgent && !agentRejectsLead(defaultAgent as Record<string, unknown>, leadOrigin)) {
    console.log("[context-loader] using default agent", { agentId: (defaultAgent as Record<string, unknown>).id });
    if (useCache) setCachedCapabilities(organizationId, leadId, defaultAgent);
    return defaultAgent as Record<string, unknown>;
  }

  // Fallback 2: qualquer ativo (mais recente) — respeitando routing_origins
  console.warn("[context-loader] no default agent, trying any active");
  const { data: anyAgent } = await supabase
    .from("copilot_agents")
    .select(SELECT_AGENT)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (anyAgent && !agentRejectsLead(anyAgent as Record<string, unknown>, leadOrigin)) {
    console.log("[context-loader] using fallback active agent", { agentId: (anyAgent as Record<string, unknown>).id });
    if (useCache) setCachedCapabilities(organizationId, leadId, anyAgent);
    return anyAgent as Record<string, unknown>;
  }

  if (anyAgent && leadOrigin) {
    console.log("[context-loader] agent rejected lead origin", { agentId: (anyAgent as Record<string, unknown>).id, leadOrigin });
  }

  console.error("[context-loader] no active agents for org:", organizationId);
  return null;
}

// ─── Org-level loaders (extracted from agent-engine.ts) ──────────────────────

/**
 * Carrega custom fields da org pra injeção no prompt.
 */
export async function loadOrgCustomFields(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<{ field_name: string }[]> {
  try {
    const { data, error } = await supabase
      .from("lead_custom_fields")
      .select("field_name")
      .eq("organization_id", organizationId)
      .order("display_order", { ascending: true });
    if (error) {
      console.warn("[context-loader] loadOrgCustomFields error:", error.message);
      return [];
    }
    return (data ?? []) as { field_name: string }[];
  } catch (e) {
    console.warn("[context-loader] loadOrgCustomFields exception:", e);
    return [];
  }
}

/**
 * Carrega stages de TODOS os pipelines ativos da org.
 */
export async function loadPipelineStages(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<{ stage_key: string; name: string; pipeline_type: string }[]> {
  try {
    const { data, error } = await supabase
      .from("pipeline_stages")
      .select("stage_key, name, pipeline_type")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("pipeline_type", { ascending: true })
      .order("position", { ascending: true });
    if (error) {
      console.warn("[context-loader] loadPipelineStages error:", error.message);
      return [];
    }
    return (data ?? []) as { stage_key: string; name: string; pipeline_type: string }[];
  } catch (e) {
    console.warn("[context-loader] loadPipelineStages exception:", e);
    return [];
  }
}

// ─── ConversationContextSummary (extracted type) ─────────────────────────────

export interface ConversationContextSummary {
  lastTopic?: string;
  lastIntent?: string;
  keyPoints: string[];
  objectionsRaised: string[];
  questionsAsked: string[];
  nextAction?: string;
  qualificationData: Record<string, unknown>;
  leadTemperature: "cold" | "warm" | "hot";
  engagementScore: number;
  lastMessageAt?: string;
  messageCount: number;
  followupCount: number;
}

/**
 * Default context quando não há histórico.
 */
export function getDefaultContext(): ConversationContextSummary {
  return {
    keyPoints: [],
    objectionsRaised: [],
    questionsAsked: [],
    qualificationData: {},
    leadTemperature: "cold",
    engagementScore: 0,
    messageCount: 0,
    followupCount: 0,
  };
}

/**
 * Carrega contexto resumido da última conversa do lead pra personalizar
 * follow-ups. Tenta cache em conversation_context_summary, fallback retorna
 * default (extração de mensagens fica no caller — função pesada).
 */
export async function loadConversationContextSummary(
  supabase: SupabaseClient,
  leadId: string,
): Promise<ConversationContextSummary | null> {
  try {
    const { data: existingContext, error: contextError } = await supabase
      .from("conversation_context_summary")
      .select("*")
      .eq("lead_id", leadId)
      .maybeSingle();

    if (existingContext && !contextError) {
      const ec = existingContext as Record<string, unknown>;
      return {
        lastTopic: ec.last_topic as string | undefined,
        lastIntent: ec.last_intent as string | undefined,
        keyPoints: (ec.key_points as string[]) ?? [],
        objectionsRaised: (ec.objections_raised as string[]) ?? [],
        questionsAsked: (ec.questions_asked as string[]) ?? [],
        nextAction: ec.next_action as string | undefined,
        qualificationData: (ec.qualification_data as Record<string, unknown>) ?? {},
        leadTemperature: (ec.lead_temperature as "cold" | "warm" | "hot") ?? "cold",
        engagementScore: (ec.engagement_score as number) ?? 0,
        lastMessageAt: ec.last_message_at as string | undefined,
        messageCount: (ec.message_count as number) ?? 0,
        followupCount: (ec.followup_count as number) ?? 0,
      };
    }

    return null;
  } catch (e) {
    console.warn("[context-loader] loadConversationContextSummary exception:", e);
    return null;
  }
}

/**
 * Carrega catálogo de produtos da org (ativos + materiais).
 * Retorna string formatada pra injeção no prompt.
 */
export async function loadProductCatalog(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<string> {
  try {
    const { data: products, error } = await supabase
      .from("products")
      .select("id, name, type, description, ticket, ticket_minimo, entregaveis, materiais, links")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("name");

    if (error || !products?.length) return "";

    const productIds = (products as Array<{ id: string }>).map((p) => p.id);
    const { data: materials } = await supabase
      .from("product_materials")
      .select("id, product_id, file_name, material_type, summary, file_path")
      .in("product_id", productIds)
      .eq("is_active", true);

    type Material = { id: string; product_id: string; file_name: string; material_type: string };
    const materialsByProduct = new Map<string, Material[]>();
    for (const m of (materials ?? []) as Material[]) {
      const list = materialsByProduct.get(m.product_id) ?? [];
      list.push(m);
      materialsByProduct.set(m.product_id, list);
    }

    const typeLabels: Record<string, string> = { mrr: "Recorrência", projeto: "Projeto", unitario: "Unitário" };

    const lines = (products as Array<{ id: string; name: string; type: string; description?: string; ticket?: number; ticket_minimo?: number; entregaveis?: string }>).map((p) => {
      const parts: string[] = [];
      parts.push(`Produto: "${p.name}"`);
      parts.push(`Tipo: ${typeLabels[p.type] ?? p.type}`);
      if (p.ticket) parts.push(`Ticket: R$ ${p.ticket.toLocaleString("pt-BR")}`);
      if (p.ticket_minimo) parts.push(`Ticket mínimo: R$ ${p.ticket_minimo.toLocaleString("pt-BR")}`);
      if (p.description) parts.push(`Descrição: ${p.description}`);
      if (p.entregaveis) parts.push(`Entregáveis: ${p.entregaveis}`);

      const mats = materialsByProduct.get(p.id) ?? [];
      if (mats.length > 0) {
        parts.push("Materiais disponíveis para envio:");
        for (const m of mats) {
          parts.push(`  - "${m.file_name}" (id: ${m.id}, tipo: ${m.material_type}) — use send_product_material para enviar ao lead`);
        }
      }
      return parts.join("\n");
    });

    return lines.join("\n\n");
  } catch (e) {
    console.warn("[context-loader] loadProductCatalog exception:", e);
    return "";
  }
}

/**
 * Carrega dados completos do lead: campos básicos + custom fields + dados
 * de todos os pipes (upsell, confirmação, propostas, campanhas).
 * Retorna objeto enriquecido pra injeção no prompt LLM.
 */
export async function loadLeadData(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select(`
        id,
        name,
        phone,
        email,
        company,
        origin,
        rating,
        segment,
        faturamento,
        urgency,
        notes,
        organization_id,
        created_at,
        updated_at
      `)
      .eq("id", leadId)
      .single();

    if (leadError || !lead) {
      if (leadError) console.warn("[context-loader] loadLeadData error:", leadError.message);
      return null;
    }

    const orgId = (lead as Record<string, unknown>).organization_id as string;

    const [customFieldsRes, upsellRes, whatsappEntry, confirmacaoEntry, propostasEntry, campanhaRes] = await Promise.all([
      supabase
        .from("lead_custom_field_values")
        .select(`value, field:lead_custom_fields(id, field_name, field_type)`)
        .eq("lead_id", leadId),
      supabase
        .from("upsell_clients")
        .select("tipo_cliente_tempo, gestao_stage, potencial, is_active")
        .eq("lead_id", leadId)
        .maybeSingle(),
      getPipeEntry(supabase, leadId, orgId, "whatsapp"),
      getPipeEntry(supabase, leadId, orgId, "confirmacao"),
      getPipeEntry(supabase, leadId, orgId, "propostas"),
      supabase
        .from("campanha_leads")
        .select("stage_id, campanha_id, campanha_stages(name)")
        .eq("lead_id", leadId)
        .limit(1)
        .maybeSingle(),
    ]);

    const customFields: Record<string, string> = {};
    const cfData = customFieldsRes.data as Array<{ value?: string; field?: { field_name?: string } }> | null;
    if (cfData && cfData.length > 0) {
      for (const cfv of cfData) {
        if (cfv.field?.field_name && cfv.value) {
          customFields[cfv.field.field_name] = cfv.value;
        }
      }
    }

    const upsellData = upsellRes.data as { tipo_cliente_tempo?: string; gestao_stage?: string; potencial?: string; is_active?: boolean } | null;
    const confMeta = (confirmacaoEntry?.metadata ?? {}) as Record<string, unknown>;
    const propMeta = (propostasEntry?.metadata ?? {}) as Record<string, unknown>;
    const campanhaData = campanhaRes.data as { campanha_id?: string; campanha_stages?: { name?: string } } | null;

    // Single pipeline entry per lead — map to history format for backward compat
    const propostasHistory = propostasEntry
      ? [{
          id: propostasEntry.id,
          status: propostasEntry.stage_key,
          sale_value: (propMeta.sale_value as number) ?? null,
          product_type: (propMeta.product_type as string) ?? null,
          closed_at: propostasEntry.closed_at,
          created_at: propostasEntry.created_at,
          product: null as { name: string } | null,
        }]
      : [];
    const closedDeals = propostasHistory.filter((p) => p.status === "vendido");
    const activeProposals = propostasHistory.filter(
      (p) => p.status !== "vendido" && p.status !== "perdido",
    );

    return {
      ...(lead as Record<string, unknown>),
      customFields,
      upsell_base_stage: upsellData?.tipo_cliente_tempo ?? null,
      upsell_gestao_stage: upsellData?.gestao_stage ?? null,
      upsell_potencial: upsellData?.potencial ?? null,
      upsell_is_active: upsellData?.is_active ?? null,
      // ADR-0023 §10: etapa do negócio, não do lead. Nome espelha os outros funis
      // (`confirmacao_status`, `propostas_status`) — o antigo `pipe_whatsapp` saiu do
      // SELECT de propósito, para que nenhum leitor caia no espelho legado sem perceber.
      whatsapp_status: whatsappEntry?.stage_key ?? null,
      confirmacao_status: confirmacaoEntry?.stage_key ?? null,
      confirmacao_meeting_date: (confMeta.meeting_date as string) ?? null,
      confirmacao_is_confirmed: (confMeta.is_confirmed as boolean) ?? null,
      propostas_status: propostasEntry?.stage_key ?? null,
      propostas_sale_value: (propMeta.sale_value as number) ?? null,
      propostas_product_type: (propMeta.product_type as string) ?? null,
      campanha_stage: campanhaData?.campanha_stages?.name ?? null,
      campanha_id: campanhaData?.campanha_id ?? null,
      closed_deals: closedDeals,
      active_proposals: activeProposals,
      is_existing_client: closedDeals.length > 0,
    };
  } catch (e) {
    console.error("[context-loader] loadLeadData exception:", e);
    return null;
  }
}

/**
 * Carrega conversa do lead com agente específico (tenant-isolated).
 * Filtra por (lead_id, agent_id, organization_id) — defense-in-depth contra
 * cross-agent context bleeding. Retorna conversation row ou null.
 */
export async function loadConversation(
  supabase: SupabaseClient,
  leadId: string,
  agentId: string,
  organizationId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("lead_id", leadId)
    .eq("agent_id", agentId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.message?.includes("does not exist") || error.code === "42P01") {
      console.warn("[context-loader] conversations table missing, returning null");
      return null;
    }
    console.error("[context-loader] loadConversation error:", error);
  }
  return data as Record<string, unknown> | null;
}

/**
 * Lista documentos KB disponíveis pro agente (status=ready).
 * Retorna apenas file_name (conteúdo via search_knowledge tool).
 */
export async function loadDocumentSummaries(
  supabase: SupabaseClient,
  agentId: string,
): Promise<Array<{ file_name: string; summary: string }>> {
  try {
    const { data, error } = await supabase
      .from("copilot_agent_documents")
      .select("file_name")
      .eq("agent_id", agentId)
      .eq("status", "ready");
    if (error) {
      console.warn("[context-loader] loadDocumentSummaries error:", error.message);
      return [];
    }
    return ((data ?? []) as Array<{ file_name: string }>).map((d) => ({
      file_name: d.file_name,
      summary: "",
    }));
  } catch (e) {
    console.warn("[context-loader] loadDocumentSummaries exception:", e);
    return [];
  }
}
