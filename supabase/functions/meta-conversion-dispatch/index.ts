/**
 * meta-conversion-dispatch — sends Lead Conversion Signals to Meta (ADR-0009,
 * slice 5). Catch-up cron: scans leads that reached a funnel milestone and have
 * NOT yet been signalled (meta_signals_sent ledger), then sends the event via
 * the Conversions API and records it. Idempotent by construction — the ledger
 * is the source of truth, so a lead/event fires at most once regardless of
 * stage flapping.
 *
 * Milestones → event_name:
 *   - qualified : Effective Tier (qualification_tier, else pre) in prata/ouro/diamante
 *   - meeting   : merged Oportunidades funnel stage 'compareceu'
 *   - sold      : a pipeline_entries row in a 'propostas' pipe at stage 'vendido'
 *
 * Only fires for leads with a meta_lead_id AND whose Org has an Ad Account
 * binding carrying a dataset_id. No monetary value is ever sent (graph-client).
 * Dormant (no-op) until Ad Accounts are bound with datasets — safe to deploy
 * ahead of Meta-side Conversion Leads campaign setup.
 *
 * Auth: x-cron-secret.
 */

import { withSentry } from "../_shared/sentry.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { createMetaGraphClient } from "../_shared/meta/graph-client.ts";
import { planConversionSignal, META_EVENT_LABEL, type ConversionEvent } from "../_shared/meta/conversion-signal.ts";

interface Candidate {
  lead_id: string;
  organization_id: string;
  meta_lead_id: string;
  event_name: ConversionEvent;
  ad_account_id: string;
  dataset_override: string | null;
  email: string | null;
  phone: string | null;
}

// event_time stagger so Meta sees the funnel order (initial before later stages).
const EVENT_RANK: Record<ConversionEvent, number> = { initial: 0, qualified: 1, meeting: 2, sold: 3 };

Deno.serve(withSentry("meta-conversion-dispatch", async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("Origin") ?? undefined));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const expected = Deno.env.get("CRON_SECRET") ?? "";
  if (!expected || !timingSafeCompare(req.headers.get("x-cron-secret") ?? "", expected)) {
    return json(corsHeaders, 401, { error: "Unauthorized" });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: cfg } = await supabase.from("meta_app_config").select("system_user_token").eq("id", true).single();
  if (!cfg?.system_user_token) return json(corsHeaders, 500, { error: "meta_app_config token missing" });
  const graph = createMetaGraphClient({ token: cfg.system_user_token });

  // Candidates: leads at a milestone, with meta_lead_id + an org dataset, not yet signalled.
  const { data: rows, error } = await supabase.rpc("get_pending_meta_conversion_signals");
  if (error) return json(corsHeaders, 500, { error: `candidate query failed: ${error.message}` });
  const candidates = (rows ?? []) as Candidate[];

  // Auto-resolve each ad account's conversion dataset once (cached per account).
  // override wins; else exactly one dataset → use it; 0 or >1 → unresolved.
  const datasetCache = new Map<string, string | null>();
  async function resolveDataset(adAccountId: string, override: string | null): Promise<string | null> {
    if (override) return override;
    if (datasetCache.has(adAccountId)) return datasetCache.get(adAccountId)!;
    let resolved: string | null = null;
    try {
      const ds = await graph.listAdAccountDatasets(adAccountId);
      if (ds.length === 1) resolved = ds[0].id;
      else if (ds.length > 1) {
        await supabase.from("meta_asset_bindings")
          .update({ last_error: `Múltiplos datasets (${ds.length}) — escolha um` })
          .eq("asset_type", "ad_account").eq("asset_id", adAccountId);
      }
    } catch (e) {
      console.error(`[meta-conversion-dispatch] dataset resolve ${adAccountId} failed:`, (e as Error).message);
    }
    datasetCache.set(adAccountId, resolved);
    return resolved;
  }

  let sent = 0, skipped = 0, failed = 0;
  for (const c of candidates) {
    const plan = planConversionSignal({ metaLeadId: c.meta_lead_id, eventName: c.event_name, alreadySentEvents: new Set() });
    if (!plan.send) { skipped++; continue; }
    const datasetId = await resolveDataset(c.ad_account_id, c.dataset_override);
    if (!datasetId) { skipped++; continue; } // no/ambiguous dataset — wait for resolution
    try {
      await graph.sendConversion({
        datasetId,
        leadId: c.meta_lead_id,
        eventName: META_EVENT_LABEL[c.event_name],
        eventTime: Math.floor(Date.now() / 1000) - (3 - EVENT_RANK[c.event_name]) * 60,
        email: c.email,
        phone: c.phone,
      });
      await supabase.from("meta_signals_sent").insert({
        organization_id: c.organization_id, lead_id: c.lead_id, event_name: c.event_name,
      });
      sent++;
    } catch (e) {
      console.error(`[meta-conversion-dispatch] ${c.event_name} for ${c.lead_id} failed:`, (e as Error).message);
      failed++;
    }
  }

  return json(corsHeaders, 200, { candidates: candidates.length, sent, skipped, failed });
}));

function json(headers: Record<string, string>, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}
