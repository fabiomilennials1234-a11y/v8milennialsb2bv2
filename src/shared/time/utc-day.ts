/**
 * Fronteiras de dia em UTC a partir dos componentes locais da data.
 * Semântica canônica do Comando v2 — usada por computePeriodRange
 * (useCommandMetrics).
 */
export function startOfUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export function endOfUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999));
}
