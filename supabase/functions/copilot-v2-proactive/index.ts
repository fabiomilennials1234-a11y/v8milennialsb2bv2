/**
 * copilot-v2-proactive — Copilot v2 proactive scheduler (Slice 11, ADR #11).
 *
 * Cron (pg_cron → pg_net, 1/min), auth x-cron-secret. Por org ativa:
 * seleciona candidatos de followup (lead frio) e resgate Carteira (cliente
 * dormindo), aplica os gates PUROS (horário comercial + rate-limit), faz o
 * CLAIM ATÔMICO do slot (anti-double-send) e enfileira UMA vez na fila durável
 * existente (copilot_v2_enqueue_message). O worker existente drena.
 *
 * I/O shell: TODA decisão vive nos módulos puros (proactive-scheduler).
 * organization_id SEMPRE da query scoped por org, NUNCA do payload/LLM.
 * First-touch NÃO passa aqui — entra pelo lead-webhook (evento, Task 6).
 *
 * Fronteira com campaigns (ADR #11): um lead em campanha ATIVA é SUPRIMIDO do
 * proativo 1:1 — a campanha fala por ele. Os selectors excluem esses leads.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { initTraceContext } from "../_shared/copilot-v2/trace-context.ts";
import {
  decideProactiveSend,
  buildProactiveIdempotencyKey,
  buildProactiveDirective,
  interpretClaim,
  type BusinessHoursWindow,
  type ProactiveCandidate,
} from "../_shared/copilot-v2/proactive-scheduler.ts";

// Defaults propostos (ajustáveis — ver "Decisões abertas" no plano). Sobrescritos
// por config da org quando existir.
const DEFAULT_DAILY_CEILING = 50;
const DEFAULT_COLD_LEAD_DAYS = 3;      // lead sem resposta há N dias → followup d{N}
const DEFAULT_DORMANT_DAYS = 60;       // cliente sem pedido há N dias → resgate

serve(
  withSentry("copilot-v2-proactive", async (req: Request) => {
    const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const json = (b: unknown, s = 200) =>
      new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

    if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
      return json({ error: "unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const now = new Date();

    // Orgs com pelo menos um agente v2 ATIVO (proativo só pra org ativada).
    const { data: activeAgents } = await supabase
      .from("copilot_v2_agents").select("organization_id, archetype").eq("is_active", true);
    const orgIds = [...new Set((activeAgents ?? []).map((a: any) => a.organization_id))];
    if (orgIds.length === 0) return json({ orgs: 0, enqueued: 0 });

    let enqueued = 0;
    for (const orgId of orgIds) {
      // Janela comercial + teto da org (config; fallback default).
      const window = await loadBusinessHours(supabase, orgId);
      const ceiling = await loadDailyCeiling(supabase, orgId);
      const sentToday = await countSentToday(supabase, orgId);

      // Pre-filtro barato (não vai ao DB de candidatos fora de hora / sobre o teto).
      const pre = decideProactiveSend({ window, now, sentToday, ceiling });
      if (!pre.allowed) continue;

      // Fronteira campaigns: leads em campanha ativa são suprimidos do proativo.
      const inActiveCampaign = await loadLeadsInActiveCampaign(supabase, orgId);

      const candidates: ProactiveCandidate[] = [
        ...(await selectFollowupCandidates(supabase, orgId, DEFAULT_COLD_LEAD_DAYS, inActiveCampaign)),
        ...(await selectRescueCandidates(supabase, orgId, DEFAULT_DORMANT_DAYS, inActiveCampaign)),
      ];

      for (const c of candidates) {
        const idem = buildProactiveIdempotencyKey({ orgId: c.organizationId, leadId: c.leadId, kind: c.kind, slot: c.slot });
        // Claim atômico (autoridade do rate-limit + anti-double-send).
        const { data: claimRows } = await supabase.rpc("copilot_v2_claim_proactive_slot", {
          p_org_id: c.organizationId, p_lead_id: c.leadId, p_kind: c.kind,
          p_slot: c.slot, p_idempotency_key: idem, p_daily_ceiling: ceiling,
        });
        const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
        if (!interpretClaim(claim).enqueue) continue;

        const trace = initTraceContext({
          org_id: c.organizationId, canonical_phone: c.canonicalPhone, lead_id: c.leadId, conversation_id: null,
        });
        const { data: queueId } = await supabase.rpc("copilot_v2_enqueue_message", {
          p_org_id: c.organizationId,
          p_lead_id: c.leadId,
          p_canonical_phone: c.canonicalPhone,
          p_message_type: "text",
          p_content: buildProactiveDirective(c.kind, c.slot),
          p_source: c.kind,                 // first_touch | followup | carteira_rescue
          p_trace_id: trace.trace_id,
          p_idempotency_key: idem,          // mesma chave do ledger → fila colapsa
        });
        if (queueId) {
          enqueued++;
          await supabase.from("copilot_v2_proactive_log")
            .update({ enqueued_queue_id: queueId }).eq("idempotency_key", idem);
        }
      }
    }

    return json({ orgs: orgIds.length, enqueued });
  }),
);

// ── I/O helpers (puro-delegado: estes só leem o DB) ─────────────────────────
async function loadBusinessHours(supabase: any, orgId: string): Promise<BusinessHoursWindow | null> {
  // businessHours mora em copilot_v2_config.slots (mesmo slot do prompt-builder).
  const { data } = await supabase
    .from("copilot_v2_config").select("slots")
    .eq("organization_id", orgId).limit(1).maybeSingle();
  const raw = data?.slots?.businessHours;
  return raw && typeof raw === "object" ? (raw as BusinessHoursWindow) : null;
}
async function loadDailyCeiling(supabase: any, orgId: string): Promise<number> {
  const { data } = await supabase
    .from("copilot_v2_config").select("slots")
    .eq("organization_id", orgId).limit(1).maybeSingle();
  const c = Number(data?.slots?.proactiveDailyCeiling);
  return Number.isFinite(c) && c > 0 ? c : DEFAULT_DAILY_CEILING;
}
async function countSentToday(supabase: any, orgId: string): Promise<number> {
  const { count } = await supabase
    .from("copilot_v2_proactive_log").select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .gte("sent_date", new Date().toISOString().slice(0, 10));
  return count ?? 0;
}
/**
 * Lead-ids da org que estão numa campanha ATIVA — suprimidos do proativo
 * (ADR #11: massa fria fica em campaigns; o proativo 1:1 não fala por cima).
 * Retorna um Set pra exclusão O(1) nos selectors.
 */
