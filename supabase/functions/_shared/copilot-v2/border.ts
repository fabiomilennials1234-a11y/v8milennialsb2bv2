/**
 * border — Copilot v2 inbound border (Slice 1).
 *
 * Pipeline: validate → init trace → canonical phone → fail-CLOSED gates
 * (human-pause, loop) → dedup reservation → enqueue. Cognition (Slice 2) runs
 * later off the queue, never inline here.
 *
 * Invariants:
 *  - organization_id ALWAYS comes from the trusted edge context (resolved from
 *    the instance/secret), NEVER from the inbound payload (a provider can forge
 *    it). The payload's org field, if any, is ignored.
 *  - human-pause and loop gates are fail-CLOSED: a failed check blocks the turn.
 */

import { normalizeCanonicalPhone } from "./phone-normalizer.ts";
import { evaluateLoopSignal, decideLoopGate, type LoopMessage } from "./loop-detector.ts";
import { decideHumanPauseGate } from "./human-pause.ts";
import { buildDedupKey, dedupWindowSeconds, type DedupSource } from "./dedup-lock.ts";
import { coalesceFragments, type InboundFragment } from "./message-debounce.ts";
import { initTraceContext, logTraceStep, type TraceContext } from "./trace-context.ts";

export interface BorderContext {
  /** Resolved from the instance/secret — the trusted source of org identity. */
  organizationId: string;
  rawPhone: string | null;
  content: string;
  messageType?: string;
  source?: DedupSource;
  leadId?: string | null;
  conversationId?: string | null;
  isGroup?: boolean | null;
}

export type BorderAck =
  | { ack: "queued"; trace_id: string; queue_id: string }
  | { ack: "skipped"; reason: string; trace_id: string }
  | { ack: "error"; reason: string; trace_id?: string };

/**
 * Process one inbound message through the border. Returns the ack contract.
 * `supabase` is a service_role client created per request by index.ts.
 */
export async function processInbound(supabase: any, ctx: BorderContext): Promise<BorderAck> {
  // 1. Validate payload shape (untrusted input never touches the DB raw).
  if (!ctx.organizationId || typeof ctx.content !== "string" || ctx.content.trim() === "") {
    return { ack: "error", reason: "invalid_schema" };
  }

  // 2. Canonical phone (single key for every gate).
  const canonicalPhone = normalizeCanonicalPhone(ctx.rawPhone);
  if (!canonicalPhone) {
    return { ack: "error", reason: "invalid_phone" };
  }

  // 3. Trace seed.
  const trace: TraceContext = initTraceContext({
    org_id: ctx.organizationId,
    canonical_phone: canonicalPhone,
    lead_id: ctx.leadId ?? null,
    conversation_id: ctx.conversationId ?? null,
  });

  // Groups never trigger the agent (is_group empty-chat incident → default false).
  if (ctx.isGroup === true) {
    await logTraceStep(supabase, trace, "gate", "is_group_skipped");
    return { ack: "skipped", reason: "is_group", trace_id: trace.trace_id };
  }

  // 4. Human-pause gate (fail-CLOSED).
  const pauseGate = await checkHumanPause(supabase, ctx.organizationId, canonicalPhone, new Date());
  if (pauseGate.blocked) {
    await logTraceStep(supabase, trace, "gate", pauseGate.reason);
    return { ack: "skipped", reason: pauseGate.reason ?? "human_pause", trace_id: trace.trace_id };
  }

  // 5. Loop gate (fail-CLOSED).
  const loopGate = await checkLoop(supabase, ctx.organizationId, canonicalPhone, new Date());
  if (loopGate.block) {
    if (loopGate.reason === "bot_loop_detected") {
      await supabase.from("copilot_v2_pause_state").upsert({
        organization_id: ctx.organizationId,
        canonical_phone: canonicalPhone,
        paused_until: new Date(Date.now() + 60 * 60_000).toISOString(),
        reason: "bot_loop_detected",
        updated_at: new Date().toISOString(),
      });
    }
    await logTraceStep(supabase, trace, "gate", loopGate.reason);
    return { ack: "skipped", reason: loopGate.reason ?? "loop", trace_id: trace.trace_id };
  }

  // 6. Coalesce inbound fragments of the same burst into one turn (#19/#69).
  const source: DedupSource = ctx.source ?? "inbound";
  const content = source === "inbound"
    ? await coalesceInbound(supabase, ctx.organizationId, canonicalPhone, ctx.content, new Date())
    : ctx.content;

  // 7. Atomic dedup reservation.
  const dedupKey = buildDedupKey({ orgId: ctx.organizationId, phone: canonicalPhone, content, source });
  const { data: reserved, error: dedupErr } = await supabase.rpc("copilot_v2_acquire_dedup_lock", {
    p_dedup_key: dedupKey,
    p_org_id: ctx.organizationId,
    p_window_seconds: dedupWindowSeconds(source),
  });
  if (dedupErr) {
    // Dedup is fail-CLOSED: prefer dropping a possible duplicate to double-sending.
    await logTraceStep(supabase, trace, "gate", "dedup_check_failed");
    return { ack: "skipped", reason: "dedup_check_failed", trace_id: trace.trace_id };
  }
  if (reserved === false) {
    await logTraceStep(supabase, trace, "gate", "duplicate_suppressed");
    return { ack: "skipped", reason: "duplicate", trace_id: trace.trace_id };
  }

  // 7. Enqueue (idempotent).
  const { data: queueId, error: enqErr } = await supabase.rpc("copilot_v2_enqueue_message", {
    p_org_id: ctx.organizationId,
    p_lead_id: ctx.leadId ?? null,
    p_canonical_phone: canonicalPhone,
    p_message_type: ctx.messageType ?? "text",
    p_content: content,
    p_source: source,
    p_trace_id: trace.trace_id,
    p_idempotency_key: dedupKey,
  });
  if (enqErr) {
    return { ack: "error", reason: "enqueue_failed", trace_id: trace.trace_id };
  }

  await logTraceStep(supabase, trace, "enqueue", null, { message_type: ctx.messageType ?? "text" });
  return { ack: "queued", trace_id: trace.trace_id, queue_id: queueId };
}

