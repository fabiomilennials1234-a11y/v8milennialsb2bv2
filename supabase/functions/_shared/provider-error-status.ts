import { INSTANCE_DISCONNECTED } from "./uazapi-instance-error.ts";

/**
 * Provider rejections that are an expected, client-addressable outcome
 * ("Message not found" on downloadMedia/markRead), not a server fault.
 * The proxy forwards these statuses instead of collapsing them into 500, so
 * monitoring only counts genuine failures and the client sees the real cause.
 *
 * Deliberately a short allowlist: 429/5xx/timeout stay 500 because the chat
 * client's bounded recovery (send-recovery.ts) treats them as ambiguous.
 */
const PASSTHROUGH_STATUSES: ReadonlySet<number> = new Set([404, 422]);

export function providerPassthroughStatus(error: unknown): 404 | 422 | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && PASSTHROUGH_STATUSES.has(status) ? (status as 404 | 422) : null;
}

export interface ProviderRefusal {
  status: 409;
  code: string;
  /** pt-BR, ready for the seller: what happened, that nothing was sent, what to do. */
  message: string;
}

/**
 * Failures where the provider was never asked to deliver, or refused before
 * delivering: nothing went out, so the client may send again once the cause
 * is gone. Returned as 409 (conflict with the number's current state) so the
 * chat's bounded recovery stops at once instead of polling for a delivery
 * that cannot exist — before this, a send on a logged-out number took
 * ~10 s in the proxy plus ~30 s of client recovery, and ended in "it may have
 * been delivered".
 */
export function providerRefusal(error: unknown): ProviderRefusal | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { provider_code?: unknown }).provider_code;
  if (code === INSTANCE_DISCONNECTED) {
    return {
      status: 409,
      code: INSTANCE_DISCONNECTED,
      message:
        "Este número do WhatsApp está desconectado e a mensagem não foi enviada. " +
        "Reconecte o número em Configurações > WhatsApp e envie de novo.",
    };
  }
  if (code === "circuit_breaker_open") {
    return {
      status: 409,
      code: "circuit_breaker_open",
      message:
        "O envio por este número foi pausado por alguns instantes após falhas seguidas no serviço do WhatsApp. " +
        "A mensagem não foi enviada. Tente de novo em até 2 minutos.",
    };
  }
  return null;
}
