/**
 * meta-template-sync — polls Meta for the approval status of pending templates
 * and updates status + rejection_reason (Slice 6, ADR-0009).
 *
 * Dual auth:
 *   - x-cron-secret → sweeps ALL orgs' pending templates (the future cron path).
 *   - JWT (requireAuth) → syncs only the caller's org (manual refresh from UI).
 *
 * config.toml verify_jwt=false → custom auth. INERT until the `meta_cloud` flag
 * is enabled: with no submitted templates (meta_template_id IS NULL) there is
 * nothing to poll, so a cron sweep is a no-op today.
 *
 * Per-instance token: each pending template is polled with the WABA token of its
 * own instance, resolved via the service_role RPC get_meta_cloud_credentials —
 * never the secrets table directly, never logged.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { createMetaTemplateGraph, mapMetaStatus } from "../_shared/meta-templates.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface PendingTemplate {
  id: string;
  organization_id: string;
  instance_id: string | null;
  meta_template_id: string;
}

Deno.serve(withErrorBoundary("meta-template-sync", async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin") ?? undefined));
  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ── Resolve auth + scope ────────────────────────────────────────────────────
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const providedCron = req.headers.get("x-cron-secret") ?? "";
  const isCron = Boolean(cronSecret) && timingSafeCompare(providedCron, cronSecret);

  let orgScope: string | null = null; // null = all orgs (cron sweep)
  if (!isCron) {
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // no body — fine for JWT-in-header
    }
    let auth;
    try {
      auth = await requireAuth(req, { body });
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
      throw e;
    }
    orgScope = auth.organizationId || (auth.isMaster ? ((body.organization_id as string) ?? null) : null);
    // Non-master JWT caller MUST be scoped to a single org.
    if (!orgScope && !auth.isMaster) {
      return new Response(JSON.stringify({ error: "organization_id_required" }), { status: 400, headers });
    }
  }

  // ── Pull submitted-but-pending templates ────────────────────────────────────
  let query = supabase
    .from("meta_message_templates")
    .select("id, organization_id, instance_id, meta_template_id")
    .eq("status", "pending")
    .not("meta_template_id", "is", null);
  if (orgScope) query = query.eq("organization_id", orgScope);

  const { data: rows, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
  const pending = (rows ?? []) as PendingTemplate[];

  // Cache one Graph client per instance (token resolved once per instance).
  const graphCache = new Map<string, ReturnType<typeof createMetaTemplateGraph> | null>();
  async function graphForInstance(instanceId: string | null) {
    if (!instanceId) return null;
    if (graphCache.has(instanceId)) return graphCache.get(instanceId)!;
    let client: ReturnType<typeof createMetaTemplateGraph> | null = null;
    const { data: creds } = await supabase.rpc("get_meta_cloud_credentials", {
      p_instance_id: instanceId,
    });
    const cred = Array.isArray(creds) ? creds[0] : creds;
    if (cred?.meta_access_token) {
      client = createMetaTemplateGraph({ token: cred.meta_access_token });
    }
    graphCache.set(instanceId, client);
    return client;
  }

  let checked = 0, updated = 0, skipped = 0, failed = 0;
  for (const t of pending) {
    const graph = await graphForInstance(t.instance_id);
    if (!graph) { skipped++; continue; } // no Meta credentials yet — leave pending
    try {
      const result = await graph.getTemplateStatus(t.meta_template_id);
      checked++;
      if (!result) { skipped++; continue; } // deleted upstream — leave as-is
      const mapped = mapMetaStatus(result.status);
      if (mapped !== "pending") {
        await supabase
          .from("meta_message_templates")
          .update({
            status: mapped,
            rejection_reason: mapped === "rejected" ? result.rejectedReason : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", t.id);
        updated++;
      }
    } catch (e) {
      console.error(`[meta-template-sync] poll ${t.id} failed:`, (e as Error).message);
      failed++;
    }
  }

  return new Response(
    JSON.stringify({ pending: pending.length, checked, updated, skipped, failed }),
    { status: 200, headers },
  );
}));
