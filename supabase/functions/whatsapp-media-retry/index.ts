// deno-lint-ignore-file no-explicit-any
/**
 * whatsapp-media-retry — drain whatsapp_media_jobs by retrying CDN download +
 * Storage upload for pending rows.
 *
 * Source: `whatsapp_media_jobs` (populated by whatsapp-webhook when a
 *   message arrives with a WhatsApp CDN URL that the inline persist either
 *   timed out on, returned an error from, or otherwise failed to upload).
 *
 * Strategy:
 *   - Pick up to BATCH_LIMIT pending rows (resolved_at IS NULL, attempts < MAX_ATTEMPTS).
 *   - For each row, call `downloadAndPersistMedia` from the shared helper.
 *   - On success: stamp resolved_at + storage_path.
 *   - On failure: increment attempts + stamp last_error. After MAX_ATTEMPTS
 *     the row is left for manual review (logged as critical).
 *
 * Schedule: every 2 minutes via pg_cron.
 * Auth: x-cron-secret or service_role.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import {
  downloadAndPersistMedia,
  stampMediaJob,
  type MediaPersistResult,
} from "../_shared/whatsapp-media.ts";

const BATCH_LIMIT = 50;
const MAX_ATTEMPTS = 5;

type MediaJobRow = {
  id: string;
  message_id: string;
  instance_id: string;
  organization_id: string;
  source_url: string;
  message_type: string | null;
  attempts: number;
};

Deno.serve(
  withErrorBoundary("whatsapp-media-retry", async (req: Request): Promise<Response> => {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
    const UAZAPI_BASE_URL = Deno.env.get("UAZAPI_BASE_URL") ?? "";

    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST" && req.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
    }

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

    const { data: rows, error } = await supabase
      .from("whatsapp_media_jobs")
      .select("id, message_id, instance_id, organization_id, source_url, message_type, attempts")
      .is("resolved_at", null)
      .lt("attempts", MAX_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT)
      .returns<MediaJobRow[]>();

    if (error) {
      await logRuntime({
        module: "webhook",
        action: "media_retry_select_error",
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
      const result: MediaPersistResult = await downloadAndPersistMedia(
        supabase,
        UAZAPI_BASE_URL,
        {
          instanceId: row.instance_id,
          organizationId: row.organization_id,
          messageId: row.message_id,
          sourceUrl: row.source_url,
          messageType: row.message_type,
        },
      );

      await stampMediaJob(
        supabase,
        row.id,
        { messageId: row.message_id, instanceId: row.instance_id },
        result,
      );

      if (result.ok) {
        resolved += 1;
      } else {
        const nextAttempts = row.attempts + 1;
        if (nextAttempts >= MAX_ATTEMPTS) exhausted += 1;
        else stillFailing += 1;
      }
    }

    if (exhausted > 0) {
      console.error(
        `[whatsapp-media-retry] ${exhausted} rows reached MAX_ATTEMPTS — manual review required`,
      );
    }

    await logRuntime({
      module: "webhook",
      action: "media_retry_run",
      status: "ok",
      payloadSnapshot: { total, resolved, still_failing: stillFailing, exhausted },
    });

    return new Response(
      JSON.stringify({ total, resolved, still_failing: stillFailing, exhausted }),
      { status: 200, headers },
    );
  }),
);
