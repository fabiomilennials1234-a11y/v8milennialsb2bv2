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
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { getWhatsAppProvider } from "../_shared/whatsapp-client.ts";
import { resolveInstance, normalizeBrazilianPhone } from "../_shared/whatsapp-dispatch.ts";
import { processBatch, type QueueRow } from "../_shared/copilot-v2/queue-processor.ts";
import { routeArchetype, type ContactStatus } from "../_shared/copilot-v2/contact-status.ts";
import type { Archetype, ModelId } from "../_shared/copilot-v2/model-selector.ts";
import { createToolExecutor } from "../_shared/copilot-v2/tool-executor.ts";
import { decideHumanPauseGate } from "../_shared/copilot-v2/human-pause.ts";
import { resolveAgentCapabilities } from "../_shared/copilot-v2/capability-gate.ts";
import { createOpenRouterClient } from "../_shared/copilot-v2/openrouter-client.ts";
import { decideOutputJudge, shouldSampleJudge, buildJudgePrompt } from "../_shared/copilot-v2/output-judge.ts";
import { evaluateLoopSignal, decideLoopGate, type LoopMessage } from "../_shared/copilot-v2/loop-detector.ts";
import { decideHitlGate } from "../_shared/copilot-v2/hitl-gate.ts";
import { resolveHandoffTargets } from "../_shared/copilot-v2/handoff-routing.ts";
import type { ResolvedContext } from "../_shared/copilot-v2/cognition-worker.ts";
import type { AgentConfig } from "../_shared/copilot-v2/prompt-builder.ts";

const BATCH_SIZE = 10;

