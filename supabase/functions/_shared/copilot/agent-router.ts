/**
 * AgentRouter — routes leads to copilot agents via cascade.
 *
 * Cascade: stage > origin > segment > default > any active > null
 * LRU cache: 200 entries, 5min TTL.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPipeEntry } from "../pipeline-adapter.ts";

const SELECT_AGENT = "*, copilot_agent_faqs(*), copilot_agent_kanban_rules(*)";

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 200;

interface CacheEntry {
  value: Record<string, unknown> | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(orgId: string, leadId?: string): string {
  return `${orgId}|${leadId ?? "default"}`;
}

export class AgentRouter {
  constructor(
    private supabase: SupabaseClient,
    private organizationId: string,
  ) {}

  async route(
    leadId?: string,
    opts: { useCache?: boolean } = {},
  ): Promise<Record<string, unknown> | null> {
    const useCache = opts.useCache !== false;
    const key = cacheKey(this.organizationId, leadId);

    if (useCache) {
      const entry = cache.get(key);
      if (entry && Date.now() <= entry.expiresAt) {
        return entry.value;
      }
      if (entry) cache.delete(key);
    }

    const result = await this.resolveAgent(leadId);

    if (useCache) {
      if (cache.size >= MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
      cache.set(key, { value: result, expiresAt: Date.now() + TTL_MS });
    }

    return result;
  }

  private async resolveAgent(leadId?: string): Promise<Record<string, unknown> | null> {
    let leadOrigin: string | undefined;

    if (leadId) {
      const result = await this.routeByLead(leadId);
      if (result.agent) return result.agent;
      leadOrigin = result.leadOrigin;
    }

    return await this.fallback(leadOrigin);
  }

  private async routeByLead(leadId: string): Promise<{ agent: Record<string, unknown> | null; leadOrigin?: string }> {
    try {
      // ADR-0023 §10: o funil WhatsApp entra pelo NEGÓCIO (`pipeline_entries`), igual
      // confirmação e propostas. `leads.pipe_whatsapp` é espelho legado e não roteia mais.
      const [leadRes, upsellRes, whatsappRes, confirmacaoRes, propostasRes, campanhaRes] = await Promise.all([
        this.supabase.from("leads").select("origin, segment").eq("id", leadId).maybeSingle(),
        this.supabase.from("upsell_clients").select("tipo_cliente_tempo, gestao_stage").eq("lead_id", leadId).maybeSingle(),
        getPipeEntry(this.supabase, leadId, this.organizationId, "whatsapp"),
        getPipeEntry(this.supabase, leadId, this.organizationId, "confirmacao"),
        getPipeEntry(this.supabase, leadId, this.organizationId, "propostas"),
        this.supabase.from("campanha_leads").select("stage_id, campanha_stages(name)").eq("lead_id", leadId).limit(1).maybeSingle(),
      ]);

      const leadRow = leadRes.data as { origin?: string; segment?: string } | null;
      const upsellRow = upsellRes.data as { tipo_cliente_tempo?: string; gestao_stage?: string } | null;
      const whatsappRow = whatsappRes ? { status: whatsappRes.stage_key } : null;
      const confirmacaoRow = confirmacaoRes ? { status: confirmacaoRes.stage_key } : null;
      const propostasRow = propostasRes ? { status: propostasRes.stage_key } : null;
      const campanhaRow = campanhaRes.data as { campanha_stages?: { name?: string } } | null;

      if (!leadRow && !upsellRow && !whatsappRow && !confirmacaoRow && !propostasRow && !campanhaRow) {
        return { agent: null, leadOrigin: leadRow?.origin };
      }

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
          ? this.supabase.from("copilot_agents").select(SELECT_AGENT).eq("organization_id", this.organizationId).eq("is_active", true).overlaps("routing_stages", allStages).maybeSingle()
          : Promise.resolve({ data: null }),
        leadRow?.origin
          ? this.supabase.from("copilot_agents").select(SELECT_AGENT).eq("organization_id", this.organizationId).eq("is_active", true).contains("routing_origins", [leadRow.origin]).maybeSingle()
          : Promise.resolve({ data: null }),
        leadRow?.segment
          ? this.supabase.from("copilot_agents").select(SELECT_AGENT).eq("organization_id", this.organizationId).eq("is_active", true).contains("routing_segments", [leadRow.segment]).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const agent = (stageResult.data || originResult.data || segmentResult.data) as Record<string, unknown> | null;
      return { agent, leadOrigin: leadRow?.origin };
    } catch (e) {
      console.warn("[AgentRouter] routing lookup failed (non-fatal):", e);
      return { agent: null };
    }
  }

  private static rejectsOrigin(agent: Record<string, unknown>, leadOrigin?: string): boolean {
    if (!leadOrigin) return false;
    const origins = agent.routing_origins as string[] | null;
    if (!origins || origins.length === 0) return false;
    return !origins.includes(leadOrigin);
  }

  private async fallback(leadOrigin?: string): Promise<Record<string, unknown> | null> {
    const { data: defaultAgent } = await this.supabase
      .from("copilot_agents")
      .select(SELECT_AGENT)
      .eq("organization_id", this.organizationId)
      .eq("is_active", true)
      .eq("is_default", true)
      .maybeSingle();

    if (defaultAgent && !AgentRouter.rejectsOrigin(defaultAgent as Record<string, unknown>, leadOrigin)) {
      return defaultAgent as Record<string, unknown>;
    }

    const { data: anyAgent } = await this.supabase
      .from("copilot_agents")
      .select(SELECT_AGENT)
      .eq("organization_id", this.organizationId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (anyAgent && !AgentRouter.rejectsOrigin(anyAgent as Record<string, unknown>, leadOrigin)) {
      return anyAgent as Record<string, unknown>;
    }

    if (anyAgent && leadOrigin) {
      console.log("[AgentRouter] agent rejected lead origin", {
        agentId: (anyAgent as Record<string, unknown>).id,
        leadOrigin,
      });
    }

    return null;
  }

  static bustCache(orgId: string, leadId?: string): void {
    cache.delete(cacheKey(orgId, leadId));
  }

  static clearCache(): void {
    cache.clear();
  }

  static getCacheStats(): { size: number; maxEntries: number; ttlMs: number } {
    return { size: cache.size, maxEntries: MAX_ENTRIES, ttlMs: TTL_MS };
  }
}
