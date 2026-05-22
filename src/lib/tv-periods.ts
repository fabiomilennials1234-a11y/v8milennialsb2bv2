/**
 * TV Dashboard — Períodos rotativos
 *
 * Regra do CTO (2026-05-22): nunca usar "últimos 30 dias". `mes` = mês civil
 * (dia 1 → agora). Demais períodos são rolling pra trás a partir de agora.
 */

export type TVPeriod = "hoje" | "7d" | "2sem" | "mes";

export const TV_PERIODS: TVPeriod[] = ["hoje", "7d", "2sem", "mes"];

export interface TVPeriodRange {
  start: Date;
  end: Date;
}

export function getPeriodRange(period: TVPeriod, now: Date = new Date()): TVPeriodRange {
  const end = new Date(now);
  let start: Date;

  switch (period) {
    case "hoje":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      break;
    case "7d":
      start = new Date(now);
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      break;
    case "2sem":
      start = new Date(now);
      start.setDate(start.getDate() - 14);
      start.setHours(0, 0, 0, 0);
      break;
    case "mes":
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      break;
  }

  return { start, end };
}

export function getPeriodLabel(period: TVPeriod): string {
  switch (period) {
    case "hoje":
      return "Hoje";
    case "7d":
      return "Últimos 7 dias";
    case "2sem":
      return "Últimas 2 semanas";
    case "mes":
      return "Mês atual";
  }
}

export function getPeriodShortLabel(period: TVPeriod): string {
  switch (period) {
    case "hoje":
      return "Hoje";
    case "7d":
      return "7D";
    case "2sem":
      return "2SEM";
    case "mes":
      return "Mês";
  }
}

export function nextPeriod(period: TVPeriod): TVPeriod {
  const idx = TV_PERIODS.indexOf(period);
  return TV_PERIODS[(idx + 1) % TV_PERIODS.length];
}

/**
 * Testa se uma data ISO/Date cai dentro do range [start, end].
 * Aceita null/undefined retornando false.
 */
export function inRange(raw: string | Date | null | undefined, range: TVPeriodRange): boolean {
  if (!raw) return false;
  const d = raw instanceof Date ? raw : new Date(raw);
  if (isNaN(d.getTime())) return false;
  return d >= range.start && d <= range.end;
}

/**
 * Buckets diários no range. Útil pra sparklines.
 * Retorna array de { date: Date (start of day), key: "YYYY-MM-DD" }.
 */
export function getDailyBuckets(range: TVPeriodRange): { date: Date; key: string }[] {
  const buckets: { date: Date; key: string }[] = [];
  const cursor = new Date(range.start);
  cursor.setHours(0, 0, 0, 0);
  const endDay = new Date(range.end);
  endDay.setHours(0, 0, 0, 0);

  while (cursor <= endDay) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    buckets.push({ date: new Date(cursor), key });
    cursor.setDate(cursor.getDate() + 1);
  }

  return buckets;
}
