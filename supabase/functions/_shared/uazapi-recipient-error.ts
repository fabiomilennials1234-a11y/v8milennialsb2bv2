/**
 * Uazapi signals "recipient has no WhatsApp account" — a permanent,
 * client-addressable condition — with HTTP 500 on /send/text and /send/media,
 * body `{ error: "the number <jid>@s.whatsapp.net is not on WhatsApp", ... }`.
 * Treating it as a server fault feeds the circuit breaker and makes callers
 * retry a send that can never succeed, so the client reclassifies it.
 *
 * No `error_key` for this condition is documented (the OpenAPI fixture has no
 * 5xx schema), so the provider text is the primary signal. A key naming the
 * condition is accepted too, so a future structured marker keeps matching.
 */
export const RECIPIENT_NOT_ON_WHATSAPP = "recipient_not_on_whatsapp";

const KEY_PATTERN = /not[_\s-]?on[_\s-]?whatsapp/i;
const TEXT_MARKER = "is not on whatsapp";

export function isRecipientNotOnWhatsApp(errBody: unknown): boolean {
  if (typeof errBody !== "object" || errBody === null) return false;
  const body = errBody as Record<string, unknown>;

  for (const key of [body.error_key, body.code, body.error_code]) {
    if (typeof key === "string" && KEY_PATTERN.test(key)) return true;
  }
  for (const text of [body.error, body.message]) {
    if (typeof text === "string" && text.toLowerCase().includes(TEXT_MARKER)) return true;
  }
  return false;
}
