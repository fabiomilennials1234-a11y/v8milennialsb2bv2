// deno-lint-ignore-file no-explicit-any

/**
 * whatsapp-rebind-webhook — Force re-registration of Uazapi webhook URL per instance.
 *
 * Why this exists:
 *   Uazapi sometimes drops per-instance webhook config after server restarts,
 *   plan changes, or session resets. Symptom: outbound (POST /send/text) keeps
 *   working because the WhatsApp session is alive, but inbound events stop
 *   reaching whatsapp-webhook. Tenants see "no messages from leads".
 *   See incident 2026-05-14 19:30-20:00 UTC where ~8 orgs lost inbound while
 *   outbound was unaffected.
 *
 * What this does:
 *   For every targeted Uazapi instance, calls /webhook with the canonical
 *   URL `${SUPABASE_URL}/functions/v1/whatsapp-webhook/${UAZAPI_WEBHOOK_SECRET}`
 *   and re-asserts the event subscription (messages, messages_update, connection).
 *   Idempotent on the Uazapi side.
 *
 * Auth:
 *   x-cron-secret (preferred for scheduled runs) OR Authorization: Bearer <service_role>.
 *   Never callable from the browser.
 *
 * Request body (POST, all fields optional):
 *   {
 *     "scope":            "stale" | "instance_ids" | "org_ids" | "all",
 *     "instance_ids":     string[],   // when scope = "instance_ids"
 *     "org_ids":          string[],   // when scope = "org_ids"
 *     "stale_hours":      number,     // default 6 — used by scope "stale"
 *     "dry_run":          boolean     // default false
 *   }
 *
 * Response:
 *   {
 *     "scope": "...",
 *     "selected": number,
 *     "succeeded": number,
 *     "failed": number,
 *     "dry_run": boolean,
 *     "results": Array<{
 *       instance_id: string,
 *       organization_id: string,
 *       instance_name: string,
 *       uazapi_instance_id: string | null,
 *       success: boolean,
 *       skipped_reason?: string,
 *       status_after?: { connected: boolean, state: string },
 *       error?: string
 *     }>
 *   }
 *
 * Safety:
 *   - Only touches provider="uazapi" instances.
 *   - Per-instance error never aborts the batch; failures are reported individually.
 *   - dry_run lists targets and skips the Uazapi calls.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { logRuntime } from "../_shared/logger.ts";
import { getWhatsAppProvider } from "../_shared/whatsapp-client.ts";
import { UazapiProvider } from "../_shared/whatsapp-providers/uazapi-provider.ts";

const PROCESSING_TIMEOUT_MS = 60_000;
const MAX_INSTANCES_PER_BATCH = 200;

type Scope = "stale" | "instance_ids" | "org_ids" | "all";

interface RequestBody {
  scope?: Scope;
  instance_ids?: string[];
  org_ids?: string[];
  stale_hours?: number;
  dry_run?: boolean;
}

interface Target {
  id: string;
  organization_id: string;
  instance_name: string;
  provider: string;
  provider_config: Record<string, unknown> | null;
}

interface Result {
  instance_id: string;
  organization_id: string;
  instance_name: string;
  uazapi_instance_id: string | null;
  success: boolean;
  skipped_reason?: string;
  status_after?: { connected: boolean; state: string };
  // Read-back verification of the webhook after reconfigure:
  //   true  = Uazapi now stores our exact URL and is not disabled
  //   false = reconfigure returned 200 but Uazapi did NOT apply it (silent no-op)
  //   null  = could not read back (treat as unverified, not a hard failure)
  verified?: boolean | null;
  webhook_after?: { url: string | null; enabled: boolean | null };
  error?: string;
}

function parseBody(raw: unknown): RequestBody {
  if (!raw || typeof raw !== "object") return {};
  const b = raw as Record<string, unknown>;
  return {
    scope: typeof b.scope === "string" ? (b.scope as Scope) : undefined,
    instance_ids: Array.isArray(b.instance_ids)
      ? b.instance_ids.filter((x) => typeof x === "string") as string[]
      : undefined,
    org_ids: Array.isArray(b.org_ids)
      ? b.org_ids.filter((x) => typeof x === "string") as string[]
      : undefined,
    stale_hours:
      typeof b.stale_hours === "number" && b.stale_hours > 0
        ? b.stale_hours
        : undefined,
    dry_run: b.dry_run === true,
  };
}

async function selectTargets(
  supabase: ReturnType<typeof createClient>,
  body: RequestBody,
): Promise<Target[]> {
  const scope: Scope = body.scope ?? "stale";

  let query = supabase
    .from("whatsapp_instances")
    .select("id, organization_id, instance_name, provider, provider_config")
    .eq("provider", "uazapi")
    .limit(MAX_INSTANCES_PER_BATCH);

  if (scope === "instance_ids") {
    const ids = body.instance_ids ?? [];
    if (ids.length === 0) return [];
    query = query.in("id", ids);
  } else if (scope === "org_ids") {
    const orgs = body.org_ids ?? [];
    if (orgs.length === 0) return [];
    query = query.in("organization_id", orgs);
  } else if (scope === "stale") {
    const hours = body.stale_hours ?? 6;
    const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
    // Stale = last_connection_at NULL or older than cutoff.
    query = query.or(`last_connection_at.is.null,last_connection_at.lt.${cutoff}`);
  }
  // scope = "all": no extra filter beyond provider=uazapi.

  const { data, error } = await query;
  if (error) throw new Error(`select targets: ${error.message}`);
  return (data ?? []) as unknown as Target[];
}

async function rebindOne(
  supabase: ReturnType<typeof createClient>,
  webhookBaseUrl: string,
  webhookSecret: string,
  target: Target,
): Promise<Result> {
  const base: Result = {
    instance_id: target.id,
    organization_id: target.organization_id,
    instance_name: target.instance_name,
    uazapi_instance_id: null,
    success: false,
  };

  // Lookup uazapi_instance_id for visibility in the response.
  const { data: secret } = await supabase
    .from("whatsapp_instance_secrets")
    .select("uazapi_instance_id")
    .eq("instance_id", target.id)
    .maybeSingle();
  base.uazapi_instance_id = (secret as { uazapi_instance_id?: string } | null)?.uazapi_instance_id ?? null;

  try {
    const provider = await getWhatsAppProvider(
      {
        id: target.id,
        organization_id: target.organization_id,
        provider: "uazapi",
        instance_name: target.instance_name,
        provider_config: target.provider_config ?? {},
      },
      supabase,
    );

    if (!(provider instanceof UazapiProvider)) {
      return { ...base, skipped_reason: "provider_not_uazapi" };
    }

    const webhookUrl = `${webhookBaseUrl.replace(/\/$/, "")}/${webhookSecret}`;
    await provider.reconfigureWebhook(webhookUrl);

    // Read back the webhook from Uazapi to VERIFY the reconfigure persisted.
    // reconfigureWebhook (POST /webhook) returns 200 even when Uazapi silently
    // no-ops, so a 200 alone is not proof the inbound webhook is bound. Incident
    // 2026-06-24: ~40 "successful" rebinds/day with zero effect on delivery, and
    // we had no way to tell. Read-back failure => verified=null (still attempted),
    // never a hard failure.
    let verified: boolean | null = null;
    let webhookAfter: { url: string | null; enabled: boolean | null } | undefined;
    try {
      const wh = await provider.readWebhook();
      webhookAfter = { url: wh.url, enabled: wh.enabled };
      const want = webhookUrl.replace(/\/$/, "");
      const got = (wh.url ?? "").replace(/\/$/, "");
      verified = got.length > 0 && got === want && wh.enabled !== false;
    } catch (_e) {
      verified = null; // could not read back — leave as unverified
    }

    // Confirm state — useful both as smoke test and to refresh DB cache.
    const status = await provider.getStatus();
    return {
      ...base,
      success: true,
      verified,
      webhook_after: webhookAfter,
      status_after: { connected: status.connected, state: status.state },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...base, error: message };
  }
}

Deno.serve(
  withSentry("whatsapp-rebind-webhook", async (req: Request): Promise<Response> => {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
    const UAZAPI_WEBHOOK_SECRET = Deno.env.get("UAZAPI_WEBHOOK_SECRET") ?? "";

    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (req.method !== "POST") {
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

    if (!UAZAPI_WEBHOOK_SECRET) {
      return new Response(
        JSON.stringify({ error: "UAZAPI_WEBHOOK_SECRET not configured" }),
        { status: 500, headers },
      );
    }

    let body: RequestBody;
    try {
      const json = req.headers.get("content-length") === "0" ? {} : await req.json();
      body = parseBody(json);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers });
    }

    const scope: Scope = body.scope ?? "stale";
    const dryRun = body.dry_run === true;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const webhookBaseUrl = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/whatsapp-webhook`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROCESSING_TIMEOUT_MS);

    try {
      const targets = await selectTargets(supabase, body);

      if (dryRun) {
        const results: Result[] = targets.map((t) => ({
          instance_id: t.id,
          organization_id: t.organization_id,
          instance_name: t.instance_name,
          uazapi_instance_id: null,
          success: false,
          skipped_reason: "dry_run",
        }));
        return new Response(
          JSON.stringify({
            scope,
            selected: targets.length,
            succeeded: 0,
            failed: 0,
            dry_run: true,
            results,
          }),
          { status: 200, headers },
        );
      }

      const results: Result[] = [];
      for (const t of targets) {
        if (controller.signal.aborted) {
          results.push({
            instance_id: t.id,
            organization_id: t.organization_id,
            instance_name: t.instance_name,
            uazapi_instance_id: null,
            success: false,
            error: "batch_timeout",
          });
          continue;
        }
        results.push(await rebindOne(supabase, webhookBaseUrl, UAZAPI_WEBHOOK_SECRET, t));
      }

      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success && !r.skipped_reason).length;
      // Verification breakdown (only meaningful for successful rebinds):
      //   webhookNotApplied = reconfigure returned 200 but read-back proved Uazapi
      //   did NOT store our URL — the real Bertin failure mode, now visible.
      const verifiedOk = results.filter((r) => r.success && r.verified === true).length;
      const webhookNotApplied = results.filter((r) => r.success && r.verified === false).length;
      const unverified = results.filter((r) => r.success && r.verified === null).length;

      const errorParts: string[] = [];
      if (failed > 0) errorParts.push(`${failed}/${results.length} rebind failures`);
      if (webhookNotApplied > 0) errorParts.push(`${webhookNotApplied} webhook_not_applied (200 but not persisted)`);

      await logRuntime({
        module: "whatsapp",
        action: "rebind_webhook_batch",
        status: failed === 0 && webhookNotApplied === 0 ? "success" : "error",
        errorMessage:
          errorParts.length === 0 ? undefined : `${errorParts.join("; ")} (scope=${scope})`,
        payloadSnapshot: {
          scope,
          selected: targets.length,
          succeeded,
          failed,
          verified_ok: verifiedOk,
          webhook_not_applied: webhookNotApplied,
          unverified,
          dry_run: false,
        },
      });

      return new Response(
        JSON.stringify({
          scope,
          selected: targets.length,
          succeeded,
          failed,
          dry_run: false,
          results,
        }),
        { status: 200, headers },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logRuntime({
        module: "whatsapp",
        action: "rebind_webhook_batch",
        status: "error",
        errorMessage: message,
        payloadSnapshot: { scope, dry_run: dryRun },
      });
      return new Response(JSON.stringify({ error: message }), { status: 500, headers });
    } finally {
      clearTimeout(timer);
    }
  }),
);