async function checkHumanPause(supabase: any, orgId: string, phone: string, now: Date) {
  try {
    const { data, error } = await supabase.rpc("copilot_v2_check_human_pause", {
      p_org_id: orgId,
      p_canonical_phone: phone,
    });
    if (error) throw error;
    return decideHumanPauseGate({ record: data ? { paused_until: data } : null, checkErrored: false, now });
  } catch (_err) {
    return decideHumanPauseGate({ record: null, checkErrored: true, now });
  }
}

async function checkLoop(supabase: any, orgId: string, phone: string, now: Date) {
  try {
    const cutoff = new Date(now.getTime() - 120 * 1000).toISOString();
    const { data, error } = await supabase
      .from("copilot_v2_message_queue")
      .select("content, source, created_at")
      .eq("organization_id", orgId)
      .eq("canonical_phone", phone)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const messages: LoopMessage[] = (data ?? []).map((r: any) => ({
      content_hash: r.content,
      direction: r.source === "outbound" ? "outgoing" : "incoming",
      timestamp: r.created_at,
    }));
    const signal = evaluateLoopSignal({ messages, now });
    return decideLoopGate({ signal, checkErrored: false });
  } catch (_err) {
    return decideLoopGate({ signal: null, checkErrored: true });
  }
}

const DEBOUNCE_MS = 8_000;

/**
 * Coalesces the just-arrived inbound fragment with this contact's recent
 * un-replied inbound fragments (within the debounce window) into one turn.
 * Returns the coalesced content for the burst that contains `current`, or
 * `current` unchanged on any error (fail-OPEN here is safe: worst case is one
 * extra turn, never a lost message and never a double-send).
 */
async function coalesceInbound(
  supabase: any, orgId: string, phone: string, current: string, now: Date,
): Promise<string> {
  try {
    const cutoff = new Date(now.getTime() - DEBOUNCE_MS).toISOString();
    const { data, error } = await supabase
      .from("copilot_v2_message_queue")
      .select("content, source, created_at, status")
      .eq("organization_id", orgId)
      .eq("canonical_phone", phone)
      .eq("source", "inbound")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const prior: InboundFragment[] = (data ?? [])
      .filter((r: any) => r.status === "pending" || r.status === "retry" || r.status == null)
      .map((r: any) => ({ content: r.content, timestamp: r.created_at }));
    const fragments: InboundFragment[] = [...prior, { content: current, timestamp: now.toISOString() }];
    const groups = coalesceFragments(fragments, DEBOUNCE_MS);
    // The burst containing `current` is the last group (chronological).
    const last = groups[groups.length - 1];
    return last?.content ?? current;
  } catch (_err) {
    return current;
  }
}
