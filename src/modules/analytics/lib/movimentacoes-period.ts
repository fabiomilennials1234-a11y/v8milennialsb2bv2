import { startOfUTCDay, endOfUTCDay } from "@/shared/time/utc-day";

/**
 * Resolução de período do painel "Movimentações no período" (Performance).
 *
 * Presets Hoje / 7 dias / 30 dias / Mês / Custom, fronteiras de dia em UTC —
 * mesma semântica de computeSaudePeriodRange (utc-day), estendida com janelas
 * móveis 7d/30d que a aba Saúde não tem. Cálculo puro e testável.
 */

export type MovimentacoesPreset = "today" | "7d" | "30d" | "month" | "custom";

export interface MovimentacoesCustomRange {
  from: Date;
  /** Indefinido enquanto o usuário só clicou na data inicial. */
  to?: Date;
}

export interface MovimentacoesRange {
  start: Date;
  end: Date;
}

/** Estado persistido do controle (preset + range custom serializado). */
export interface MovimentacoesPeriodState {
  preset: MovimentacoesPreset;
  /** ISO strings pra sobreviver ao JSON.stringify do usePersistedState. */
  customFrom: string | null;
  customTo: string | null;
}

export const DEFAULT_MOVIMENTACOES_PERIOD: MovimentacoesPeriodState = {
  preset: "month",
  customFrom: null,
  customTo: null,
};

export const MOVIMENTACOES_PRESETS: { value: MovimentacoesPreset; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "month", label: "Mês" },
  { value: "custom", label: "Custom" },
];

/** Janela móvel de N dias terminando hoje (inclusive), fronteiras UTC. */
function lastNDays(now: Date, days: number): MovimentacoesRange {
  const from = new Date(now);
  from.setDate(now.getDate() - (days - 1));
  return { start: startOfUTCDay(from), end: endOfUTCDay(now) };
}

/**
 * Resolve o preset num intervalo `{ start, end }` em UTC (end = 23:59:59.999).
 *
 * - `today`: dia corrente.
 * - `7d`: últimos 7 dias (hoje inclusive).
 * - `30d`: últimos 30 dias (hoje inclusive).
 * - `month`: mês-calendário corrente.
 * - `custom`: `from` → `to`; enquanto incompleto (sem `to`), retorna `null` — o
 *   caller mantém o último range válido e NÃO dispara query com intervalo aberto.
 */
export function resolveMovimentacoesRange(
  preset: MovimentacoesPreset,
  customRange: MovimentacoesCustomRange | null = null,
  now: Date = new Date(),
): MovimentacoesRange | null {
  if (preset === "today") {
    return { start: startOfUTCDay(now), end: endOfUTCDay(now) };
  }
  if (preset === "7d") return lastNDays(now, 7);
  if (preset === "30d") return lastNDays(now, 30);
  if (preset === "month") {
    const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    const end = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999));
    return { start, end };
  }
  // custom
  if (!customRange?.from || !customRange.to) return null;
  return { start: startOfUTCDay(customRange.from), end: endOfUTCDay(customRange.to) };
}

/** Hidrata o range custom persistido (ISO strings) em Dates. */
export function customRangeFromState(
  state: MovimentacoesPeriodState,
): MovimentacoesCustomRange | null {
  if (!state.customFrom) return null;
  const from = new Date(state.customFrom);
  const to = state.customTo ? new Date(state.customTo) : undefined;
  return { from, to };
}
