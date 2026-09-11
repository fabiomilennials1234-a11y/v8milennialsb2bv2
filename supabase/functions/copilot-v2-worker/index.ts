/**
 * copilot-v2-worker — Copilot v2 queue drainer (Slice 1/2 integration).
 *
 * Cron (pg_cron → pg_net, 1/min), auth x-cron-secret. Claims a batch from
 * copilot_v2_message_queue (atomic SKIP LOCKED), resolves each message's
 * ResolvedContext from the DB, runs the cognition turn via the pure
 * queue-processor, sends the reply over WhatsApp, and marks processed/retry/dead.
 *
 * This is the I/O shell — all decision logic lives in the pure modules
 * (queue-processor, cognition-worker, tool-executor, gates), which are unit-
 * tested. Org is ALWAYS taken from the queued row (set at the trusted border),
 * never from the LLM.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { getWhatsAppProvider } from "../_shared/whatsapp-client.ts";
import { resolveInstance, normalizeBrazilianPhone } from "../_shared/whatsapp-dispatch.ts";
import { governSend, isSkippedSend } from "../_shared/send-governor/gate.ts";
import { persistOutboundMessage } from "../_shared/action-handlers/whatsapp-helpers.ts";
import { processBatch, type QueueRow } from "../_shared/copilot-v2/queue-processor.ts";
import { routeArchetype, type ContactStatus } from "../_shared/copilot-v2/contact-status.ts";
import { modelForArchetype, type Archetype, type ModelId } from "../_shared/copilot-v2/model-selector.ts";
import { createToolExecutor } from "../_shared/copilot-v2/tool-executor.ts";
import { createOpenRouterClient } from "../_shared/copilot-v2/openrouter-client.ts";
import type { ResolvedContext } from "../_shared/copilot-v2/cognition-worker.ts";
import type { AgentConfig } from "../_shared/copilot-v2/prompt-builder.ts";

const BATCH_SIZE = 10;

serve(
  withErrorBoundary("copilot-v2-worker", async (req: Request) => {
    const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const json = (b: unknown, s = 200) =>
      new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

    // Auth: cron secret only.
    if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
      return json({ error: "unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Atomic claim.
    const { data: claimed, error: claimErr } = await supabase.rpc("copilot_v2_claim_messages", { p_batch_size: BATCH_SIZE });
    if (claimErr) return json({ error: `claim failed: ${claimErr.message}` }, 500);
    const rows = (claimed ?? []) as QueueRow[];
    if (rows.length === 0) return json({ processed: 0 });

    // Ensure the parent trace row exists before any step insert (FK:
    // trace_steps.trace_id → traces.trace_id). Created once per message.
    const tracesOpened = new Set<string>();
    async function ensureTrace(row: QueueRow): Promise<void> {
      if (tracesOpened.has(row.trace_id)) return;
      tracesOpened.add(row.trace_id);
      await supabase.from("copilot_v2_traces").upsert({
        trace_id: row.trace_id,
        organization_id: row.organization_id,
        lead_id: row.lead_id,
        conversation_id: row.conversation_id,
        status: "open",
      }, { onConflict: "trace_id" }).then(() => {}, () => {});
    }

    // 2. Drain via the pure processor with real deps.
    const result = await processBatch(rows, {
      resolveContext: async (row) => { await ensureTrace(row); return resolveContext(supabase, row); },
      makeLlm: (model: ModelId) => createOpenRouterClient({ model, maxTokens: 2048 }),
      makeExecutor: (row, context) => createToolExecutor(supabase, {
        organizationId: row.organization_id,
        leadId: row.lead_id,
        conversationId: row.conversation_id,
        canonicalPhone: row.canonical_phone,
        agentId: (context as ResolvedContext & { _agentId?: string | null })._agentId ?? null,
      }),
      sendReply: (canonicalPhone, text, row) =>
        sendReply(supabase, row.organization_id, canonicalPhone, text, row.lead_id),
      markComplete: async (id) => { await supabase.rpc("copilot_v2_complete_message", { p_id: id }); },
      markFailed: async (id, err) => { await supabase.rpc("copilot_v2_fail_message", { p_id: id, p_error: err.slice(0, 500) }); },
      logStep: async (traceId, step, reason, meta) => {
        await supabase.from("copilot_v2_trace_steps").insert({ trace_id: traceId, step, reason, meta: meta ?? {} }).then(() => {}, () => {});
      },
    });

    return json(result);
  }),
);

/**
 * Builds the ResolvedContext for one queued message from the DB:
 * contact-status → archetype, the org's active agent + config + capabilities,
 * and the live introspection (pipeline stages + custom fields).
 */
