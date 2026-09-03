/**
 * meta-leadgen-poll — cron-driven Meta Lead Ads ingestion (ADR-0009, slice 4).
 *
 * Pulls native lead-form submissions for every bound Page using the Torque Meta
 * token (meta_app_config), dedups by stored meta_lead_id, creates the Lead in
 * the bound Org and drops it into the FIRST stage of that Org's WhatsApp funnel.
 * Does NOT trigger IA directly — downstream automation is driven by the Org's
 * own lead_created triggers/config. Replaces the Make hop + the broken
 * meta-webhook leadgen path (prod leads has no `metadata` column).
 *
 * Auth: x-cron-secret. Pass ?dry_run=1 to fetch + plan + report WITHOUT writing
 * any lead or advancing any cursor (used to verify against real data safely).
 *
 * Cursor: meta_asset_bindings.last_polled_at per page. Set to now() at bind time
 * so the first real poll only ingests NEW leads (no historical dump).
 */

import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { createMetaGraphClient } from "../_shared/meta/graph-client.ts";
import { planLeadgenImport } from "../_shared/meta/leadgen-import.ts";
import { upsertPipeEntry } from "../_shared/pipeline-adapter.ts";
import { resolveLeadDestination } from "../_shared/pipeline-destination.ts";

const GRAPH = "https://graph.facebook.com/v21.0";

Deno.serve(withErrorBoundary("meta-leadgen-poll", async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("Origin") ?? undefined));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cronSecret = req.headers.get("x-cron-secret") ?? "";
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  if (!expected || !timingSafeCompare(cronSecret, expected)) {
    return json(corsHeaders, 401, { error: "Unauthorized" });
  }

  const dryRun = new URL(req.url).searchParams.get("dry_run") === "1";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Token (deny-all config table, service_role read).
  const { data: cfg, error: cfgErr } = await supabase
    .from("meta_app_config").select("system_user_token").eq("id", true).single();
  if (cfgErr || !cfg?.system_user_token) {
    return json(corsHeaders, 500, { error: "meta_app_config token missing" });
  }
  const graph = createMetaGraphClient({ token: cfg.system_user_token });

  // Active page bindings → the source of truth for which Org a Page feeds.
  const { data: bindings, error: bErr } = await supabase
    .from("meta_asset_bindings")
    .select("id, organization_id, asset_id, last_polled_at")
    .eq("asset_type", "page").eq("status", "active");
  if (bErr) return json(corsHeaders, 500, { error: bErr.message });

  const report: Array<Record<string, unknown>> = [];

  for (const b of bindings ?? []) {
    const pageId = b.asset_id as string;
    const orgId = b.organization_id as string;
    const entry: Record<string, unknown> = { pageId, orgId };
    try {
      const pageToken = await getPageToken(cfg.system_user_token, pageId);
      if (!pageToken) { entry.error = "no_page_token"; report.push(entry); continue; }

      const forms = await graph.listLeadForms(pageId, pageToken);
      const since = b.last_polled_at ? Math.floor(Date.parse(b.last_polled_at as string) / 1000) : undefined;

      const allLeads = [];
      for (const f of forms) {
        const { leads } = await graph.fetchLeadsSince(f.id, pageToken, since);
        allLeads.push(...leads);
      }

      // Idempotency: which of these leadgen ids do we already hold for this org?
      const ids = allLeads.map((l) => l.id);
      const seen = new Set<string>();
      if (ids.length) {
        const { data: existing } = await supabase
          .from("leads").select("meta_lead_id")
          .eq("organization_id", orgId).in("meta_lead_id", ids);
        for (const r of existing ?? []) if (r.meta_lead_id) seen.add(r.meta_lead_id as string);
      }

      const plan = planLeadgenImport({ leads: allLeads, seenLeadgenIds: seen, fieldMappings: null });
      entry.forms = forms.length;
      entry.fetched = allLeads.length;
      entry.toImport = plan.toImport.length;
      entry.skipped = plan.skipped.length;

      if (dryRun) {
        entry.dry_run = true;
        entry.sample = plan.toImport.slice(0, 3).map((p) => ({
          name: p.fields.name, phone: p.fields.phone, company: p.fields.company,
        }));
        report.push(entry);
        continue;
      }

      const dest = await resolveMetaLeadDestination(supabase, orgId);
      if (!dest) {
        console.warn(`[meta-leadgen-poll] org ${orgId} sem funil de destino (nem 'whatsapp', nem funil padrão) — leads serão criados SEM card.`);
      }
      let created = 0;
      for (const p of plan.toImport) {
        const inserted = await createLead(supabase, orgId, dest, p);
        if (inserted) created++;
      }
      entry.created = created;

      // Advance cursor to newest seen (incl skipped) so we don't refetch.
      const newest = plan.newestCreatedTime;
      await supabase.from("meta_asset_bindings")
        .update({ last_polled_at: newest ? new Date(newest * 1000).toISOString() : new Date().toISOString(), last_error: null })
        .eq("id", b.id);
      report.push(entry);
    } catch (e) {
      entry.error = (e as Error).message;
      if (!dryRun) await supabase.from("meta_asset_bindings").update({ last_error: (e as Error).message }).eq("id", b.id);
      report.push(entry);
    }
  }

  return json(corsHeaders, 200, { dry_run: dryRun, pages: report.length, report });
}));

