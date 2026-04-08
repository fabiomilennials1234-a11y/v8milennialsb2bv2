/**
 * Canonical phone normalization for Brazilian numbers.
 *
 * Mirrors the PostgreSQL function `normalize_brazilian_phone()` and the
 * Edge Function `normalizePhoneForSearch()` from lead-service.ts.
 *
 * All three MUST produce the same output for any given input.
 *
 * Examples:
 *   "+55 11 98765-4321"  → "11987654321"
 *   "5511987654321"      → "11987654321"
 *   "11987654321"        → "11987654321"
 *   "11 98765-4321"      → "11987654321"
 *   "1198765432"         → "11987654321"  (adds 9 for 10-digit mobile)
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone || phone.trim() === "") return null;

  let cleaned = phone.replace(/\D/g, "");
  if (cleaned === "") return null;

  // Remove international prefix 55 if present (12+ digits)
  if (cleaned.length >= 12 && cleaned.startsWith("55")) {
    cleaned = cleaned.slice(2);
  }

  // Add 9 for 10-digit mobile numbers (DDD + 8 digits → DDD + 9 + 8 digits)
  if (cleaned.length === 10) {
    cleaned = cleaned.slice(0, 2) + "9" + cleaned.slice(2);
  }

  return cleaned;
}
