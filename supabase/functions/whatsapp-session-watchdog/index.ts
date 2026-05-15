// deno-lint-ignore-file no-explicit-any

/**
 * whatsapp-session-watchdog — detects dead WhatsApp sessions on Uazapi.
 *
 * Why this exists:
 *   When a WhatsApp account is scanned on a different device, Uazapi keeps the
 *   `whatsapp_instances` row as `connected` from our perspective (no webhook
 *   ever lands), and outbound starts failing only intermittently. Operators
 *   discover this hours or days later when a sales call is missed.
 *
 * What this does:
 *   - Calls Uazapi `/instance/all` (single admin-token request — efficient).
 *   - For every V8-linked Uazapi instance compares the reported status against
 *     our `whatsapp_instances` row.
 *   - On transitions:
 *       healthy → dead: stamps session_dead_since + session_dead_reason,
 *                       logs runtime + emits Sentry breadcrumb.
 *       dead → healthy: clears session_dead_since + session_dead_reason.
 *   - Idempotent: does nothing when the local state already matches reality.
 *
 * Schedule: every 10 minutes via pg_cron.
 * Auth: x-cron-secret or service_role.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";

const REQUEST_TIMEOUT_MS = 15_000;

type UazapiInstance = {
  id: string;                      // uazapi_instance_id (r…)
  status: string;                  // "connected" | "disconnected" | ...
  lastDisconnectReason?: string;
  adminField01?: string;           // organization_id
  adminField02?: string;           // whatsapp_instances.id
  name?: string;
};

type DbInstance = {
  id: string;
  organization_id: string;
  instance_name: string;
  provider: string;
  status: string | null;
  session_dead_since: string | null;
  session_dead_reason: string | null;
};

async function fetchUazapiInstances(baseUrl: string, adminToken: string): Promise<UazapiInstance[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/instance/all`, {
      method: "GET",
      headers: { admintoken: adminToken },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`/instance/all HTTP ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error("/instance/all did not return an array");
    return body as UazapiInstance[];
  } finally {
    clearTimeout(timer);
  }
}

function isDead(status: string | undefined | null): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s !== "connected" && s !== "connecting";
}

Deno.serve(
  withSentry("whatsapp-session-watchdog", async (req: Request): Promise<Response> => {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
    const UAZAPI_BASE_URL = Deno.env.get("UAZAPI_BASE_URL") ?? "";
    const UAZAPI_ADMIN_TOKEN = Deno.env.get("UAZAPI_ADMIN_TOKEN") ?? "";

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

    if (!UAZAPI_BASE_URL || !UAZAPI_ADMIN_TOKEN) {
      return new Response(
        JSON.stringify({ error: "UAZAPI_BASE_URL / UAZAPI_ADMIN_TOKEN not configured" }),
        { status: 500, headers },
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let uazapiInstances: UazapiInstance[];
    try {
      uazapiInstances = await fetchUazapiInstances(UAZAPI_BASE_URL, UAZAPI_ADMIN_TOKEN);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logRuntime({
        module: "whatsapp",
        action: "session_watchdog_fetch_failed",
        status: "error",
        errorMessage: message,
      });
      return new Response(JSON.stringify({ error: message }), { status: 502, headers });
    }

    // Build a lookup from whatsapp_instances.id (uuid in adminField02) → Uazapi status.
    const byInstanceId = new Map<string, UazapiInstance>();
    for (const u of uazapiInstances) {
      if (u.adminField02 && /^[0-9a-f-]{36}$/i.test(u.adminField02)) {
        byInstanceId.set(u.adminField02, u);
      }
    }

    const { data: dbInstances, error: dbErr } = await supabase
      .from("whatsapp_instances")
      .select("id, organization_id, instance_name, provider, status, session_dead_since, session_dead_reason")
      .eq("provider", "uazapi")
      .returns<DbInstance[]>();

    if (dbErr) {
      return new Response(JSON.stringify({ error: dbErr.message }), { status: 500, headers });
    }

    let transitionedDead = 0;
    let transitionedHealthy = 0;
    let unchanged = 0;
    let untrackedOnUazapi = 0;
    const dead: Array<{ id: string; org: string; reason: string }> = [];

    for (const row of dbInstances ?? []) {
      const u = byInstanceId.get(row.id);
      if (!u) {
        untrackedOnUazapi += 1;
        continue;
      }
      const nowDead = isDead(u.status);
      const wasDead = row.session_dead_since !== null;

      if (nowDead && !wasDead) {
        const reason = u.lastDisconnectReason && u.lastDisconnectReason.length > 0
          ? u.lastDisconnectReason
          : u.status ?? "disconnected";
        await supabase.from("whatsapp_instances").update({
          session_dead_since: new Date().toISOString(),
          session_dead_reason: reason,
        }).eq("id", row.id);
        await logRuntime({
          module: "whatsapp",
          action: "session_dead_detected",
          status: "error",
          errorMessage: `${row.instance_name}: ${reason}`,
          payloadSnapshot: {
            instance_id: row.id,
            organization_id: row.organization_id,
            uazapi_instance_id: u.id,
            reason,
          },
        });
        console.error(`[whatsapp-session-watchdog] session_dead ${row.instance_name} (${row.id}): ${reason}`);
        transitionedDead += 1;
        dead.push({ id: row.id, org: row.organization_id, reason });
      } else if (!nowDead && wasDead) {
        await supabase.from("whatsapp_instances").update({
          session_dead_since: null,
          session_dead_reason: null,
        }).eq("id", row.id);
        await logRuntime({
          module: "whatsapp",
          action: "session_recovered",
          status: "success",
          payloadSnapshot: {
            instance_id: row.id,
            organization_id: row.organization_id,
            uazapi_instance_id: u.id,
            previous_reason: row.session_dead_reason,
          },
        });
        transitionedHealthy += 1;
      } else {
        unchanged += 1;
      }
    }

    return new Response(
      JSON.stringify({
        checked: dbInstances?.length ?? 0,
        transitioned_dead: transitionedDead,
        transitioned_healthy: transitionedHealthy,
        unchanged,
        untracked_on_uazapi: untrackedOnUazapi,
        dead,
      }),
      { status: 200, headers },
    );
  }),
);