/** Page access token derived from the system token (works for owned + partner pages). */
async function getPageToken(systemToken: string, pageId: string): Promise<string | null> {
  const res = await fetch(`${GRAPH}/${pageId}?fields=access_token&access_token=${systemToken}`);
  const data = await res.json();
  return data?.access_token ?? null;
}

/**
 * Destino do lead desta porta.
 *
 * SCRUM-641: o preferido segue o default histórico 'whatsapp' (org antiga:
 * idêntico). Org SEM esse funil (org nova pós-funil-único) cai no funil
 * PADRÃO da org + 1ª etapa ativa. Sem funil padrão → null: lead criado SEM
 * card, com log — mesmo contrato do lead-webhook. Destino configurável por
 * binding Meta→org segue registrado como incremento.
 */
async function resolveMetaLeadDestination(
  supabase: any,
  orgId: string,
): Promise<{ ref: string; stageKey: string } | null> {
  return await resolveLeadDestination(supabase, orgId, { ref: "whatsapp" });
}

/** Creates the Lead (deduped by meta_lead_id / phone / email) no destino resolvido (null = sem card). */
async function createLead(
  supabase: any, orgId: string, dest: { ref: string; stageKey: string } | null,
  p: { leadgenId: string; fields: Record<string, string | null> },
): Promise<boolean> {
  const phone = p.fields.phone ?? null;
  const email = p.fields.email ?? null;

  // Dedup: meta_lead_id wins; else phone tail; else email.
  let existingId: string | null = null;
  const byMeta = await supabase.from("leads").select("id").eq("organization_id", orgId).eq("meta_lead_id", p.leadgenId).limit(1).maybeSingle();
  if (byMeta.data) existingId = byMeta.data.id;
  if (!existingId && phone) {
    const tail = phone.replace(/\D/g, "").slice(-10);
    if (tail) {
      const r = await supabase.from("leads").select("id").eq("organization_id", orgId).like("phone", `%${tail}`).limit(1).maybeSingle();
      if (r.data) existingId = r.data.id;
    }
  }
  if (!existingId && email) {
    const r = await supabase.from("leads").select("id").eq("organization_id", orgId).eq("email", email).limit(1).maybeSingle();
    if (r.data) existingId = r.data.id;
  }

  if (existingId) {
    await supabase.from("leads").update({ meta_lead_id: p.leadgenId }).eq("id", existingId);
    return false;
  }

  const { data: lead, error } = await supabase.from("leads").insert({
    organization_id: orgId,
    name: p.fields.name ?? "Lead Meta Ads",
    phone, email,
    company: p.fields.company ?? null,
    origin: "meta_ads",
    // SCRUM-202: `pipe_whatsapp: stageKey` removido — o upsertPipeEntry logo
    // abaixo faz o gatilho de sync gravar a coluna.
    meta_lead_id: p.leadgenId,
  }).select("id").single();
  if (error) { console.error("[meta-leadgen-poll] insert lead failed:", error.message); return false; }

  if (dest) {
    try {
      await upsertPipeEntry(supabase, { leadId: lead.id, orgId, slug: dest.ref, stageKey: dest.stageKey, metadata: {}, assignedTo: null });
    } catch (e) {
      console.warn("[meta-leadgen-poll] pipe entry failed:", (e as Error).message);
    }
  }
  return true;
}

function json(headers: Record<string, string>, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}