serve(
  withSentry("copilot-v2-worker", async (req: Request) => {
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
        agentId: context._agentId,
        sendMediaViaProvider: (p) => sendMediaReply(supabase, row.organization_id, p),
      }),
      sendReply: (canonicalPhone, text, row) => sendReply(supabase, row.organization_id, canonicalPhone, text),
      checkPause: async (row) => {
        try {
          const { data, error } = await supabase.rpc("copilot_v2_check_human_pause", {
            p_org_id: row.organization_id, p_canonical_phone: row.canonical_phone,
          });
          if (error) throw error;
          return decideHumanPauseGate({ record: data ? { paused_until: data } : null, checkErrored: false, now: new Date() });
        } catch (_err) {
          return decideHumanPauseGate({ record: null, checkErrored: true, now: new Date() });
        }
      },
      checkLoop: async (row) => {
        try {
          const cutoff = new Date(Date.now() - 120_000).toISOString();
          const { data, error } = await supabase
            .from("copilot_v2_message_queue")
            .select("content, source, created_at")
            .eq("organization_id", row.organization_id)
            .eq("canonical_phone", row.canonical_phone)
            .gte("created_at", cutoff)
            .order("created_at", { ascending: true });
          if (error) throw error;
          const messages: LoopMessage[] = (data ?? []).map((r: any) => ({
            content_hash: r.content,
            direction: r.source === "outbound" ? "outgoing" : "incoming",
            timestamp: r.created_at,
          }));
          const signal = evaluateLoopSignal({ messages, now: new Date() });
          const gate = decideLoopGate({ signal, checkErrored: false });
          return { blocked: gate.block, reason: gate.reason };
        } catch (_err) {
          const gate = decideLoopGate({ signal: null, checkErrored: true });
          return { blocked: gate.block, reason: gate.reason };
        }
      },
      checkHitl: async (row, context, toolNames) => {
        try {
          // Per-org toggle (default OFF) + judge sample rate live in org settings.
          const { data: settings } = await supabase
            .from("copilot_v2_org_settings")
            .select("hitl_enabled, judge_sample_rate")
            .eq("organization_id", row.organization_id).maybeSingle();
          // Surface the sample rate to the judge dep via the resolved context.
          if (settings && typeof settings.judge_sample_rate === "number") {
            (context as any)._judgeSampleRate = settings.judge_sample_rate;
          }
          const enabled = settings?.hitl_enabled === true;
          // Lead tier (org-scoped) — null when the lead is unknown/unclassified.
          let leadTier: string | null = null;
          if (row.lead_id) {
            const { data: lead } = await supabase
              .from("leads").select("qualification_tier")
              .eq("organization_id", row.organization_id).eq("id", row.lead_id).maybeSingle();
            leadTier = lead?.qualification_tier ?? null;
          }
          const decision = decideHitlGate({ enabled, toolNames, leadTier });
          if (decision.requiresApproval) {
            // Persist the proposal (org from the trusted row, never the LLM).
            await supabase.rpc("copilot_v2_create_hitl_proposal", {
              p_org_id: row.organization_id, p_lead_id: row.lead_id, p_trace_id: row.trace_id,
              p_conversation_id: row.conversation_id, p_reply: null, p_tools: toolNames, p_tier: leadTier,
            }).then(() => {}, () => {});
          }
          return { requiresApproval: decision.requiresApproval, reason: decision.reason };
        } catch (_err) {
          // fail-CLOSED on an infra error only when HITL is reachable-unknown is
          // unsafe to assume ON; the org toggle defaults OFF, so a settings read
          // failure leaves the agent autonomous (matching the default posture).
          return { requiresApproval: false, reason: null };
        }
      },
      judgeOutput: async (reply, _row, context) => {
        // Sampling: conservative default = judge every turn (rate from config slot).
        const rate = typeof (context as any)?._judgeSampleRate === "number" ? (context as any)._judgeSampleRate : 1.0;
        if (!shouldSampleJudge({ rng: Math.random, rate })) return { block: false, reason: null };
        try {
          const judgeLlm = createOpenRouterClient({ model: "google/gemini-2.5-flash", maxTokens: 64 });
          const policy = (context.configByArchetype?.[routeArchetype(context.contactStatus)] as any)?.commercialPolicy ?? null;
          const resp = await judgeLlm.complete({ system: buildJudgePrompt(reply, policy), messages: [], tools: [] });
          const verdict = JSON.parse(resp.text ?? "null");
          return decideOutputJudge({ verdict, checkErrored: false });
        } catch (_err) {
          return decideOutputJudge({ verdict: null, checkErrored: true });
        }
      },
      dispatchHandoff: async (row, payload) => {
        // Lead owners + tier (org-scoped — org ALWAYS from the trusted row).
        const { data: lead } = await supabase.from("leads")
          .select("responsible_id, closer_id, sdr_id, sale_responsible_id, pre_sale_responsible_id, qualification_tier")
          .eq("organization_id", row.organization_id).eq("id", payload.leadId ?? "__none__").maybeSingle();
        // Active members of the org (PII phone opt-in).
        const { data: members } = await supabase.from("team_members")
          .select("id, user_id, phone, is_active, role")
          .eq("organization_id", row.organization_id).eq("is_active", true);
        const routing = resolveHandoffTargets({ lead: lead ?? {}, members: members ?? [], activeTeam: members ?? [] });
        const optInPhones = routing.targets.map((t) => t.phone).filter((p): p is string => !!p);
        const idem = `transfer:${row.organization_id}:${payload.leadId ?? "noLead"}:${row.trace_id}`;
        const { data: status } = await supabase.rpc("copilot_v2_dispatch_handoff", {
          p_org_id: row.organization_id, p_lead_id: payload.leadId, p_trace_id: row.trace_id,
          p_idempotency_key: idem, p_reason: payload.reason, p_summary: payload.summary,
          p_tier: lead?.qualification_tier ?? null,
          p_target_user_ids: routing.targets.map((t) => t.userId),
          p_whatsapp_phones: optInPhones,
          p_title: "Lead precisa de atendimento humano",
          p_link: "/pipe-whatsapp",
        });
        // Only fire WhatsApp on a FRESH dispatch (idempotent — never on already_dispatched).
        if (status === "dispatched" && optInPhones.length) {
          const text = `🤝 Handoff: lead ${payload.leadId ?? ""} (${lead?.qualification_tier ?? "s/ tier"}) — ${payload.reason}. ${payload.summary ?? ""}`.trim();
          for (const phone of optInPhones) {
            try { await sendReply(supabase, row.organization_id, phone, text); } catch (_e) { /* per-phone best-effort */ }
          }
        }
      },
      recordOutbound: async (canonicalPhone, text, row) => {
        // Unique key per send: identical replies must each be recorded so the
        // identical_outgoing_burst signal can fire (do NOT collapse via dedup).
        const idem = `${row.organization_id}:${canonicalPhone}:outbound:${row.trace_id}:${crypto.randomUUID()}`;
        await supabase.rpc("copilot_v2_enqueue_message", {
          p_org_id: row.organization_id,
          p_lead_id: row.lead_id,
          p_canonical_phone: canonicalPhone,
          p_message_type: "text",
          p_content: text,
          p_source: "outbound",
          p_trace_id: row.trace_id,
          p_idempotency_key: idem,
        }).then(() => {}, () => {});
      },
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
 *
 * Proactive rows (Slice 11: source first_touch|followup|carteira_rescue) reuse
 * this EXACT path with no change: their `content` is already a system directive
 * (buildProactiveDirective), routing is by normalized_phone→contact-status
 * (defined for all three kinds — carteira_rescue maps to CLIENTE_CARTEIRA), and
 * the loop-gate (border.ts) only counts source === 'outbound' as outgoing, so
 * proactive sources never falsely trip the identical_outgoing_burst signal.
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
  let slots: Record<string, unknown> | null = null;
  if (agentRow) {
    const { data: cfg } = await supabase.from("copilot_v2_config").select("slots, escape_hatch_notes").eq("agent_id", agentRow.id).maybeSingle();
    if (cfg) { slots = cfg.slots ?? null; config = { ...(cfg.slots ?? {}), escapeHatchNotes: cfg.escape_hatch_notes }; }
  }

  // Live introspection: stages + custom fields (write-after-introspect uses these).
  const [{ data: stages }, { data: fields }] = await Promise.all([
    supabase.from("pipeline_stages").select("stage_key").eq("organization_id", row.organization_id).eq("is_active", true),
    supabase.from("lead_custom_fields").select("field_name").eq("organization_id", row.organization_id),
  ]);

  const emptyConfig: AgentConfig = {};
  const emptyCaps: Record<string, boolean | undefined> = {};
  const baseConfigs: Record<Archetype, AgentConfig> = { qualificador: emptyConfig, vendedor: emptyConfig, carteira: emptyConfig };
  const baseCaps: Record<Archetype, Record<string, boolean | undefined>> = { qualificador: emptyCaps, vendedor: emptyCaps, carteira: emptyCaps };

  return {
    contactStatus: status,
    activeArchetypes,
    // Only the routed archetype's config/caps are resolved this turn — key them
    // there, not fanned across all three (that masked a real multi-agent bug).
    configByArchetype: { ...baseConfigs, [archetype]: config },
    capabilitiesByArchetype: { ...baseCaps, [archetype]: agentRow ? resolveAgentCapabilities(slots) : emptyCaps },
    introspection: {
      stages: (stages ?? []).map((s: any) => s.stage_key),
      fields: (fields ?? []).map((f: any) => f.field_name),
    },
    _agentId: agentRow?.id ?? null,
  };
}

