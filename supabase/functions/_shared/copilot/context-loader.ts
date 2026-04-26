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

  // Routing por stage/origin/segment requer leadId
  if (leadId) {
    try {
      const [leadRes, upsellRes, confirmacaoRes, propostasRes, campanhaRes] = await Promise.all([
        supabase.from("leads").select("pipe_whatsapp, origin, segment").eq("id", leadId).maybeSingle(),
        supabase.from("upsell_clients").select("tipo_cliente_tempo, gestao_stage").eq("lead_id", leadId).maybeSingle(),
        supabase.from("pipe_confirmacao").select("status").eq("lead_id", leadId).maybeSingle(),
        supabase.from("pipe_propostas").select("status").eq("lead_id", leadId).maybeSingle(),
        supabase.from("campanha_leads").select("stage_id, campanha_stages(name)").eq("lead_id", leadId).limit(1).maybeSingle(),
      ]);

      const leadRow = leadRes.data as { pipe_whatsapp?: string; origin?: string; segment?: string } | null;
      const upsellRow = upsellRes.data as { tipo_cliente_tempo?: string; gestao_stage?: string } | null;
      const confirmacaoRow = confirmacaoRes.data as { status?: string } | null;
      const propostasRow = propostasRes.data as { status?: string } | null;
      const campanhaRow = campanhaRes.data as { campanha_stages?: { name?: string } } | null;

      if (leadRow || upsellRow || confirmacaoRow || propostasRow || campanhaRow) {
        const allStages: string[] = [];
        if (leadRow?.pipe_whatsapp) allStages.push(leadRow.pipe_whatsapp);
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

  if (defaultAgent) {
    console.log("[context-loader] using default agent", { agentId: (defaultAgent as Record<string, unknown>).id });
    if (useCache) setCachedCapabilities(organizationId, leadId, defaultAgent);
    return defaultAgent as Record<string, unknown>;
  }

  // Fallback 2: qualquer ativo (mais recente)
  console.warn("[context-loader] no default agent, trying any active");
  const { data: anyAgent } = await supabase
    .from("copilot_agents")
    .select(SELECT_AGENT)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (anyAgent) {
    console.log("[context-loader] using fallback active agent", { agentId: (anyAgent as Record<string, unknown>).id });
    if (useCache) setCachedCapabilities(organizationId, leadId, anyAgent);
    return anyAgent as Record<string, unknown>;
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
