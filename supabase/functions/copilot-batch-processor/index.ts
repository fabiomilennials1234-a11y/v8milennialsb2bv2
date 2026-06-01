/**
 * copilot-batch-processor — Drains mature message batches from
 * `copilot_message_queue` and dispatches them to `agent-message`.
 *
 * Triggered by INSERT trigger on `copilot_message_queue` (via pg_net).
 * Auth: x-cron-secret header (same as other cron-driven functions).
 *
 * Batch maturity: idle_window (5s no new msgs) OR absolute_cap (15s since first).
 * See _shared/copilot-batch-maturity.ts for pure logic + tests.
 *
 * @see Issue #202
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import {
  checkBatchMaturity,
  type BatchInfo,
  BATCH_IDLE_WINDOW_MS,
} from "../_shared/copilot-batch-maturity.ts";
import { captureMessage } from "../_shared/sentry.ts";

const SLEEP_MS = BATCH_IDLE_WINDOW_MS; // 5s — wait for idle window before checking maturity

Deno.serve(withSentry('copilot-batch-processor', async (req: Request): Promise<Response> => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // --- Auth: x-cron-secret ---
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret) {
    console.error("[copilot-batch-processor] CRON_SECRET env not set — denying all");
    return new Response(
      JSON.stringify({ error: "Server misconfiguration" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const headerSecret = req.headers.get("x-cron-secret");
  if (!headerSecret || !timingSafeCompare(headerSecret, cronSecret)) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // --- Parse payload ---
  let batchKey: string;
  try {
    const body = await req.json();
    batchKey = body.batch_key;
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!batchKey || typeof batchKey !== "string") {
    return new Response(
      JSON.stringify({ error: "batch_key is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  console.log("[copilot-batch-processor] Received batch trigger:", { batchKey });

  // --- Sleep: let messages accumulate (does NOT block DB) ---
  await new Promise((r) => setTimeout(r, SLEEP_MS));

  // --- Supabase client ---
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // --- Check batch maturity ---
  const { data: pendingRows, error: queryError } = await supabase
    .from("copilot_message_queue")
    .select("id, organization_id, conversation_id, message_id, phone, queued_at")
    .eq("batch_key", batchKey)
    .eq("status", "pending")
    .order("queued_at", { ascending: true });

  if (queryError) {
    console.error("[copilot-batch-processor] Query error:", queryError);
    return new Response(
      JSON.stringify({ error: "DB query failed", detail: queryError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!pendingRows || pendingRows.length === 0) {
    console.log("[copilot-batch-processor] No pending rows for batch:", batchKey);
    return new Response(
      JSON.stringify({ ok: true, skipped: true, reason: "no_pending_rows" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const now = new Date();
  const batchInfo: BatchInfo = {
    batchKey,
    oldestQueuedAt: new Date(pendingRows[0].queued_at),
    newestQueuedAt: new Date(pendingRows[pendingRows.length - 1].queued_at),
    messageCount: pendingRows.length,
  };

  const maturity = checkBatchMaturity(batchInfo, now);

  if (!maturity.isMature) {
    console.log("[copilot-batch-processor] Batch not mature yet:", {
      batchKey,
      reason: maturity.reason,
      messageCount: batchInfo.messageCount,
    });
    return new Response(
      JSON.stringify({ ok: true, skipped: true, reason: maturity.reason }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  console.log("[copilot-batch-processor] Batch mature:", {
    batchKey,
    reason: maturity.reason,
    messageCount: batchInfo.messageCount,
  });

  // --- Claim rows atomically ---
  const { data: claimedRows, error: claimError } = await supabase
    .rpc("claim_copilot_batch", { p_batch_key: batchKey });

  if (claimError) {
    console.error("[copilot-batch-processor] claim_copilot_batch RPC error:", claimError);
    return new Response(
      JSON.stringify({ error: "Claim RPC failed", detail: claimError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!claimedRows || claimedRows.length === 0) {
    console.log("[copilot-batch-processor] Another processor claimed batch:", batchKey);
    return new Response(
      JSON.stringify({ ok: true, skipped: true, reason: "already_claimed" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  console.log("[copilot-batch-processor] Claimed rows:", {
    batchKey,
    count: claimedRows.length,
  });

  // --- Dispatch to agent-message ---
  const firstRow = claimedRows[0];
  const messageIds = claimedRows.map((r: { message_id: string }) => r.message_id);

  try {
    const agentMessageUrl = `${supabaseUrl}/functions/v1/agent-message`;
    const response = await fetch(agentMessageUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        message_ids: messageIds,
        organization_id: firstRow.organization_id,
        phone: firstRow.phone,
        conversation_id: firstRow.conversation_id,
        from: firstRow.phone,
        batch_mode: true,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("[copilot-batch-processor] agent-message dispatch failed:", {
        status: response.status,
        body: errBody,
        batchKey,
      });
      // Mark rows as failed
      await supabase
        .from("copilot_message_queue")
        .update({ status: "failed", processed_at: new Date().toISOString() })
        .eq("batch_key", batchKey)
        .eq("status", "processing");

      return new Response(
        JSON.stringify({ error: "agent-message dispatch failed", status: response.status }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const responseBody = await response.json().catch(() => ({}));

    if (responseBody.skipped && responseBody.reason === "dedup_concurrent") {
      console.warn("[copilot-batch-processor] Dedup lock hit — retrying after delay:", batchKey);

      const MAX_DEDUP_RETRIES = 2;
      const DEDUP_RETRY_DELAY_MS = 10_000;
      let retrySuccess = false;

      for (let retry = 0; retry < MAX_DEDUP_RETRIES; retry++) {
        await new Promise((r) => setTimeout(r, DEDUP_RETRY_DELAY_MS));

        const retryResp = await fetch(agentMessageUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            message_ids: messageIds,
            organization_id: firstRow.organization_id,
            phone: firstRow.phone,
            conversation_id: firstRow.conversation_id,
            from: firstRow.phone,
            batch_mode: true,
          }),
        });

        const retryBody = await retryResp.json().catch(() => ({}));
        if (!retryBody.skipped || retryBody.reason !== "dedup_concurrent") {
          retrySuccess = true;
          console.log("[copilot-batch-processor] Dedup retry succeeded on attempt", retry + 1);
          break;
        }
        console.log("[copilot-batch-processor] Dedup retry", retry + 1, "still locked");
      }

      if (!retrySuccess) {
        console.error("[copilot-batch-processor] Dedup retries exhausted — marking failed:", batchKey);
        await supabase
          .from("copilot_message_queue")
          .update({ status: "failed", processed_at: new Date().toISOString() })
          .eq("batch_key", batchKey)
          .eq("status", "processing");

        return new Response(
          JSON.stringify({ ok: false, reason: "dedup_retries_exhausted", batch_key: batchKey }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Mark rows as done
    await supabase
      .from("copilot_message_queue")
      .update({ status: "done", processed_at: new Date().toISOString() })
      .eq("batch_key", batchKey)
      .eq("status", "processing");

    console.log("[copilot-batch-processor] Dispatch successful:", {
      batchKey,
      messageCount: messageIds.length,
    });

    const batchWaitMs = Date.now() - new Date(claimedRows[0].queued_at).getTime();
    captureMessage("copilot_batch_dispatched", {
      functionName: "copilot-batch-processor",
      organizationId: firstRow.organization_id,
      tags: {
        "copilot.batch_size": claimedRows.length,
        "copilot.batch_wait_ms": batchWaitMs,
        "copilot.batch_key": batchKey,
        "copilot.forced_drain": maturity.reason === "absolute_cap",
      },
    }).catch(() => {});

    return new Response(
      JSON.stringify({
        ok: true,
        dispatched: true,
        batch_key: batchKey,
        message_count: messageIds.length,
        reason: maturity.reason,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[copilot-batch-processor] Dispatch error:", err);

    // Mark rows as failed on network/fetch error
    await supabase
      .from("copilot_message_queue")
      .update({ status: "failed", processed_at: new Date().toISOString() })
      .eq("batch_key", batchKey)
      .eq("status", "processing");

    return new Response(
      JSON.stringify({ error: "Dispatch exception", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}));
