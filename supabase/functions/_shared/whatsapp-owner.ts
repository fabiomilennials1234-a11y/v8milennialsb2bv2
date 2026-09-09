// deno-lint-ignore-file no-explicit-any

/**
 * Owner-number extraction for WhatsApp instances.
 *
 * Uazapi exposes the *connected account's own number* under inconsistent keys
 * depending on endpoint and server version: `owner`, `wid`, `jid`, a nested
 * `instance.owner`, or `status.jid` (the `{ connected, loggedIn, jid }` object
 * returned by /instance/init). The provider schema is known-unstable (incident
 * 2026-05-14), so we scan a prioritized candidate set rather than trusting a
 * single field name — same defensive posture as the webhook resolver.
 *
 * Returns the number as bare digits (no `@s.whatsapp.net` suffix, no `:NN`
 * multi-device suffix), or `undefined` when nothing usable is present.
 */

// `jidToPhone` mora em `whatsapp-jid.ts` desde que o backfill de histórico
// precisou da mesma regra (grupo e LID não são telefone). Re-exportado aqui
// para não quebrar quem já importava deste módulo.
export { jidToPhone } from "./whatsapp-jid.ts";
import { jidToPhone } from "./whatsapp-jid.ts";

// Keys, in priority order, observed (or plausible) to carry the connected
// account's own number across Uazapi endpoints/versions.
const OWNER_KEYS = [
  "owner",
  "wid",
  "wuid",
  "jid",
  "me",
  "myJid",
  "phoneConnected",
  "phone",
  "number",
] as const;

function scan(obj: any): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  for (const key of OWNER_KEYS) {
    const phone = jidToPhone(obj[key]);
    if (phone) return phone;
  }
  return undefined;
}

/**
 * Best-effort extraction of the connected account's number from any Uazapi
 * status / connection / init payload. Scans the object itself, its nested
 * `instance`, and the `status` object (which on /instance/init is
 * `{ connected, loggedIn, jid }`).
 */
export function extractOwnerNumber(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as any;
  return (
    scan(r) ??
    scan(r.instance) ??
    (typeof r.status === "object" ? scan(r.status) : undefined) ??
    (typeof r.instance?.status === "object" ? scan(r.instance.status) : undefined)
  );
}
