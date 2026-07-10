// deno-lint-ignore-file no-explicit-any

/**
 * whatsapp-dlq-replay — retry inbound webhook events that failed first delivery.
 *
 * Source: `whatsapp_webhook_dlq` (populated by whatsapp-webhook in the
 *   `missing_instance` / `unknown_instance` branches).
 *
 * Strategy:
 *   - Pick up to BATCH_LIMIT pending rows (resolved_at IS NULL, attempts < MAX_ATTEMPTS).
 *   - For each row, re-run the instance resolution chain (uazapi_instance_id +
 *     uazapi_token + owner fallbacks). The instance may have appeared since
 *     (e.g., after a rebind or repair).
 *   - On success: stamp resolved_at + resolved_instance_id. The actual message
 *     re-insert is handled by re-POSTing the original payload to the live
 *     whatsapp-webhook endpoint (with the SAME secret and URL path), so the
 *     normal pipeline owns the insert idempotency contract.
 *   - On failure: increment attempts, set last_attempt_at + last_error. After
 *     MAX_ATTEMPTS the row is left for manual review (logged as critical).
 *
 * Schedule: every 5 minutes via pg_cron.
 * Auth: x-cron-secret or service_role.
 * Idempotency: re-POST goes through whatsapp-webhook UPSERT (message_id,instance_id).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { logRuntime } from "../_shared/logger.ts";

const BATCH_LIMIT = 100;
const MAX_ATTEMPTS = 5;
const REPLAY_TIMEOUT_MS = 8_000;

type DlqRow = {
  id: string;
  source_ip: string | null;
  url_path: string;
  event: string | null;
  reason: string;
  payload: Record<string, unknown>;
  attempts: number;
};

function pickInstanceCandidates(p: Record<string, unknown>): { instanceId: string | null; token: string | null } {
  const idFields = [
    "instance", "instance_id", "instanceId", "InstanceId", "InstanceID",
    "instanceID", "instanceName", "InstanceName",
  ];
  const tokenFields = ["token", "Token", "instance_token", "instanceToken"];
  let instanceId: string | null = null;
  let token: string | null = null;
  for (const f of idFields) {
    const v = p[f];
    if (typeof v === "string" && v.trim().length > 0) { instanceId = v.trim(); break; }
  }
  for (const f of tokenFields) {
    const v = p[f];
    if (typeof v === "string" && v.trim().length > 0) { token = v.trim(); break; }
  }
  return { instanceId, token };
}

async function tryResolve(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
  urlPath: string,
): Promise<string | null> {
  const { instanceId, token } = pickInstanceCandidates(payload);

  // Try URL path segment first (rebound instances embed uazapi_instance_id there).
  // Path format: /functions/v1/whatsapp-webhook/<SECRET>/<UAZAPI_INSTANCE_ID>(/event)?
  const segs = urlPath.split("/").filter(Boolean);
  const ixWebhook = segs.findIndex((s) => s === "whatsapp-webhook");
  const seg2 = ixWebhook >= 0 ? segs[ixWebhook + 2] : undefined;
  const knownEvents = new Set(["messages", "messages_update", "connection", "payment", "payment_response"]);
  const pathInstanceId = seg2 && !knownEvents.has(seg2) ? seg2 : undefined;

  const candidate = instanceId ?? pathInstanceId ?? null;

  if (candidate) {
    const { data } = await supabase
      .from("whatsapp_instance_secrets")
      .select("instance_id")
      .eq("uazapi_instance_id", candidate)
      .maybeSingle();
    if (data?.instance_id) return data.instance_id as string;
  }

  if (token) {
    const { data } = await supabase
      .from("whatsapp_instance_secrets")
      .select("instance_id")
      .eq("uazapi_token", token)
      .maybeSingle();
    if (data?.instance_id) return data.instance_id as string;
  }

  return null;
}

async function replayPayload(
  supabaseUrl: string,
  urlPath: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const target = `${supabaseUrl.replace(/\/$/, "")}${urlPath}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REPLAY_TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-replay-source": "dlq-replay",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(
  withErrorBoundary("whatsapp-dlq-replay", async (req: Request): Promise<Response> => {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST" && req.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
    }

    const cronSecret = req.headers.get("x-cron-secret") ?? "";
    const authHeader = req.headers.get("authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const isAuthorized =
      (!!CRON_SECRET && !!cronSecret && timingSafeCompare(cronSecret, CRON_SECRET)) ||
      (!!SUPABASE_SERVICE_ROLE_KEY && !!bearerToken && timingSafeCompare(bearerToken, SUPABASE_SERVICE_ROLE_KEY));

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: rows, error } = await supabase
      .from("whatsapp_webhook_dlq")
      .select("id, source_ip, url_path, event, reason, payload, attempts")
      .is("resolved_at", null)
      .lt("attempts", MAX_ATTEMPTS)
      .order("received_at", { ascending: true })
      .limit(BATCH_LIMIT)
      .returns<DlqRow[]>();

    if (error) {
      await logRuntime({
        module: "webhook",
        action: "dlq_replay_select_error",
        status: "error",
        errorMessage: error.message,
      });
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
    }

    const total = rows?.length ?? 0;
    let resolved = 0;
    let stillFailing = 0;
    let exhausted = 0;

    for (const row of rows ?? []) {
      const instanceId = await tryResolve(supabase, row.payload, row.url_path);
      if (!instanceId) {
        const nextAttempts = row.attempts + 1;
        await supabase.from("whatsapp_webhook_dlq").update({
          attempts: nextAttempts,
          last_attempt_at: new Date().toISOString(),
          last_error: "instance_resolution_failed",
        }).eq("id", row.id);
        if (nextAttempts >= MAX_ATTEMPTS) exhausted += 1;
        else stillFailing += 1;
        continue;
      }

      const replay = await replayPayload(SUPABASE_URL, row.url_path, row.payload);
      if (replay.ok) {
        await supabase.from("whatsapp_webhook_dlq").update({
          attempts: row.attempts + 1,
          last_attempt_at: new Date().toISOString(),
          resolved_at: new Date().toISOString(),
          resolved_instance_id: instanceId,
          last_error: null,
        }).eq("id", row.id);
        resolved += 1;
      } else {
        const nextAttempts = row.attempts + 1;
        await supabase.from("whatsapp_webhook_dlq").update({
          attempts: nextAttempts,
          last_attempt_at: new Date().toISOString(),
          last_error: `replay_${replay.status}${replay.error ? `:${replay.error}` : ""}`,
        }).eq("id", row.id);
        if (nextAttempts >= MAX_ATTEMPTS) exhausted += 1;
        else stillFailing += 1;
      }
    }

    if (exhausted > 0) {
      console.error(`[whatsapp-dlq-replay] ${exhausted} rows exhausted MAX_ATTEMPTS — manual review required`);
    }

    await logRuntime({
      module: "webhook",
      action: "dlq_replay_batch",
      status: exhausted > 0 ? "error" : "success",
      errorMessage: exhausted > 0 ? `${exhausted} rows exhausted attempts` : undefined,
      payloadSnapshot: { total, resolved, still_failing: stillFailing, exhausted },
    });

    return new Response(
      JSON.stringify({ total, resolved, still_failing: stillFailing, exhausted }),
      { status: 200, headers },
    );
  }),
);
