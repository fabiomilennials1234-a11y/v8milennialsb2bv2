export function formatBRL(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits,
  }).format(value);
}

export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

export function formatDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

export function formatDateSafe(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateLong(iso: string | null): string {
  if (!iso) return "em breve";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
  });
}

/**
 * Masks raw text input as a pt-BR currency value, interpreting the typed
 * digits as cents and grouping from the right (e.g. "12345" → "123,45",
 * "100000" → "1.000,00"). Returns "" when there are no significant digits.
 */
export function maskCurrencyInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  const cents = digits.replace(/^0+/, "");
  // No significant digits (all zeros) → treat as empty so the placeholder shows.
  if (!cents) return "";

  const padded = cents.padStart(3, "0");
  const intPart = padded.slice(0, -2);
  const decimalPart = padded.slice(-2);

  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${groupedInt},${decimalPart}`;
}

/**
 * Parses a pt-BR masked currency string ("1.234,56") into a number (1234.56).
 * Empty / non-numeric input returns 0.
 */
export function parseCurrencyInput(masked: string): number {
  const digits = masked.replace(/\D/g, "");
  if (!digits) return 0;
  return Number(digits) / 100;
}
