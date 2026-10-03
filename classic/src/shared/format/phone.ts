/**
 * Brazilian phone-number display formatter.
 *
 * Accepts a raw number in any shape (bare digits, with or without the `55`
 * country code, or a WhatsApp JID like `5548999...@s.whatsapp.net`) and returns
 * a human-friendly string. Falls back to the trimmed input when the digit count
 * doesn't match a known BR layout, so it never hides data.
 */
export function formatPhoneBR(raw: string | null | undefined): string {
  if (!raw) return "";
  // Drop any JID suffix / device marker before counting digits.
  const local = raw.split("@")[0].split(":")[0];
  const digits = local.replace(/\D/g, "");

  // +55 (DD) 9NNNN-NNNN  — country code + DDD + 9-digit mobile
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  // +55 (DD) NNNN-NNNN   — country code + DDD + 8-digit landline
  if (digits.length === 12 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  // (DD) 9NNNN-NNNN      — DDD + 9-digit mobile (no country code)
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  // (DD) NNNN-NNNN       — DDD + 8-digit landline (no country code)
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return raw.trim();
}
