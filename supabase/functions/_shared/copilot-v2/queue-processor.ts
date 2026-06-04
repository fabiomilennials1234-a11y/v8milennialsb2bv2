/**
 * queue-processor — Copilot v2 worker orchestration (Slice 1/2 integration).
 *
 * Pure control flow over ONE claimed queue message. All side effects are
 * injected (ProcessorDeps) so this is unit-testable without DB/LLM/WhatsApp:
 *
 *   resolve context → handleQueuedMessage (cognition + gates) → send reply
 *   → markComplete; any throw → markFailed (the SQL RPC decides retry vs DLQ).
 *
 * A deferred turn (archetype not active for the org) is NOT an error — it
 * completes the message (nothing to send), leaving v1 / a human to handle it.
 */

import { handleQueuedMessage, type ResolvedContext } from "./cognition-worker.ts";
import type { LlmClient } from "./cognition-loop.ts";
import type { ModelId } from "./model-selector.ts";
import { buildDeliveryPlan, deliveryProfileFor } from "./outbound-delivery.ts";
import { buildDedupKey, dedupWindowSeconds } from "./dedup-lock.ts";

export interface QueueRow {
  id: string;
  organization_id: string;
  lead_id: string | null;
  canonical_phone: string;
  conversation_id: string | null;
  content: string;
  message_type: string;
  trace_id: string;
}

