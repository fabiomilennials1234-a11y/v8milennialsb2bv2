// deno-lint-ignore-file no-explicit-any

/**
 * whatsapp-health-monitor — drift detection + auto-rebind for Uazapi instances.
 *
 * Compares the V8 DB inbound count for the last hour against Uazapi's mirror
 * for the same window. Severe drift indicates a webhook delivery problem
 * (the kind we saw in the 2026-05-14 incident) and triggers an immediate
 * rebind via whatsapp-rebind-webhook. Snapshots persist in
 * whatsapp_health_checks for the operator dashboard.
 *
 * Schedule: every 5 minutes via pg_cron.
 * Auth: x-cron-secret or service_role.
 *
 * Rebind cooldown: max 1 rebind per instance per 30 minutes (enforced by
 * checking the last rebind_triggered snapshot for the instance).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";

const REQUEST_TIMEOUT_MS = 10_000;
const REBIND_COOLDOWN_MS = 30 * 60_000;
const DRIFT_WARNING_BELOW = 0.9;
const DRIFT_CRITICAL_BELOW = 0.5;
const MIN_UAZAPI_SAMPLE = 5;   // ignore drift on near-zero traffic
const UAZAPI_MAX_LIMIT = 200;

type DbInstance = {
  id: string;
  organization_id: string;
  instance_name: string;
  provider: string;
  status: string | null;
  session_dead_since: string | null;
};

type Secrets = { uazapi_token: string | null; uazapi_instance_id: string | null };

async function fetchUazapiInbound1h(baseUrl: string, token: string): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const cutoffSeconds = Math.floor(Date.now() / 1000) - 3600;
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/message/find`, {
      method: "POST",
      headers: { "token": token, "Content-Type": "application/json" },
      body: JSON.stringify({
        limit: UAZAPI_MAX_LIMIT,
        fromMe: false,
        isGroup: false,
        afterTimestamp: cutoffSeconds,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const body = await res.json();
    const list = Array.isArray(body) ? body : (body?.messages ?? body?.data ?? []);
    return Array.isArray(list) ? list.length : 0;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function triggerRebind(
  supabaseUrl: string,
  cronSecret: string,
  instanceId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/whatsapp-rebind-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": cronSecret },
      body: JSON.stringify({ scope: "instance_ids", instance_ids: [instanceId] }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return { ok: false, error: `rebind HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(
  withSentry("whatsapp-health-monitor", async (req: Request): Promise<Response> => {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
    const UAZAPI_BASE_URL = Deno.env.get("UAZAPI_BASE_URL") ?? "";

    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

    const cronSecret = req.headers.get("x-cron-secret");
    const authHeader = req.headers.get("authorization") ?? "";
    const isAuthorized =
      (!!CRON_SECRET && cronSecret === CRON_SECRET) ||
      (!!SUPABASE_SERVICE_ROLE_KEY && authHeader.includes(SUPABASE_SERVICE_ROLE_KEY));

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    if (!UAZAPI_BASE_URL) {
      return new Response(JSON.stringify({ error: "UAZAPI_BASE_URL not configured" }), { status: 500, headers });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: instances, error: dbErr } = await supabase
      .from("whatsapp_instances")
      .select("id, organization_id, instance_name, provider, status, session_dead_since")
      .eq("provider", "uazapi")
      .eq("status", "connected")
      .is("session_dead_since", null)
      .returns<DbInstance[]>();

    if (dbErr) {
      return new Response(JSON.stringify({ error: dbErr.message }), { status: 500, headers });
    }

    const cutoffIso = new Date(Date.now() - 3_600_000).toISOString();
    const cooldownCutoff = new Date(Date.now() - REBIND_COOLDOWN_MS).toISOString();
    const summary = {
      checked: 0,
      healthy: 0,
      warning: 0,
      critical: 0,
      rebind_triggered: 0,
      rebind_skipped_cooldown: 0,
      probe_failed: 0,
    };

    for (const inst of instances ?? []) {
      summary.checked += 1;

      const { count: v8Count, error: countErr } = await supabase
        .from("whatsapp_messages")
        .select("id", { count: "exact", head: true })
        .eq("instance_id", inst.id)
        .eq("direction", "incoming")
        .gte("created_at", cutoffIso);

      if (countErr) {
        summary.probe_failed += 1;
        await supabase.from("whatsapp_health_checks").insert({
          instance_id: inst.id,
          organization_id: inst.organization_id,
          v8_inbound_1h: 0,
          uazapi_inbound_1h: null,
          drift_ratio: null,
          status: "error",
          notes: `v8 count error: ${countErr.message}`,
        });
        continue;
      }

      const { data: secrets } = await supabase
        .from("whatsapp_instance_secrets")
        .select("uazapi_token, uazapi_instance_id")
        .eq("instance_id", inst.id)
        .maybeSingle<Secrets>();

      if (!secrets?.uazapi_token) {
        summary.probe_failed += 1;
        await supabase.from("whatsapp_health_checks").insert({
          instance_id: inst.id,
          organization_id: inst.organization_id,
          v8_inbound_1h: v8Count ?? 0,
          uazapi_inbound_1h: null,
          drift_ratio: null,
          status: "probe_failed",
          notes: "uazapi_token missing in whatsapp_instance_secrets",
        });
        continue;
      }

      const uazapiCount = await fetchUazapiInbound1h(UAZAPI_BASE_URL, secrets.uazapi_token);

      if (uazapiCount === null) {
        summary.probe_failed += 1;
        await supabase.from("whatsapp_health_checks").insert({
          instance_id: inst.id,
          organization_id: inst.organization_id,
          v8_inbound_1h: v8Count ?? 0,
          uazapi_inbound_1h: null,
          drift_ratio: null,
          status: "probe_failed",
          notes: "uazapi /message/find probe failed",
        });
        continue;
      }

      // Skip drift signal on low traffic — noisy ratios on small samples.
      if (uazapiCount < MIN_UAZAPI_SAMPLE) {
        await supabase.from("whatsapp_health_checks").insert({
          instance_id: inst.id,
          organization_id: inst.organization_id,
          v8_inbound_1h: v8Count ?? 0,
          uazapi_inbound_1h: uazapiCount,
          drift_ratio: null,
          status: "healthy",
          notes: "low_sample_skipped",
        });
        summary.healthy += 1;
        continue;
      }

      const drift = (v8Count ?? 0) / Math.max(uazapiCount, 1);
      let status: "healthy" | "warning" | "critical" | "rebind_triggered" = "healthy";
      let action: string | null = null;
      let notes: string | null = null;

      if (drift < DRIFT_CRITICAL_BELOW) {
        // Check cooldown
        const { data: recentRebind } = await supabase
          .from("whatsapp_health_checks")
          .select("checked_at")
          .eq("instance_id", inst.id)
          .eq("status", "rebind_triggered")
          .gte("checked_at", cooldownCutoff)
          .order("checked_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (recentRebind) {
          status = "critical";
          notes = "cooldown_active";
          summary.critical += 1;
          summary.rebind_skipped_cooldown += 1;
        } else {
          const rebind = await triggerRebind(SUPABASE_URL, CRON_SECRET, inst.id);
          if (rebind.ok) {
            status = "rebind_triggered";
            action = "rebind";
            summary.rebind_triggered += 1;
            console.error(`[whatsapp-health-monitor] critical drift on ${inst.instance_name} (${drift.toFixed(2)}) — rebind triggered`);
          } else {
            status = "critical";
            action = "rebind_failed";
            notes = rebind.error ?? "rebind_failed";
            summary.critical += 1;
          }
        }
      } else if (drift < DRIFT_WARNING_BELOW) {
        status = "warning";
        summary.warning += 1;
      } else {
        status = "healthy";
        summary.healthy += 1;
      }

      await supabase.from("whatsapp_health_checks").insert({
        instance_id: inst.id,
        organization_id: inst.organization_id,
        v8_inbound_1h: v8Count ?? 0,
        uazapi_inbound_1h: uazapiCount,
        drift_ratio: Number(drift.toFixed(3)),
        status,
        action_taken: action,
        notes,
      });
    }

    await logRuntime({
      module: "whatsapp",
      action: "health_monitor_run",
      status: summary.critical > 0 || summary.probe_failed > 0 ? "error" : "success",
      errorMessage:
        summary.critical > 0
          ? `critical drift on ${summary.critical} instance(s)`
          : (summary.probe_failed > 0 ? `probe_failed on ${summary.probe_failed} instance(s)` : undefined),
      payloadSnapshot: summary,
    });

    return new Response(JSON.stringify(summary), { status: 200, headers });
  }),
);
