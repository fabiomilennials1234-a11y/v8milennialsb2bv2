/**
 * queue-policy — política PURA de estado/retry da fila `copilot_message_queue`.
 *
 * Reducer: (linha atual, resultado da entrega, agora) → patch de estado a persistir.
 * Sem I/O. O worker (edge fn) e o SQL apenas aplicam o patch. Isola toda a
 * política de retry/backoff/terminação num módulo testável.
 */

export type QueueStatus = "pending" | "processing" | "done" | "failed";

export interface QueueItemState {
  status: QueueStatus;
  attempts: number;
}

export type DeliveryOutcome =
  | { kind: "delivered" }
  | { kind: "gate_blocked"; source: string }
  | { kind: "transient_error"; error: string };

export interface QueueItemPatch {
  status: QueueStatus;
  attempts?: number;
  processed_at?: string;
  next_attempt_at?: string;
  last_error?: string;
}

/** Máximo de tentativas antes de marcar como falha terminal. */
export const MAX_ATTEMPTS = 5;

/** Backoff exponencial (segundos) limitado, determinístico para teste. */
export function backoffSeconds(attempts: number): number {
  const BASE = 30;
  const CAP = 600;
  return Math.min(CAP, BASE * 2 ** Math.max(0, attempts - 1));
}

export interface ClaimableItem {
  status: QueueStatus;
  attempts: number;
  next_attempt_at: string | null;
  claimed_at: string | null;
}

/**
 * Decide se o sweep deve reivindicar a linha agora.
 * - pending: elegível quando o backoff já passou (next_attempt_at <= now ou null).
 * - processing: reclaimable se o lease expirou (worker morreu mid-flight).
 * - done/failed: nunca.
 */
export function isClaimable(item: ClaimableItem, now: Date, leaseSeconds: number): boolean {
  if (item.status === "pending") {
    if (!item.next_attempt_at) return true;
    return new Date(item.next_attempt_at).getTime() <= now.getTime();
  }
  if (item.status === "processing") {
    // Reclaim só quando o lease expirou — worker provavelmente morreu mid-flight.
    if (!item.claimed_at) return true;
    return now.getTime() - new Date(item.claimed_at).getTime() >= leaseSeconds * 1000;
  }
  return false;
}

export function reduceQueueItem(
  item: QueueItemState,
  outcome: DeliveryOutcome,
  now: Date,
): QueueItemPatch {
  // Entrega OK, ou gate fechou (IA desligada / humano assumiu) durante o turno:
  // ambos são terminais — descarta sem retry (humano não quer a resposta da IA).
  if (outcome.kind === "delivered" || outcome.kind === "gate_blocked") {
    return { status: "done", processed_at: now.toISOString() };
  }

  // transient_error → reagenda com backoff, até o limite.
  const attempts = item.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    return {
      status: "failed",
      attempts,
      last_error: outcome.error,
      processed_at: now.toISOString(),
    };
  }
  const nextAt = new Date(now.getTime() + backoffSeconds(attempts) * 1000);
  return {
    status: "pending",
    attempts,
    last_error: outcome.error,
    next_attempt_at: nextAt.toISOString(),
  };
}