async function resolveContext(supabase: any, row: QueueRow): Promise<ResolvedContext> {
  // Contact status: lead → carteira (upsell_clients) → qualifying tier.
  const { data: lead } = await supabase
    .from("leads").select("id, qualification_tier")
    .eq("organization_id", row.organization_id).eq("normalized_phone", row.canonical_phone)
    .is("deleted_at", null).maybeSingle();

  let status: ContactStatus = "NOVO";
  if (lead) {
    const { data: client } = await supabase
      .from("upsell_clients").select("id").eq("organization_id", row.organization_id).eq("lead_id", lead.id).maybeSingle();
    if (client) status = "CLIENTE_CARTEIRA";
    else if (lead.qualification_tier && ["diamante", "ouro", "prata", "bronze"].includes(lead.qualification_tier)) status = "QUALIFIED";
    else status = "LEAD_NO_PIPELINE";
  }
  const archetype = routeArchetype(status);

  // Active agents for the org (is_active).
  const { data: agents } = await supabase
    .from("copilot_v2_agents").select("id, archetype, is_active").eq("organization_id", row.organization_id).eq("is_active", true);
  const activeArchetypes = new Set<Archetype>((agents ?? []).map((a: any) => a.archetype));
  const agentRow = (agents ?? []).find((a: any) => a.archetype === archetype);

  // Config for the routed archetype.
  let config: AgentConfig = {};
  if (agentRow) {
    const { data: cfg } = await supabase.from("copilot_v2_config").select("slots, escape_hatch_notes").eq("agent_id", agentRow.id).maybeSingle();
    if (cfg) config = { ...(cfg.slots ?? {}), escapeHatchNotes: cfg.escape_hatch_notes };
  }

  // Live introspection: stages + custom fields (write-after-introspect uses these).
  const [{ data: stages }, { data: fields }] = await Promise.all([
    supabase.from("pipeline_stages").select("stage_key").eq("organization_id", row.organization_id).eq("is_active", true),
    supabase.from("lead_custom_fields").select("field_name").eq("organization_id", row.organization_id),
  ]);

  const empty: AgentConfig = {};
  return {
    contactStatus: status,
    activeArchetypes,
    configByArchetype: { qualificador: config, vendedor: config, carteira: config } as Record<Archetype, AgentConfig>,
    capabilitiesByArchetype: {
      qualificador: capsFor(agentRow), vendedor: capsFor(agentRow), carteira: capsFor(agentRow),
    } as Record<Archetype, Record<string, boolean | undefined>>,
    introspection: {
      stages: (stages ?? []).map((s: any) => s.stage_key),
      fields: (fields ?? []).map((f: any) => f.field_name),
    },
    _agentId: agentRow?.id ?? null,
  } as ResolvedContext & { _agentId: string | null };
}

// All capabilities on by default for an active agent; per-capability config is Slice 8.
function capsFor(agentRow: any): Record<string, boolean | undefined> {
  if (!agentRow) return {};
  return {
    can_move_stage: true, can_schedule_meeting: true, can_set_tier: true,
    can_fill_field: true, can_send_media: true, can_transfer: true, can_handoff: true,
  };
}

async function sendReply(
  supabase: any,
  orgId: string,
  canonicalPhone: string,
  text: string,
  leadId: string | null,
): Promise<void> {
  const instance = await resolveInstance(supabase, orgId, { requireConnected: true });
  if (!instance) throw new Error(`no connected WhatsApp instance for org ${orgId}`);
  const provider = await getWhatsAppProvider(instance, supabase);
  const number = normalizeBrazilianPhone(canonicalPhone) ?? canonicalPhone;

  // Send Governor (SHADOW in PR-0): evaluates + logs the would-be decision but
  // NEVER blocks — doSend always runs and the caller shape is preserved. The
  // copilot v2 turn is automation traffic. FAIL-OPEN: any governor error falls
  // through to the send. supabase here is the service-role client (bypasses RLS).
  const governed = await governSend(
    supabase,
    { orgId, instanceId: instance.id, category: "automation", recipientPhone: number, trackSource: "copilot_v2", content: text },
    () => provider.sendText({ number, text, trackSource: "copilot_v2" }),
  );
  // Forward-safe: unreachable in SHADOW (the send always runs). Under a future
  // enforce mode a block/defer returns without having sent — treat as no-op here.
  if (isSkippedSend(governed)) return;
  const res = governed;
  if (!res?.success && (res as any)?.error) throw new Error(`sendText failed: ${(res as any).error}`);

  // A resposta do Copilot v2 precisa virar linha em `whatsapp_messages` com o
  // id do provider. Sem isso o eco `fromMe` entra rotulado `manual`, e o
  // `trg_human_pause_on_manual_send` pausa o Copilot — quer dizer, o v2 pausaria
  // a si mesmo a cada resposta que desse.
  //
  // Fica FORA do caminho de erro: falha ao persistir não pode virar exceção aqui,
  // senão o `processBatch` marcaria como falha uma mensagem que JÁ foi entregue e
  // a reenviaria na próxima passada. `persistOutboundMessage` já engole os
  // próprios erros; este `catch` é o cinto de segurança contra o resto.
  try {
    await persistOutboundMessage(supabase, {
      organizationId: orgId,
      instanceId: instance.id,
      providerMessageId: (res as any)?.message_id,
      phone: number,
      messageType: "conversation",
      content: text,
      leadId,
      sentSource: "copilot",
      fallbackIdPrefix: "cpv2",
    });
  } catch (err) {
    // Só `message`, nunca o objeto cru: `persistOutboundMessage` mantém o
    // payload FORA do log porque erro de constraint do PostgREST ecoa os valores
    // da chave — e a linha carrega `phone_number`, `remote_jid` e o `content` da
    // conversa com o lead. Um catch mais largo aqui não pode desfazer isso.
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[copilot-v2-worker] persist failed (mensagem JÁ entregue):", detail);
  }
}
