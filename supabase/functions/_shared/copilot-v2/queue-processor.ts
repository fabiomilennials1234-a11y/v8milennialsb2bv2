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
  /** Builds the per-message tool executor (bound to this lead/agent/org). */
  makeExecutor: (row: QueueRow, context: ResolvedContext) => (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Re-checks the human-pause gate at SEND time (the durable-queue + retry window). */
  checkPause: (row: QueueRow) => Promise<{ blocked: boolean; reason: string | null }>;
  sendReply: (canonicalPhone: string, text: string, row: QueueRow) => Promise<void>;
  /** Records the sent reply as an outbound queue row so the loop gate sees the outgoing side. */
  recordOutbound: (canonicalPhone: string, text: string, row: QueueRow) => Promise<void>;
  markComplete: (id: string) => Promise<void>;
  markFailed: (id: string, error: string) => Promise<void>;
  logStep: (traceId: string, step: string, reason: string | null, meta?: Record<string, unknown>) => Promise<void>;
}

export async function processQueueMessage(row: QueueRow, deps: ProcessorDeps): Promise<void> {
  try {
    const context = await deps.resolveContext(row);

    const result = await handleQueuedMessage({
      message: { content: row.content, canonicalPhone: row.canonical_phone },
      context,
      makeLlm: deps.makeLlm,
      executeTool: deps.makeExecutor(row, context),
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

    if (result.reply && result.reply.trim() !== "") {
      const pause = await deps.checkPause(row);
      if (pause.blocked) {
        // A human took over between enqueue and now — suppress, do not talk over.
        await deps.logStep(row.trace_id, "gate", pause.reason ?? "human_pause_active");
        await deps.markComplete(row.id);
        return;
      }
      await deps.sendReply(row.canonical_phone, result.reply, row);
      await deps.recordOutbound(row.canonical_phone, result.reply, row);
      await deps.logStep(row.trace_id, "outbound", null);
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
