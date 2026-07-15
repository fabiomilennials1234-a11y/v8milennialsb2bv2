/**
 * Inadimplência — Carteira health projection over a client's Títulos (módulo G,
 * S9, ADR-0020). Pure: given the client's receivables, derive whether it is
 * delinquent and how much revenue is at risk (sum of overdue títulos).
 *
 * Carteira READS titulos_receber for display; the integrations BC WRITES them
 * via the Omie sync — no cross-module dependency needed here.
 */

export interface InadimplenciaTitulo {
  status: string; // "aberto" | "pago" | "atrasado"
  valor: number | null;
}

export interface Inadimplencia {
  /** True when the client holds one or more overdue títulos. */
  isInadimplente: boolean;
  overdueCount: number;
  /** Aggregate overdue amount — the client's receita-em-risco. */
  receitaEmRisco: number;
}

export function computeInadimplencia(titulos: InadimplenciaTitulo[]): Inadimplencia {
  const atrasados = titulos.filter((t) => t.status === "atrasado");
  const receitaEmRisco = atrasados.reduce((sum, t) => sum + (t.valor ?? 0), 0);
  return {
    isInadimplente: atrasados.length > 0,
    overdueCount: atrasados.length,
    receitaEmRisco,
  };
}
