/**
 * Uazapi answers 503 when the instance's own WhatsApp session is down (phone
 * logged out, QR expired) — body captured in prod on 2026-11-24:
 * `{ "error": true, "message": "WhatsApp disconnected: session is not reconnectable" }`.
 *
 * The provider is healthy and refused BEFORE sending: nothing went out. Treating
 * it as a server fault made every send on a dead number slow and misleading —
 * internal retries, a circuit breaker that hid the real reason, a ~10 s
 * delivery reconciliation and "it may have been delivered" in the chat. The
 * client therefore tags it with a stable code instead.
 *
 * The status stays 503: automations and the dunning ruler already treat 5xx as
 * "retry later", which is right for a number that may be re-paired in minutes.
 * Only the chat proxy maps the code to a pre-delivery refusal.
 */
export const INSTANCE_DISCONNECTED = "instance_disconnected";

const TEXT_PATTERN =
  /whatsapp disconnected|session is not reconnectable|instance (?:is )?(?:disconnected|not connected)|not logged in/i;

/** First string among the provider's `error` / `message` (Uazapi sends `error: true`). */
export function uazapiErrorText(errBody: unknown): string | null {
  if (typeof errBody !== "object" || errBody === null) return null;
  const body = errBody as Record<string, unknown>;
  for (const value of [body.error, body.message]) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

export function isInstanceDisconnected(errBody: unknown): boolean {
  const text = uazapiErrorText(errBody);
  return text !== null && TEXT_PATTERN.test(text);
}
