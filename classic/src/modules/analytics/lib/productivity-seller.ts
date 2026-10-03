/**
 * Produtividade por vendedor — helpers puros (sem I/O), unit-testados.
 * Placar mensal na aba Performance do Comando: marcou / compareceu / fechou por
 * pessoa, event-anchored (ADR-0013). Reunião creditada a quem marcou
 * (pre_sale_responsible_id); venda ao closer.
 */

export interface ProductivitySellerRow {
  seller_id: string;
  seller_name: string;
  /** team_members.metric_type ('meetings' | 'sales' | null) — base do rótulo de papel. */
  metric_type: string | null;
  novos_leads: number;
  reunioes_marcadas: number;
  reunioes_realizadas: number;
  vendido: number;
}

export type HeldTone = "good" | "warn" | "bad" | "none";

/** Taxa de comparecimento (realizadas / marcadas) em %. `null` quando não houve marcação. */
export function heldRate(row: Pick<ProductivitySellerRow, "reunioes_marcadas" | "reunioes_realizadas">): number | null {
  if (!row.reunioes_marcadas || row.reunioes_marcadas <= 0) return null;
  return (row.reunioes_realizadas / row.reunioes_marcadas) * 100;
}

/** Semântica de cor da taxa (separada do accent gold): ≥40 bom, 15–40 atenção, <15 crítico. */
export function heldTone(rate: number | null): HeldTone {
  if (rate === null) return "none";
  if (rate >= 40) return "good";
  if (rate >= 15) return "warn";
  return "bad";
}

/** Rótulo de papel derivado de metric_type. `null` → sem tag (não inventa papel). */
export function roleLabel(metricType: string | null | undefined): string | null {
  switch (metricType) {
    case "meetings":
      return "Pré-venda";
    case "sales":
      return "Closer";
    default:
      return null;
  }
}

/** Iniciais para o avatar (até 2 letras, maiúsculas). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Total agregado do período (para a linha de rodapé). */
export function sellerTotals(rows: ProductivitySellerRow[]) {
  return rows.reduce(
    (acc, r) => ({
      novos_leads: acc.novos_leads + r.novos_leads,
      reunioes_marcadas: acc.reunioes_marcadas + r.reunioes_marcadas,
      reunioes_realizadas: acc.reunioes_realizadas + r.reunioes_realizadas,
      vendido: acc.vendido + r.vendido,
    }),
    { novos_leads: 0, reunioes_marcadas: 0, reunioes_realizadas: 0, vendido: 0 },
  );
}
