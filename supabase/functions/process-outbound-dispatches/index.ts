import { withErrorBoundary } from '../_shared/error-boundary.ts';
/**
 * Worker: Processa fila outbound_dispatch_log (disparos Copilot agendados)
 *
 * Disparos com delay > 0 são registrados como pending e scheduled_at no futuro.
 * Este job busca registros com status='pending' e scheduled_at <= NOW() e envia via Evolution API.
 *
 * Chamado por pg_cron a cada 1–5 min ou manualmente com x-cron-secret.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { sendOutboundDispatch } from "../_shared/outbound-sender.ts";
import { logRuntime } from "../_shared/logger.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { sleepJitter, maxBatchForBudget } from "../_shared/anti-ban-jitter.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
// Anti-ban Onda 0 QW3: 3–8s jitter between dispatches. The batch shrinks to
// fit the tick: cron */5 with NO per-row lock, so the whole run must finish
// well inside 300s or an overlapping tick could double-send. Worst per item ≈
// 8s jitter + ~12s of humanize/split/send. Leftovers stay 'pending' for the
// next tick (was 50).
const TICK_BUDGET_MS = 240_000;
const WORST_PER_DISPATCH_MS = 20_000;
const BATCH_SIZE = maxBatchForBudget(TICK_BUDGET_MS, WORST_PER_DISPATCH_MS); // = 12

Deno.serve(withErrorBoundary('process-outbound-dispatches', async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const cronSecret = req.headers.get("x-cron-secret");
  if (!CRON_SECRET || !cronSecret || !timingSafeCompare(cronSecret, CRON_SECRET)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const now = new Date().toISOString();

    const { data: dispatches, error: fetchError } = await supabase
      .from("outbound_dispatch_log")
      .select("id, organization_id")
      .eq("status", "pending")
      .not("agent_id", "is", null)
      .lte("scheduled_at", now)
      .order("scheduled_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchError) {
      console.error("[process-outbound-dispatches] Fetch error:", fetchError);
      await logRuntime({
        module: "outbound",
        action: "process_outbound_dispatches",
        status: "error",
        errorMessage: fetchError.message,
      });
      return new Response(
        JSON.stringify({ error: "Failed to fetch dispatches", details: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!dispatches?.length) {
      return new Response(JSON.stringify({ processed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    let failed = 0;
    let first = true;
    for (const d of dispatches) {
      // Anti-ban jitter (Onda 0 QW3): espaça os disparos do tick, nunca antes
      // do primeiro. Caminho 100% automação (copilot outbound) — o composer
      // humano não passa por aqui.
      if (!first) await sleepJitter();
      first = false;
      const result = await sendOutboundDispatch(supabase, d.id, d.organization_id);
      if (result.success) sent++;
      else failed++;
    }

    await logRuntime({
      module: "outbound",
      action: "process_outbound_dispatches",
      status: "success",
      payloadSnapshot: { processed: dispatches.length, sent, failed },
    });

    return new Response(
      JSON.stringify({ processed: dispatches.length, sent, failed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[process-outbound-dispatches] Unexpected error:", err);
    await logRuntime({
      module: "outbound",
      action: "process_outbound_dispatches",
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
