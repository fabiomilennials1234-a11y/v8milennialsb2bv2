/**
 * Pure batch maturity logic for copilot-batch-processor.
 * Extracted for testability — no Supabase, no Deno, no side effects.
 */

export const BATCH_IDLE_WINDOW_MS = 5_000;   // 5s since last msg
export const BATCH_ABSOLUTE_CAP_MS = 15_000; // 15s since first msg

export interface BatchInfo {
  batchKey: string;
  oldestQueuedAt: Date;
  newestQueuedAt: Date;
  messageCount: number;
}

export type BatchMaturityReason = 'idle_window' | 'absolute_cap' | 'not_ready';

export interface BatchMaturityResult {
  isMature: boolean;
  reason: BatchMaturityReason;
}

export function checkBatchMaturity(batch: BatchInfo, now: Date): BatchMaturityResult {
  if (batch.messageCount <= 0) {
    return { isMature: false, reason: 'not_ready' };
  }

  const newestAge = now.getTime() - batch.newestQueuedAt.getTime();
  const oldestAge = now.getTime() - batch.oldestQueuedAt.getTime();

  // Check idle window first (most common path)
  if (newestAge >= BATCH_IDLE_WINDOW_MS) {
    return { isMature: true, reason: 'idle_window' };
  }

  // Hard cap: force maturity if batch has been accumulating too long
  if (oldestAge >= BATCH_ABSOLUTE_CAP_MS) {
    return { isMature: true, reason: 'absolute_cap' };
  }

  return { isMature: false, reason: 'not_ready' };
}
