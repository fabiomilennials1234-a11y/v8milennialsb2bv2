// deno-lint-ignore-file no-explicit-any
/**
 * whatsapp-media-retention — 30-day retention for WhatsApp chat media.
 *
 * WHY: the shared, PUBLIC `media` bucket grew to ~108GB with 300k+ files under
 * `whatsapp-media/` and no retention. Decision (CTO): pure 30-day retention, no
 * external cold storage. This function deletes chat media older than 30 days and
 * degrades the corresponding messages to an "expired" state.
 *
 * SCOPE (critical): only objects under the `whatsapp-media/` prefix are ever
 * deleted. Message templates, campaign assets, avatars and copilot audio live
 * under other prefixes in the same bucket and MUST stay intact. The listing RPC
 * enforces the prefix in SQL; `isWhatsAppMediaPath` re-checks it here (defence
 * in depth).
 *
 * DELETE via the Storage API (`storage.from('media').remove`) — a raw SQL DELETE
 * on storage.objects would orphan the bytes in S3 without reclaiming space.
 *
 * IRREVERSIBLE: media older than the CDN window has no re-fetch source. Hence
 * dry-run support (`?dryRun=1`), bounded batches, and structured logging.
 *
 * Schedule: daily off-peak via pg_cron (see migration). Auth: x-cron-secret or
 * service_role. Idempotent — re-running finds nothing new (files are gone).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import {
  isWhatsAppMediaPath,
  summarizeCandidates,
  type MediaCandidate,
} from "./media-paths.ts";

// Retention window. Retry rescues media within ~14d, so 30d never races it.
const RETENTION_DAYS = 30;
// Max objects listed + deleted per invocation (bounds runtime). Sized so a
// single run stays under the edge wall-clock limit while draining the initial
// backfill in a few invocations; daily steady-state has far fewer candidates.
const MAX_FILES_PER_RUN = 25000;
// Objects per storage remove() call.
const DELETE_BATCH = 500;

Deno.serve(
  withErrorBoundary("whatsapp-media-retention", async (req: Request): Promise<Response> => {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST" && req.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
    }

    // ── Auth ──────────────────────────────────────────────────────────────
    const cronSecret = req.headers.get("x-cron-secret");
    const authHeader = req.headers.get("authorization") ?? "";
    const isAuthorized =
      (!!CRON_SECRET && cronSecret === CRON_SECRET) ||
      (!!SUPABASE_SERVICE_ROLE_KEY && authHeader.includes(SUPABASE_SERVICE_ROLE_KEY));

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    // ── Dry-run flag (query param or JSON body) ──────────────────────────
    let dryRun = false;
    const url = new URL(req.url);
    const qp = url.searchParams.get("dryRun");
    if (qp === "1" || qp === "true") dryRun = true;
    if (req.method === "POST") {
      try {
        const body = await req.json().catch(() => ({}));
        if (body && (body.dryRun === true || body.dryRun === "1")) dryRun = true;
      } catch {
        // ignore malformed body — default dryRun=false
      }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── List expired candidates (storage.objects, scoped to prefix in SQL) ──
    const { data: rawCandidates, error: listError } = await supabase.rpc(
      "list_expired_whatsapp_media",
      { p_older_than_days: RETENTION_DAYS, p_limit: MAX_FILES_PER_RUN },
    );

    if (listError) {
      await logRuntime({
        module: "webhook",
        action: "media_retention_list_error",
        status: "error",
        errorMessage: listError.message,
      });
      return new Response(JSON.stringify({ error: listError.message }), { status: 500, headers });
    }

    // Defensive scope guard: never operate on a path outside whatsapp-media/.
    const candidates: MediaCandidate[] = [];
    let skippedOutOfScope = 0;
    for (const row of (rawCandidates ?? []) as Array<{ path: string; size: number }>) {
      if (isWhatsAppMediaPath(row.path)) {
        candidates.push({ path: row.path, size_bytes: Number(row.size) || 0 });
      } else {
        skippedOutOfScope += 1;
      }
    }
    if (skippedOutOfScope > 0) {
      // Should be impossible (RPC filters by prefix). Loud if it ever happens.
      console.error(
        `[whatsapp-media-retention] RPC returned ${skippedOutOfScope} out-of-scope paths — dropped`,
      );
    }

    const summary = summarizeCandidates(candidates);

    // ── Dry-run: report only, delete nothing ─────────────────────────────
    if (dryRun) {
      await logRuntime({
        module: "webhook",
        action: "media_retention_dry_run",
        status: "success",
        payloadSnapshot: { ...summary, retention_days: RETENTION_DAYS },
      });
      return new Response(
        JSON.stringify({
          dryRun: true,
          retention_days: RETENTION_DAYS,
          deleted_count: summary.deleted_count,
          freed_bytes_estimate: summary.freed_bytes_estimate,
          orgs_affected: summary.orgs_affected,
          messages_marked: 0,
          batches: 0,
        }),
        { status: 200, headers },
      );
    }

    if (candidates.length === 0) {
      return new Response(
        JSON.stringify({
          dryRun: false,
          retention_days: RETENTION_DAYS,
          deleted_count: 0,
          freed_bytes_estimate: 0,
          orgs_affected: 0,
          messages_marked: 0,
          batches: 0,
        }),
        { status: 200, headers },
      );
    }

    // ── Delete via Storage API in batches (reclaims S3 bytes) ────────────
    const deletedPaths: string[] = [];
    let freedBytes = 0;
    let batches = 0;
    const sizeByPath = new Map(candidates.map((c) => [c.path, c.size_bytes]));

    for (let i = 0; i < candidates.length; i += DELETE_BATCH) {
      const chunk = candidates.slice(i, i + DELETE_BATCH);
      const paths = chunk.map((c) => c.path);
      batches += 1;
      const { data: removed, error: removeError } = await supabase.storage
        .from("media")
        .remove(paths);

      if (removeError) {
        console.error(`[whatsapp-media-retention] remove batch failed: ${removeError.message}`);
        await logRuntime({
          module: "webhook",
          action: "media_retention_remove_error",
          status: "error",
          errorMessage: removeError.message,
          payloadSnapshot: { batch_size: paths.length },
        });
        continue; // keep going — other batches may succeed
      }

      // `removed` lists the objects actually deleted. Fall back to the request
      // list if the API omits it.
      const confirmed = (removed && removed.length > 0)
        ? removed.map((o: any) => o.name as string)
        : paths;
      for (const p of confirmed) {
        deletedPaths.push(p);
        freedBytes += sizeByPath.get(p) ?? 0;
      }
    }

    // ── Mark aged-out messages "expired" (set-based, by timestamp window) ──
    // Storage paths do NOT embed a joinable message_id (the filename is
    // `{type}_{hex}_{ts}.{ext}`), so per-path correlation is impossible. Mark
    // by the message `timestamp` window instead: timestamp ≈ media age (verified
    // within 1 day for every whatsapp-media message). The [30d, 45d) window is
    // index-backed (idx_whatsapp_messages_timestamp) and only touches newly
    // aged rows — cheap for the daily run. The UI trigger is
    // media_expired === true, so nulling media_url is unnecessary.
    let messagesMarked = 0;
    if (deletedPaths.length > 0) {
      const nowMs = Date.now();
      const cutoffIso = new Date(nowMs - RETENTION_DAYS * 86_400_000).toISOString();
      const windowStartIso = new Date(nowMs - (RETENTION_DAYS + 15) * 86_400_000).toISOString();
      const { count, error } = await supabase
        .from("whatsapp_messages")
        .update({ media_expired: true }, { count: "exact" })
        .gte("timestamp", windowStartIso)
        .lt("timestamp", cutoffIso)
        .like("media_url", "%whatsapp-media/%")
        .eq("media_expired", false);
      if (error) {
        console.error(`[whatsapp-media-retention] mark failed: ${error.message}`);
      } else {
        messagesMarked = count ?? 0;
      }
    }

    await logRuntime({
      module: "webhook",
      action: "media_retention_run",
      status: "success",
      payloadSnapshot: {
        deleted_count: deletedPaths.length,
        freed_bytes_estimate: freedBytes,
        messages_marked: messagesMarked,
        batches,
        retention_days: RETENTION_DAYS,
      },
    });

    return new Response(
      JSON.stringify({
        dryRun: false,
        retention_days: RETENTION_DAYS,
        deleted_count: deletedPaths.length,
        freed_bytes_estimate: freedBytes,
        orgs_affected: summary.orgs_affected,
        messages_marked: messagesMarked,
        batches,
      }),
      { status: 200, headers },
    );
  }),
);
