/**
 * copilot-batch-processor — Drena batches maduros de `copilot_message_queue`,
 * gera a resposta da IA e ENTREGA ao WhatsApp, com retry durável.
 *
 * Disparado por:
 *   - trigger pg_net no INSERT da fila (latência baixa), e
 *   - cron `copilot-queue-sweep` (1min) p/ retries/reclaim de batches presos.
 * Auth: x-cron-secret.
 *
 * Fluxo (espelha o caminho provado de recover-stuck-conversations):
 *   claim (claim_copilot_batch, retry/reclaim-aware) → resolve conteúdo de
 *   whatsapp_messages → gate (IA off/humano) → gera via agent-message (normal
 *   mode) → entrega chunks via sendTextViaInstance → aplica queue-policy
 *   (delivered/gate→done, erro→retry com backoff, ≥MAX→failed).
 *
 * NÃO chama agent-message em batch_mode nem depende de channel_messages (morto).
 *
 * @see _shared/copilot/queue-policy.ts (política pura, testada)
 * @see Issue #202
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary, logEvent } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { isCopilotCanceled } from "../_shared/copilot/cancellation.ts";
import { montarPayloadDoAgente } from "../_shared/copilot-batch-payload.ts";
import {
  checkBatchMaturity,
  type BatchInfo,
  BATCH_IDLE_WINDOW_MS,
} from "../_shared/copilot-batch-maturity.ts";
import {
  reduceQueueItem,
  type DeliveryOutcome,
} from "../_shared/copilot/queue-policy.ts";

const SLEEP_MS = BATCH_IDLE_WINDOW_MS; // 5s — janela idle antes de checar maturidade
const LEASE_SECONDS = 120; // lease de claim; processing além disso é reclaimável

Deno.serve(withErrorBoundary('copilot-batch-processor', async (req: Request): Promise<Response> => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // --- Auth: x-cron-secret ---
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret) {
    console.error("[copilot-batch-processor] CRON_SECRET env not set — denying all");
    return json({ error: "Server misconfiguration" }, 500);
  }
  const headerSecret = req.headers.get("x-cron-secret");
  if (!headerSecret || !timingSafeCompare(headerSecret, cronSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  // --- Parse payload ---
  let batchKey: string;
  let forceDrain = false; // sweep de retry pula a janela idle (rows já vencidas)
  try {
    const body = await req.json();
    batchKey = body.batch_key;
    forceDrain = body.force_drain === true;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!batchKey || typeof batchKey !== "string") {
    return json({ error: "batch_key is required" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // --- Janela idle (só no caminho de trigger; sweep força drain) ---
  if (!forceDrain) {
    await new Promise((r) => setTimeout(r, SLEEP_MS));

    const { data: pendingRows, error: queryError } = await supabase
      .from("copilot_message_queue")
      .select("queued_at")
      .eq("batch_key", batchKey)
      .eq("status", "pending")
      .order("queued_at", { ascending: true });

    if (queryError) return json({ error: "DB query failed", detail: queryError.message }, 500);
    if (!pendingRows || pendingRows.length === 0) {
      return json({ ok: true, skipped: true, reason: "no_pending_rows" });
    }

    const batchInfo: BatchInfo = {
      batchKey,
      oldestQueuedAt: new Date(pendingRows[0].queued_at),
      newestQueuedAt: new Date(pendingRows[pendingRows.length - 1].queued_at),
      messageCount: pendingRows.length,
    };
    const maturity = checkBatchMaturity(batchInfo, new Date());
    if (!maturity.isMature) {
      return json({ ok: true, skipped: true, reason: maturity.reason });
    }
  }

  // --- Claim atômico (retry/reclaim-aware) ---
  const { data: claimedRows, error: claimError } = await supabase
    .rpc("claim_copilot_batch", { p_batch_key: batchKey, p_lease_seconds: LEASE_SECONDS });

  if (claimError) return json({ error: "Claim RPC failed", detail: claimError.message }, 500);
  if (!claimedRows || claimedRows.length === 0) {
    return json({ ok: true, skipped: true, reason: "nothing_claimable" });
  }

  const firstRow = claimedRows[0] as {
    organization_id: string; phone: string; conversation_id: string | null;
  };
  const orgId = firstRow.organization_id;
  const phone = firstRow.phone;

  // Aplica o resultado da entrega a cada linha reivindicada via política pura.
  const applyOutcome = async (outcome: DeliveryOutcome) => {
    const now = new Date();
    for (const row of claimedRows as { id: string; attempts: number | null }[]) {
      const patch = reduceQueueItem(
        { status: "processing", attempts: row.attempts ?? 0 },
        outcome,
        now,
      );
      await supabase.from("copilot_message_queue").update(patch).eq("id", row.id);
    }
  };

  /** Instance da mensagem mais recente do batch; `null` se nenhuma trouxer. */
  const instanciaDoBatch = (linhas: unknown): string | null => {
    const arr = (linhas ?? []) as { instance_id?: string | null }[];
    for (let i = arr.length - 1; i >= 0; i--) {
      const id = arr[i]?.instance_id;
      if (typeof id === "string" && id) return id;
    }
    return null;
  };

  try {
    // --- Resolve conteúdo entrante (whatsapp_messages, modelo atual) ---
    const messageIds = (claimedRows as { message_id: string }[]).map((r) => r.message_id);
    const { data: msgs } = await supabase
      .from("whatsapp_messages")
      .select("content, timestamp, instance_id")
      .in("id", messageIds)
      .order("timestamp", { ascending: true });

    // Concatena o conteúdo das mensagens entrantes do batch (ordem por timestamp).
    const combinedContent = (msgs ?? [])
      .map((m: { content: string | null }) => m.content)
      .filter(Boolean)
      .join("\n");
    if (!combinedContent.trim()) {
      await applyOutcome({ kind: "delivered" }); // nada a processar — não é falha
      return json({ ok: true, reason: "empty_content", batch_key: batchKey });
    }

    // --- Gate: IA desligada / humano assumiu ---
    const gate = await isCopilotCanceled(supabase, orgId, phone);
    if (gate.canceled) {
      await applyOutcome({ kind: "gate_blocked", source: gate.source ?? "gate" });
      return json({ ok: true, reason: "gate_blocked", source: gate.source, batch_key: batchKey });
    }

    // --- Gera resposta via agent-message (normal mode) ---
    const agentMessageUrl = `${supabaseUrl}/functions/v1/agent-message`;
    let parts: string[] = [];
    try {
      const resp = await fetch(agentMessageUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
        body: JSON.stringify(montarPayloadDoAgente({
          phone,
          orgId,
          content: combinedContent,
          // A Instance da mensagem MAIS RECENTE do batch. O batch é agrupado
          // por telefone+org, então em tese pode misturar Instances; a última
          // é a que o lead acabou de usar, que é a resposta certa para
          // "de qual número ele respondeu".
          instanceId: instanciaDoBatch(msgs),
        })),
      });
      if (!resp.ok) {
        await applyOutcome({ kind: "transient_error", error: `agent_message_${resp.status}` });
        return json({ ok: false, reason: "agent_message_failed", status: resp.status }, 200);
      }
      const data = await resp.json().catch(() => null);
      if (!data || data.skipped) {
        // gate virou durante o turno → terminal sem retry
        await applyOutcome({ kind: "gate_blocked", source: data?.reason ?? "agent_skipped" });
        return json({ ok: true, reason: data?.reason ?? "agent_skipped", batch_key: batchKey });
      }
      parts = data.messages ?? (data.message ? [data.message] : []);
    } catch (e) {
      await applyOutcome({ kind: "transient_error", error: e instanceof Error ? e.message : String(e) });
      return json({ ok: false, reason: "agent_message_exception" }, 200);
    }

    if (parts.length === 0) {
      await applyOutcome({ kind: "delivered" }); // sem texto a enviar — não é falha
      return json({ ok: true, reason: "empty_generation", batch_key: batchKey });
    }

    // --- Entrega chunks (padrão recover-stuck-conversations) ---
    // Anti-ban Onda 0 QW5: preferir sessão VIVA (session_dead_since null,
    // conexão mais recente) com FALLBACK pra query legada — nunca devolve
    // no_active_instance quando existe instância connected (flag pode ser
    // falso-positivo stale; exclusão dura silenciaria o copilot).
    const { selectSendableInstance, sendTextViaInstance } = await import(
      "../_shared/whatsapp-dispatch.ts"
    );
    const instance = await selectSendableInstance(supabase, orgId);

    if (!instance) {
      await applyOutcome({ kind: "transient_error", error: "no_active_instance" });
      return json({ ok: false, reason: "no_active_instance" }, 200);
    }
    let chunksSent = 0;
    let sendFailed = false;
    let canceledMid = false;

    for (let i = 0; i < parts.length; i++) {
      const text = parts[i]?.trim();
      if (!text) continue;
      if (i > 0) await new Promise((r) => setTimeout(r, 1200 + Math.random() * 800));

      const recheck = await isCopilotCanceled(supabase, orgId, phone);
      if (recheck.canceled) { canceledMid = true; break; }

      const sendResult = await sendTextViaInstance(supabase, instance, phone, text, { trackSource: "copilot" });
      const msgId = sendResult.messageId
        ?? `batch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      await supabase.from("whatsapp_messages").upsert({
        organization_id: orgId,
        instance_id: (instance as { id: string }).id,
        message_id: msgId,
        remote_jid: `${phone}@s.whatsapp.net`,
        phone_number: phone,
        direction: "outgoing",
        message_type: "text",
        content: text,
        status: sendResult.success ? "sent" : "failed",
        timestamp: new Date().toISOString(),
        sent_by_ai: true,
        sent_source: "copilot",
      }, { onConflict: "message_id,instance_id", ignoreDuplicates: true });

      if (sendResult.success) chunksSent++;
      else sendFailed = true;
    }

    // Decisão de outcome:
    //  - nada enviado + cancelado no meio → gate (done, sem retry)
    //  - nada enviado + falha de envio    → transient (retry)
    //  - algo enviado (mesmo parcial)     → delivered (evita duplicar no retry)
    let outcome: DeliveryOutcome;
    if (chunksSent === 0 && canceledMid) outcome = { kind: "gate_blocked", source: "mid_delivery" };
    else if (chunksSent === 0 && sendFailed) outcome = { kind: "transient_error", error: "send_failed" };
    else outcome = { kind: "delivered" };
    await applyOutcome(outcome);

    if (outcome.kind === "delivered") {
      logEvent("copilot_batch_delivered", {
        functionName: "copilot-batch-processor",
        organizationId: orgId,
        tags: {
          "copilot.batch_size": claimedRows.length,
          "copilot.chunks_sent": chunksSent,
          "copilot.batch_key": batchKey,
          "copilot.forced_drain": forceDrain,
        },
      }).catch(() => {});
    }

    return json({
      ok: outcome.kind !== "transient_error",
      outcome: outcome.kind,
      chunks_sent: chunksSent,
      batch_key: batchKey,
    });
  } catch (err) {
    // Erro inesperado → retry (não perde a mensagem).
    await applyOutcome({ kind: "transient_error", error: err instanceof Error ? err.message : String(err) });
    return json({ error: "Processing exception", detail: String(err) }, 500);
  }
}));