async function loadLeadsInActiveCampaign(supabase: any, orgId: string): Promise<Set<string>> {
  const { data: activeCampaigns } = await supabase
    .from("campanhas").select("id").eq("organization_id", orgId).eq("is_active", true);
  const campaignIds = (activeCampaigns ?? []).map((c: any) => c.id);
  if (campaignIds.length === 0) return new Set();
  const { data: rows } = await supabase
    .from("campanha_leads").select("lead_id").in("campanha_id", campaignIds);
  return new Set((rows ?? []).map((r: any) => r.lead_id).filter(Boolean));
}
async function selectFollowupCandidates(
  supabase: any, orgId: string, coldDays: number, inActiveCampaign: Set<string>,
): Promise<ProactiveCandidate[]> {
  // Leads frios: sem atividade há >= coldDays, com telefone, ainda no pipe de qualificação.
  // (Seleção parametrizada por threshold — ver Decisões abertas. Query mínima; o
  // claim idempotente garante que re-selecionar não duplica.)
  const cutoff = new Date(Date.now() - coldDays * 86_400_000).toISOString();
  const { data } = await supabase
    .from("leads").select("id, normalized_phone, updated_at")
    .eq("organization_id", orgId).is("deleted_at", null)
    .not("normalized_phone", "is", null)
    .lte("updated_at", cutoff)
    .limit(100);
  return (data ?? [])
    .filter((l: any) => !inActiveCampaign.has(l.id))
    .map((l: any) => ({
      organizationId: orgId, leadId: l.id, canonicalPhone: l.normalized_phone,
      kind: "followup" as const, slot: `d${coldDays}`,
    }));
}
async function selectRescueCandidates(
  supabase: any, orgId: string, dormantDays: number, inActiveCampaign: Set<string>,
): Promise<ProactiveCandidate[]> {
  // Clientes Carteira "dormindo": is_active, sem pedido recente. Threshold = dormantDays.
  // (Ver Decisões abertas — "dormindo" deriva da data do último pedido; usa-se
  // updated_at como proxy decidido pelo produto neste slice.)
  const cutoff = new Date(Date.now() - dormantDays * 86_400_000).toISOString();
  const { data } = await supabase
    .from("upsell_clients").select("id, lead_id, phone, updated_at")
    .eq("organization_id", orgId).eq("is_active", true)
    .lte("updated_at", cutoff)
    .not("phone", "is", null)
    .limit(100);
  return (data ?? [])
    .filter((c: any) => c.lead_id && !inActiveCampaign.has(c.lead_id))
    .map((c: any) => ({
      organizationId: orgId, leadId: c.lead_id, canonicalPhone: c.phone,
      kind: "carteira_rescue" as const, slot: `r${dormantDays}`,
    }));
}
