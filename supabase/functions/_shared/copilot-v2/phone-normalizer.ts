/**
 * phone-normalizer — Copilot v2 canonical phone form.
 *
 * THE single source of truth for keying a contact across the v2 runtime:
 * lead lookup, dedup lock, human-pause, rate-limit. Every gate MUST use this
 * one function so a key written by one path is found by another.
 *
 * Canonical form mirrors the stored `normalized_phone` column:
 *   - digits only
 *   - no international 55 prefix
 *   - 9 inserted for 10-digit Brazilian mobiles (DDD + 8 → DDD + 9 + 8)
 *
 * Examples:
 *   +55 11 98765-4321  -> 11987654321
 *   5511987654321      -> 11987654321
 *   11987654321        -> 11987654321
 *   1198765432         -> 11987654321  (adds the 9)
 *
 * Regression guard: v1 had two divergent normalizers (one stripped 55, one
 * added it) — keying pause with one and checking with the other silently
 * broke ~40% of `ai_disabled`. This collapses every rendering to one key.
 */

export function normalizeCanonicalPhone(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;

  // Strip everything that is not a digit.
  let cleaned = String(raw).replace(/\D/g, "");
  if (cleaned === "") return null;

  // Drop the international 55 prefix (only when it is genuinely a prefix:
  // 12+ digits starting with 55 — never on an already-canonical 11-digit number).
  if (cleaned.length >= 12 && cleaned.startsWith("55")) {
    cleaned = cleaned.slice(2);
  }

  // Brazilian mobiles are DDD(2) + 9 + 8 digits = 11. A 10-digit number is a
  // pre-9 mobile — insert the 9 so it matches the stored canonical form.
  if (cleaned.length === 10) {
    cleaned = cleaned.slice(0, 2) + "9" + cleaned.slice(2);
  }

  return cleaned;
}
