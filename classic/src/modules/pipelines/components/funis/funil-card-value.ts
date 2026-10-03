interface EntryWithSaleValue {
  sale_value?: unknown;
  metadata?: Record<string, unknown> | null;
}

/** Resolve o valor que o card compacto mostra para a entrada do negócio. */
export function projectSaleValue(entry: EntryWithSaleValue): number | null {
  const raw = entry.sale_value ?? entry.metadata?.sale_value;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
