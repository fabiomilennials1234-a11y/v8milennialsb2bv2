/**
 * Brazilian phone normalization, ported to TS (DESIGN §8.3, HOLE 1).
 *
 * Why TS and not `db.rpc("normalize_brazilian_phone")`: a customer tool must NEVER call a
 * SECURITY DEFINER RPC through the per-user client (it would run with the owner's privilege
 * and bypass RLS — the exact anti-pattern ADR 0011 bans). The anti-bypass CI guard forbids
 * any `.rpc(` on the user client, with ZERO exceptions. So the normalization the lead lookup
 * needs is done here, in TS, and pinned to the DB function by the golden test below.
 *
 * This is a 1:1 port of `public.normalize_brazilian_phone`
 * (supabase/migrations/20260130100000_lead_phone_centralization.sql:8-42). Keep them in
 * lockstep — the column `leads.normalized_phone` is populated by the DB function, so any
 * divergence here silently breaks phone lookups.
 */
export function normalizeBrazilianPhone(phone: string | null | undefined): string | null {
  if (phone == null || phone === "") return null;
  let cleaned = phone.replace(/\D/g, ""); // strip everything non-digit
  if (cleaned === "") return null;
  // Drop the +55 / 55 international prefix when present (12+ digits).
  if (cleaned.length >= 12 && cleaned.slice(0, 2) === "55") {
    cleaned = cleaned.slice(2);
  }
  // 10 digits (DDD + 8) → insert the mobile 9 after the DDD.
  if (cleaned.length === 10) {
    cleaned = cleaned.slice(0, 2) + "9" + cleaned.slice(2);
  }
  return cleaned;
}