async function sendReply(supabase: any, orgId: string, canonicalPhone: string, text: string): Promise<void> {
  const instance = await resolveInstance(supabase, orgId, { requireConnected: true });
  if (!instance) throw new Error(`no connected WhatsApp instance for org ${orgId}`);
  const provider = await getWhatsAppProvider(instance, supabase);
  const number = normalizeBrazilianPhone(canonicalPhone) ?? canonicalPhone;
  const res = await provider.sendText({ number, text, trackSource: "copilot_v2" });
  if (!res?.success && (res as any)?.error) throw new Error(`sendText failed: ${(res as any).error}`);
}

/**
 * Real WhatsApp delivery for the send_media handler (Slice 6). Mirrors sendReply:
 * the instance is resolved by the row's org (border-trusted), never the LLM. A
 * failure is returned as { success:false } so the handler surfaces an explicit
 * fallback — never a silent drop (VitrineVET lesson).
 */
async function sendMediaReply(
  supabase: any, orgId: string,
  p: { number: string; type: "image" | "video" | "audio"; file: string; caption?: string; mediaId: string },
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  const instance = await resolveInstance(supabase, orgId, { requireConnected: true });
  if (!instance) return { success: false, error: `no connected WhatsApp instance for org ${orgId}` };
  const provider = await getWhatsAppProvider(instance, supabase);
  const number = normalizeBrazilianPhone(p.number) ?? p.number;
  try {
    const res = await provider.sendMedia({
      number, type: p.type, file: p.file, caption: p.caption,
      trackSource: "copilot_v2_send_media", trackId: p.mediaId,
    });
    return { success: res?.success !== false, message_id: (res as any)?.message_id };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