export interface ProcessorDeps {
  /** Builds the ResolvedContext (contact-status, agents, config, introspection) from the DB. */
  resolveContext: (row: QueueRow) => Promise<ResolvedContext>;
  makeLlm: (model: ModelId) => LlmClient;
  /** Builds the per-message tool executor (bound to this lead/agent/org). W10:
   *  `opts.ragShrink` shrinks retrieval under cost pressure. */
  makeExecutor: (row: QueueRow, context: ResolvedContext, opts?: { ragShrink?: boolean }) => (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Re-checks the human-pause gate at SEND time (the durable-queue + retry window). */
  checkPause: (row: QueueRow) => Promise<{ blocked: boolean; reason: string | null }>;
  /** Re-checks the loop gate at SEND time (durable-queue window). fail-CLOSED. */
  checkLoop?: (row: QueueRow) => Promise<{ blocked: boolean; reason: string | null }>;
  /** HITL gate (Slice 5): per-org toggle. ON + critical tool + high-value lead → require approval. */
  checkHitl?: (row: QueueRow, context: ResolvedContext, toolNames: string[]) => Promise<{ requiresApproval: boolean; reason: string | null }>;
  /** Dispatches the structured handoff notification (idempotent — RPC owns the key). */
  dispatchHandoff?: (row: QueueRow, payload: { leadId: string | null; reason: string; summary: string | null; tier?: string | null }) => Promise<void>;
  /** Output LLM-as-judge: vets the reply pre-send (Slice 5). fail-CLOSED. */
  judgeOutput?: (reply: string, row: QueueRow, context: ResolvedContext) => Promise<{ block: boolean; reason: string | null }>;
  sendReply: (canonicalPhone: string, text: string, row: QueueRow) => Promise<void>;
  /** Records the sent reply as an outbound queue row so the loop gate sees the outgoing side. */
  recordOutbound: (canonicalPhone: string, text: string, row: QueueRow) => Promise<void>;
  /** W4: human latency — sleeps `ms` before a chunk. Absent (tests) = instant. */
  delay?: (ms: number) => Promise<void>;
  /** W4: "typing"/composing presence before a chunk (best-effort, never blocks send). */
  setTyping?: (canonicalPhone: string, on: boolean, row: QueueRow) => Promise<void>;
  /** W4: atomic outbound dedup — reserves the chunk key; false = already sent within the window. */
  acquireOutboundLock?: (dedupKey: string, windowSeconds: number, row: QueueRow) => Promise<boolean>;
  markComplete: (id: string) => Promise<void>;
  markFailed: (id: string, error: string) => Promise<void>;
  logStep: (traceId: string, step: string, reason: string | null, meta?: Record<string, unknown>) => Promise<void>;
  // ── W10 cost governance (all optional — absent = no governance, flow unchanged) ──
  /** Reads the org's caps + accrued spend and decides the cost gate for this turn.
   *  fail-CLOSED inside the impl; if it throws, the spine degrades-and-serves. */
  checkCost?: (row: QueueRow) => Promise<{ degradeLevel: 0 | 1 | 2 | 3; hardPause: boolean; reason: string | null }>;
  /** Auto-pauses the whole org (hard monthly cap). Reason is the org-pause enum. */
  pauseOrg?: (row: QueueRow, reason: string) => Promise<void>;
  /** Notifies the org admin (in-app) that the org was auto-paused. */
  notifyAdmin?: (row: QueueRow, reason: string) => Promise<void>;
  /** Holding pattern: re-queues the turn for a cheaper window (bounded — see below). */
  holdTurn?: (row: QueueRow) => Promise<void>;
  /** Records the turn's token usage + USD cost into the ledger (best-effort). */
  recordCost?: (row: QueueRow, usage: { promptTokens: number; completionTokens: number }, model: string) => Promise<void>;
}

// Mirrors decideDegradation's thresholds (degradation.ts) so the spine can act
// before the model is resolved: L2+ shrinks retrieval, L3 holds the turn.
const RAG_SHRINK_LEVEL = 2;
const HOLDING_LEVEL = 3;
// fail-safe when the cost dep itself throws: serve at cheapest (model+retrieval),
// never hold/pause on an unexpected error.
const COST_FAILSAFE = { degradeLevel: 2 as const, hardPause: false, reason: 'cost_check_failed' };

export async function processQueueMessage(row: QueueRow, deps: ProcessorDeps): Promise<void> {
  try {
    const context = await deps.resolveContext(row);

    // ── W10 cost gate (pre-LLM) ──────────────────────────────────────────────
    // Read the org's spend vs caps. fail-safe: a throwing dep degrades-and-serves
    // (never fails the message). hardPause → auto-pause the org + notify, no send.
    // L3 → hold the turn once (bounded). L2 → shrink retrieval. L1 → cheaper model.
    let cost: { degradeLevel: 0 | 1 | 2 | 3; hardPause: boolean; reason: string | null } = { degradeLevel: 0, hardPause: false, reason: null };
    if (deps.checkCost) {
      try { cost = await deps.checkCost(row); }
      catch { cost = COST_FAILSAFE; }
    }

    if (cost.hardPause) {
      // Hard monthly cap breached → take the whole org offline (best-effort) and
      // tell the admin. The turn is completed (not failed) — nothing to send.
      try { await deps.pauseOrg?.(row, 'teto'); } catch { /* best-effort */ }
      try { await deps.notifyAdmin?.(row, 'teto'); } catch { /* best-effort */ }
      await deps.logStep(row.trace_id, "gate", cost.reason ?? "hard_monthly_cap");
      await deps.markComplete(row.id);
      return;
    }

    // Holding pattern (deepest soft band): defer this turn to a cheaper window by
    // re-queuing ONCE. Bounded — a row that is already a 'held' re-queue serves
    // degraded instead, so a persistently-over-soft org is never starved.
    if (cost.degradeLevel >= HOLDING_LEVEL && row.message_type !== 'held' && deps.holdTurn) {
      try { await deps.holdTurn(row); } catch { /* best-effort: fall through to serve */ }
      await deps.logStep(row.trace_id, "gate", "cost_holding_pattern", { degradeLevel: cost.degradeLevel });
      await deps.markComplete(row.id);
      return;
    }

    const ragShrink = cost.degradeLevel >= RAG_SHRINK_LEVEL;

    const result = await handleQueuedMessage({
      message: { content: row.content, canonicalPhone: row.canonical_phone },
      context,
      makeLlm: deps.makeLlm,
      executeTool: deps.makeExecutor(row, context, { ragShrink }),
      degradeLevel: cost.degradeLevel,
    });

    if (!result.handled) {
      // Routed archetype isn't enabled for this org — defer, not fail.
      await deps.logStep(row.trace_id, "cognition", result.reason ?? "deferred", { archetype: result.archetype });
      await deps.markComplete(row.id);
      return;
    }

    await deps.logStep(row.trace_id, "cognition", result.stoppedReason, {
      archetype: result.archetype, model: result.model, steps: result.steps.length,
    });

    // W10: record the turn's token spend into the ledger. Best-effort for the
    // TURN (a ledger hiccup must never drop the reply), but the failure is logged
    // to the trace — a PERSISTENT silent loss would stale the ledger and let the
    // cost gate under-degrade, so it must be detectable, not swallowed.
    if (deps.recordCost && result.usage) {
      try {
        await deps.recordCost(row, result.usage, result.model);
      } catch {
        await deps.logStep(row.trace_id, "gate", "cost_record_failed");
      }
    }

    // Handoff dispatch: if a permitted transfer_to_human fired this turn, deliver
    // the structured notification (idempotent — the RPC owns the stable key). The
    // notification does NOT depend on the reply, so it runs before the send.
    if (deps.dispatchHandoff) {
      const transferStep = result.steps.find((s) => s.name === "transfer_to_human" && s.allowed);
      if (transferStep) {
        const h = (transferStep.result as any)?.handoff ?? {};
        await deps.dispatchHandoff(row, {
          leadId: h.leadId ?? row.lead_id ?? null,
          reason: h.reason ?? "transfer",
          summary: h.summary ?? null,
        });
      }
    }

    if (result.reply && result.reply.trim() !== "") {
      if (deps.checkHitl) {
        const proposedTools = result.steps.filter((s) => s.allowed).map((s) => s.name);
        const hitl = await deps.checkHitl(row, context, proposedTools);
        if (hitl.requiresApproval) {
          // HITL ON + a critical action on a high-value lead — do NOT send. The
          // worker wrote an approval proposal; the turn is suppressed until a human
          // approves/edits/rejects.
          await deps.logStep(row.trace_id, "gate", hitl.reason ?? "hitl_approval_required", { tools: proposedTools });
          await deps.markComplete(row.id);
          return;
        }
      }
      if (deps.checkLoop) {
        const loop = await deps.checkLoop(row);
        if (loop.blocked) {
          // The loop state evolved after enqueue (durable-queue window) — suppress
          // (complete, not fail). Loop is cheaper than the judge, so it runs first.
          await deps.logStep(row.trace_id, "gate", loop.reason ?? "bot_loop_detected");
          await deps.markComplete(row.id);
          return;
        }
      }
      if (deps.judgeOutput) {
        const judge = await deps.judgeOutput(result.reply, row, context);
        if (judge.block) {
          // The reply failed the pre-send judge (or the judge errored) — suppress,
          // do not send. Logged for observability; the turn is correctly stopped.
          await deps.logStep(row.trace_id, "gate", judge.reason ?? "output_judge_blocked");
          await deps.markComplete(row.id);
          return;
        }
      }

      // W4 — delivery realism. Split the reply into natural WhatsApp chunks, then
      // for each chunk: re-check human-pause (a human may take over mid-stream
      // while the per-chunk latency elapses — never talk over them); suppress an
      // exact duplicate within the outbound window (per-chunk → retry-safe: a
      // failed partial send resumes without re-sending what already went out);
      // drive a "typing" presence + human delay; then send + record.
      const profile = deliveryProfileFor(result.archetype);
      const plan = buildDeliveryPlan(result.reply, row.content?.length ?? 0, profile);
      let sentAny = false;
      for (let i = 0; i < plan.chunks.length; i++) {
        const pause = await deps.checkPause(row);
        if (pause.blocked) {
          await deps.logStep(row.trace_id, "gate", pause.reason ?? "human_pause_active");
          await deps.markComplete(row.id);
          return;
        }
        const chunk = plan.chunks[i];
        if (deps.acquireOutboundLock) {
          const dedupKey = buildDedupKey({
            orgId: row.organization_id,
            phone: row.canonical_phone,
            content: chunk,
            source: "outbound",
          });
          const reserved = await deps.acquireOutboundLock(dedupKey, dedupWindowSeconds("outbound"), row);
          if (!reserved) {
            // Identical chunk already sent within the window — skip, do not repeat.
            await deps.logStep(row.trace_id, "outbound", "duplicate_suppressed", { chunk: i });
            continue;
          }
        }
        const ms = plan.delays[i];
        if (ms > 0) {
          if (deps.setTyping) await deps.setTyping(row.canonical_phone, true, row);
          if (deps.delay) await deps.delay(ms);
        }
        await deps.sendReply(row.canonical_phone, chunk, row);
        await deps.recordOutbound(row.canonical_phone, chunk, row);
        sentAny = true;
      }
      if (sentAny) await deps.logStep(row.trace_id, "outbound", null);
    }

    await deps.markComplete(row.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await deps.markFailed(row.id, msg);
  }
}

/** Drains a claimed batch sequentially (each isolated — one failure never stops the rest). */
export async function processBatch(rows: QueueRow[], deps: ProcessorDeps): Promise<{ processed: number }> {
  for (const row of rows) {
    await processQueueMessage(row, deps);
  }
  return { processed: rows.length };
}
