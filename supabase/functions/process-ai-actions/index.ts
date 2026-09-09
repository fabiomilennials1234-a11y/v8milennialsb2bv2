/**
 * Worker: Processa fila de ações do Copilot (pending_ai_actions)
 *
 * - Chamado por pg_cron a cada 1 minuto via pg_net
 * - Claim atômico com FOR UPDATE SKIP LOCKED (batch de 10)
 * - Controle de concorrência: não executa duas ações para o mesmo lead+action_type simultaneamente
 * - Retry com backoff exponencial: 1min → 5min → 15min, depois dead_letter
 * - Toda execução é auditada via logRuntime
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { trackEvent } from "../_shared/track.ts";
import { executeAiAction, type ActionRecord } from "../_shared/ai-action-executor.ts";
import { startJob, finishJob, failJob } from "../_shared/job-tracker.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { logToolCall } from "../_shared/copilot/tool-call-logger.ts";
import { needsConcurrencyGuard } from "../_shared/copilot/concurrency-guard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MINUTES = [1, 5, 15]; // escalada de retry

// Ações que despacham mídia via provider.sendMedia. O cliente Uazapi já aplica
// um cap INTERNO de 60s (MEDIA_TIMEOUT_MS) com AbortController. O cap externo
// abaixo precisa ser MAIOR que 60s, senão a race externa dispara primeiro,
// o cron re-claim reenvia, e o fetch interno ainda em voo ENTREGA — duplicando
// a mídia (incidente 2026-06-02: mesmo vídeo entregue 3×).
const MEDIA_ACTION_TYPES = new Set(["send_document"]);
const MEDIA_ACTION_TIMEOUT_MS = 90_000;
const DEFAULT_ACTION_TIMEOUT_MS = 30_000;

Deno.serve(
  withErrorBoundary("process-ai-actions", async (req: Request): Promise<Response> => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // Auth via cron secret
    const cronSecret = req.headers.get("x-cron-secret");
    if (!CRON_SECRET || !cronSecret || !timingSafeCompare(cronSecret, CRON_SECRET)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const stats = { claimed: 0, completed: 0, failed: 0, rescheduled: 0, dead_letter: 0 };

    try {
      // 1. Claim batch atômico
      const { data: actions, error: claimError } = await supabase.rpc("claim_pending_ai_actions", {
        batch_size: BATCH_SIZE,
      });

      if (claimError) {
        console.error("[process-ai-actions] Claim RPC failed:", claimError);
        return new Response(JSON.stringify({ error: "Claim failed", detail: claimError.message }), {
          status: 500,
          headers,
        });
      }

      if (!actions || actions.length === 0) {
        return new Response(JSON.stringify({ message: "No pending actions", stats }), { headers });
      }

      stats.claimed = actions.length;
      console.log(`[process-ai-actions] Claimed ${actions.length} actions`);

      // 2. Processar cada ação
      for (const action of actions as ActionRecord[]) {
        await processAction(supabase, action, stats);
      }

      console.log("[process-ai-actions] Batch complete:", stats);
      return new Response(JSON.stringify({ success: true, stats }), { headers });
    } catch (err) {
      console.error("[process-ai-actions] Unexpected error:", err);
      return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers });
    }
  }),
);

async function processAction(
  supabase: ReturnType<typeof createClient>,
  action: ActionRecord,
  stats: { claimed: number; completed: number; failed: number; rescheduled: number; dead_letter: number },
): Promise<void> {
  const { id, lead_id, action_type, organization_id, payload } = action;
  let jobId: string | null = null;

  try {
    // 3. Controle de concorrência: se já existe processing para mesmo lead+action_type, reagendar.
    //    `send_document` é isento — ver `_shared/copilot/concurrency-guard.ts`.
    if (lead_id && needsConcurrencyGuard(action_type)) {
      const { data: hasConcurrent } = await supabase.rpc("has_concurrent_ai_action", {
        p_lead_id: lead_id,
        p_action_type: action_type,
        p_exclude_id: id,
      });

      if (hasConcurrent) {
        console.log(
          `[process-ai-actions] Concurrent action for lead ${lead_id}/${action_type}, rescheduling in 30s`,
        );
        await supabase
          .from("pending_ai_actions")
          .update({
            status: "pending",
            next_retry_at: new Date(Date.now() + 30_000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);
        stats.rescheduled++;
        return;
      }
    }

    // Job tracking: registrar início
    jobId = await startJob(supabase, {
      organizationId: organization_id,
      sourceEngine: 'copilot',
      entityType: 'lead',
      entityId: lead_id || id,
      actionType: action_type,
      sourceTable: 'pending_ai_actions',
      sourceId: id,
      payloadSnapshot: payload as Record<string, unknown> || {},
    });

    // 4. Executar ação com timeout duro (Onda 1 / T1.1.4)
    // Telemetria 30d (2026-04-26): 6 pending órfãs >24h confirmaram que ação
    // travada bloqueia batch indefinidamente. Cap força failure path → retry
    // com backoff [1,5,15min] → dead_letter ao terceiro retry.
    //
    // Por tipo (incidente 2026-06-02): mídia precisa de cap > 60s para o
    // AbortController INTERNO do cliente Uazapi governar o timeout e cancelar o
    // fetch de forma limpa, em vez do cap externo abortar antes e orfanar um
    // envio que ainda completa. A idempotência do send_document (send lock)
    // garante at-most-once mesmo se este cap ainda for excedido.
    const ACTION_TIMEOUT_MS = MEDIA_ACTION_TYPES.has(action_type)
      ? MEDIA_ACTION_TIMEOUT_MS
      : DEFAULT_ACTION_TIMEOUT_MS;
    const timeoutPromise = new Promise<{ success: false; error: string }>((_, reject) =>
      setTimeout(
        () => reject(new Error(`timeout: action ${action_type} exceeded ${ACTION_TIMEOUT_MS}ms`)),
        ACTION_TIMEOUT_MS,
      )
    );
    // Onda 2 / T2.C.2: timing per action
    const actionStart = Date.now();
    const result = await Promise.race([
      executeAiAction(supabase, action),
      timeoutPromise,
    ]).catch((e) => ({ success: false, error: e instanceof Error ? e.message : String(e) }));
    const actionDurationMs = Date.now() - actionStart;

    // RAG observability: log tool call (fire-and-forget)
    logToolCall(supabase, {
      conversationId: action.conversation_id || id,
      organizationId: organization_id,
      agentId: (payload as Record<string, unknown>)?.agent_id as string | undefined,
      toolName: action_type,
      toolInput: (payload as Record<string, unknown>) || {},
      toolOutputSummary: result.success
        ? { success: true, message: result.message }
        : { success: false, error: result.error },
      durationMs: actionDurationMs,
    }).catch(() => {}); // fire-and-forget

    if (result.success) {
      // 5a. Sucesso → completed
      await supabase
        .from("pending_ai_actions")
        .update({
          status: "completed",
          processed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      stats.completed++;
      if (jobId) await finishJob(supabase, jobId);

      // Track usage event (fire-and-forget)
      trackEvent({
        organizationId: organization_id,
        eventType: "automation_triggered",
        entityType: "lead",
        entityId: lead_id || undefined,
        metadata: { action_type, action_id: id },
      }).catch(() => {});

      await logRuntime({
        organizationId: organization_id,
        module: "copilot",
        action: action_type,
        status: "success",
        entityType: "lead",
        entityId: lead_id || undefined,
        durationMs: actionDurationMs,
        payloadSnapshot: {
          action_id: id,
          result_message: result.message,
          ...((result.data as Record<string, unknown>) || {}),
        },
      });
    } else {
      // 5b. Falha → retry ou dead_letter
      if (jobId) await failJob(supabase, jobId, result.error || "Unknown error");
      await handleFailure(supabase, action, result.error || "Unknown error", stats);
    }
  } catch (err) {
    console.error(`[process-ai-actions] Action ${id} threw:`, err);
    if (jobId) await failJob(supabase, jobId, String(err));
    await handleFailure(supabase, action, String(err), stats);
  }
}

async function handleFailure(
  supabase: ReturnType<typeof createClient>,
  action: ActionRecord & { retry_count?: number },
  errorMessage: string,
  stats: { completed: number; failed: number; rescheduled: number; dead_letter: number },
): Promise<void> {
  const currentRetry = (action as Record<string, unknown>).retry_count as number || 0;
  const nextRetry = currentRetry + 1;

  if (nextRetry >= MAX_RETRIES) {
    // Dead letter
    await supabase
      .from("pending_ai_actions")
      .update({
        status: "dead_letter",
        retry_count: nextRetry,
        error_message: errorMessage,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", action.id);

    stats.dead_letter++;

    await logRuntime({
      organizationId: action.organization_id,
      module: "copilot",
      action: `dead_letter:${action.action_type}`,
      status: "error",
      errorMessage: `Dead letter após ${MAX_RETRIES} tentativas: ${errorMessage}`,
      entityType: "lead",
      entityId: action.lead_id || undefined,
      payloadSnapshot: { action_id: action.id, payload: action.payload },
    });
  } else {
    // Retry com backoff
    const backoffMinutes = RETRY_BACKOFF_MINUTES[currentRetry] || 15;
    const nextRetryAt = new Date(Date.now() + backoffMinutes * 60_000).toISOString();

    await supabase
      .from("pending_ai_actions")
      .update({
        status: "pending",
        retry_count: nextRetry,
        next_retry_at: nextRetryAt,
        error_message: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", action.id);

    stats.failed++;

    await logRuntime({
      organizationId: action.organization_id,
      module: "copilot",
      action: `retry:${action.action_type}`,
      status: "error",
      errorMessage: `Tentativa ${nextRetry}/${MAX_RETRIES} falhou: ${errorMessage}. Retry em ${backoffMinutes}min`,
      entityType: "lead",
      entityId: action.lead_id || undefined,
      payloadSnapshot: { action_id: action.id, retry: nextRetry, next_retry_at: nextRetryAt },
    });
  }
}
