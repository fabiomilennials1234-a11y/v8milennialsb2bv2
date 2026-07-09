/**
 * batch-helpers.ts — Pure functions for copilot message batching.
 *
 * Extracted from agent-message/index.ts so they can be unit-tested
 * without spinning up the full Deno edge function.
 */

import { logEvent } from "../_shared/error-boundary.ts";

/**
 * Concatenate an array of channel_messages into a single string
 * for the LLM to process as one turn.
 *
 * Messages are joined with newlines, preserving order (caller must
 * sort by created_at ASC before calling).
 */
export function buildBatchContent(messages: { content: string | null }[]): string {
  return messages.map((m) => m.content).filter(Boolean).join("\n");
}

/**
 * Run the post-LLM absorb loop: after engine.processMessage completes,
 * check the copilot_message_queue for new pending messages that arrived
 * while the LLM was thinking. Claim and process up to MAX_ABSORB batches.
 *
 * Returns total number of extra messages processed.
 */
export const MAX_ABSORB_ITERATIONS = 3;

export async function absorbPendingMessages(opts: {
  supabase: any;
  engine: { processMessage: (leadId: string, content: string, type: string) => Promise<any> };
  leadId: string;
  from: string;
  organizationId: string;
}): Promise<{ iterations: number; messagesProcessed: number }> {
  const { supabase, engine, leadId, from, organizationId } = opts;
  const batchKey = `${from}:${organizationId}`;
  let iterations = 0;
  let messagesProcessed = 0;

  while (iterations < MAX_ABSORB_ITERATIONS) {
    // Check for pending messages
    const { data: newPending } = await supabase
      .from("copilot_message_queue")
      .select("id, message_id")
      .eq("batch_key", batchKey)
      .eq("status", "pending")
      .order("queued_at", { ascending: true });

    if (!newPending || newPending.length === 0) break;

    // Claim them atomically
    const { data: claimed } = await supabase.rpc("claim_copilot_batch", {
      p_batch_key: batchKey,
    });
    if (!claimed || claimed.length === 0) break;

    // Load message content
    const newMessageIds = claimed.map((r: any) => r.message_id);
    const { data: msgs } = await supabase
      .from("channel_messages")
      .select("content")
      .in("id", newMessageIds)
      .order("created_at", { ascending: true });

    if (msgs && msgs.length > 0) {
      const combinedContent = buildBatchContent(msgs);
      await engine.processMessage(leadId, combinedContent, "text");
      messagesProcessed += msgs.length;
    }

    // Mark done
    await supabase
      .from("copilot_message_queue")
      .update({ status: "done", processed_at: new Date().toISOString() })
      .in("id", claimed.map((r: any) => r.id));

    iterations++;
  }

  if (iterations > 0) {
    logEvent("copilot_absorb_completed", {
      functionName: "agent-message",
      organizationId,
      tags: {
        "copilot.absorb_iterations": iterations,
        "copilot.lock_source": "db",
      },
    }).catch(() => {});
  }

  return { iterations, messagesProcessed };
}
