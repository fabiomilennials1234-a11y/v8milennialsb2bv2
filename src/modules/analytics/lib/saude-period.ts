import { startOfUTCDay, endOfUTCDay } from "./utc-day";

/**
 * Período local da aba Saúde (Comando v2).
 *
 * Presets seguem a MESMA semântica de datas do computePeriodRange
 * (useCommandMetrics): fronteiras de dia em UTC, semana ISO seg→dom.
 * Cálculo puro e testável — tests/unit/saude-period.test.ts.
 */

export type SaudePeriodPreset = "today" | "week" | "month" | "custom";

export interface SaudeCustomRange {
  from: Date;
  /** Indefinido enquanto o usuário só clicou na data inicial. */
  to?: Date;
}

export interface SaudeRange {
  start: Date;
  end: Date;
}

/**
 * Resolve o preset num intervalo `{ start, end }` em UTC.
 *
 * - `today`: dia corrente 00:00:00.000 → 23:59:59.999 UTC.
 * - `week`: semana ISO corrente (segunda → domingo), fronteiras UTC.
 * - `month`: mês calendário corrente, fronteiras UTC.
 * - `custom`: `from` 00:00 UTC → `to` 23:59:59.999 UTC. Enquanto o range
 *   estiver incompleto (sem `from` + `to`), retorna `null` — o caller mantém
 *   o último range válido e NÃO dispara query com intervalo aberto.
 */
export function computeSaudePeriodRange(
  preset: SaudePeriodPreset,
  customRange: SaudeCustomRange | null = null,
  now: Date = new Date(),
): SaudeRange | null {
  if (preset === "today") {
    return { start: startOfUTCDay(now), end: endOfUTCDay(now) };
  }

  if (preset === "week") {
    // Semana ISO: segunda → domingo — mesma definição do computePeriodRange.
    const dow = (now.getDay() + 6) % 7; // 0 = segunda
    const monday = new Date(now);
    monday.setDate(now.getDate() - dow);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: startOfUTCDay(monday), end: endOfUTCDay(sunday) };
  }

  if (preset === "month") {
    const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    const end = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999));
    return { start, end };
  }

  // custom
  if (!customRange?.from || !customRange.to) return null;
  return { start: startOfUTCDay(customRange.from), end: endOfUTCDay(customRange.to) };
}
