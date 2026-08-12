import { startOfWeek, endOfWeek } from "date-fns";

export type MetricsPeriod = "all" | "month" | "week" | "custom";

export interface DateRange {
  startStr: string;
  endStr: string;
}

export interface MetricsPeriodState {
  period: MetricsPeriod;
  month: number;
  year: number;
  /** Custom: intervalo livre. `to` pode ser undefined durante seleção (primeiro clique). */
  customRange: { from: Date; to?: Date } | null;
  /** Week: data de referência para calcular a semana (seg–sex). null = semana corrente. */
  weekDate: Date | null;
}

/**
 * Aceita `Date` ou a string ISO em que ele vira depois de um round-trip por
 * JSON.
 *
 * Este estado atravessa dois canais que serializam: `usePersistedState`
 * (localStorage, `JSON.parse` puro) e as visualizações salvas (coluna jsonb).
 * Nos dois, `customRange.from` volta como string — e `.getFullYear()` numa
 * string derruba a tela. O tipo público continua `Date` porque é o que o
 * chamador constrói; a coerção é a rede de baixo, pra um filtro reidratado
 * nunca virar crash.
 */
function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Devolve o estado com `Date` de verdade nos campos de data.
 *
 * Use quando for **entregar** as datas a outro componente (o `Calendar` do
 * react-day-picker chama métodos de Date direto). As funções deste módulo já se
 * defendem sozinhas via `asDate`.
 */
export function revivePeriodState(state: MetricsPeriodState): MetricsPeriodState {
  return {
    ...state,
    weekDate: state.weekDate ? asDate(state.weekDate) : null,
    customRange: state.customRange?.from
      ? {
          from: asDate(state.customRange.from),
          to: state.customRange.to ? asDate(state.customRange.to) : undefined,
        }
      : null,
  };
}

/**
 * Calcula o range UTC para o período selecionado.
 * Retorna null quando period === "all" ou quando a seleção está incompleta.
 */
export function getDateRange(state: MetricsPeriodState): DateRange | null {
  const { period, month, year, customRange, weekDate } = state;

  if (period === "all") return null;

  if (period === "month") {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    return { startStr: start.toISOString(), endStr: end.toISOString() };
  }

  if (period === "week") {
    const ref = weekDate ? asDate(weekDate) : new Date();
    const weekStart = startOfWeek(ref, { weekStartsOn: 1 }); // segunda
    const weekFriday = new Date(weekStart);
    weekFriday.setDate(weekStart.getDate() + 4); // sexta = segunda + 4
    const start = new Date(Date.UTC(
      weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 0, 0, 0, 0,
    ));
    const end = new Date(Date.UTC(
      weekFriday.getFullYear(), weekFriday.getMonth(), weekFriday.getDate(), 23, 59, 59, 999,
    ));
    return { startStr: start.toISOString(), endStr: end.toISOString() };
  }

  if (period === "custom" && customRange?.from && customRange?.to) {
    const from = asDate(customRange.from);
    const to = asDate(customRange.to);
    const start = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0));
    const end = new Date(Date.UTC(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999));
    return { startStr: start.toISOString(), endStr: end.toISOString() };
  }

  return null;
}

/**
 * Retorna seg–sex da semana que contém `date`.
 */
export function getWeekRange(date: Date): { from: Date; to: Date } {
  const monday = startOfWeek(asDate(date), { weekStartsOn: 1 });
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return { from: monday, to: friday };
}

// ─── Atalhos "Criados no período" (painel de Filtros do funil) ───────────────
// O protótipo `.specs/mockups/funis-redesign/` trouxe o período pra dentro de
// Filtros com outra gramática — 7 / 30 / 90 dias e Este mês, ou data a data.
// Os atalhos são projetados NO MetricsPeriodState que já existe (custom range e
// month), em vez de um campo novo: as visualizações salvas persistem esse
// objeto, e um campo a mais invalidaria as views já gravadas.

export type PeriodShortcut = "7d" | "30d" | "90d" | "month";

/** Últimos N dias contando hoje — inclusivo nas duas pontas. */
export function createLastNDaysState(
  days: number,
  base: MetricsPeriodState,
): MetricsPeriodState {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (days - 1));
  return { ...base, period: "custom", customRange: { from, to } };
}

/** Mês corrente. */
export function createThisMonthState(base: MetricsPeriodState): MetricsPeriodState {
  const now = new Date();
  return {
    ...base,
    period: "month",
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };
}

export function applyPeriodShortcut(
  shortcut: PeriodShortcut,
  base: MetricsPeriodState,
): MetricsPeriodState {
  switch (shortcut) {
    case "7d":
      return createLastNDaysState(7, base);
    case "30d":
      return createLastNDaysState(30, base);
    case "90d":
      return createLastNDaysState(90, base);
    case "month":
      return createThisMonthState(base);
  }
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * Qual atalho o estado atual representa, ou null se for um intervalo livre.
 *
 * Derivado por comparação em vez de guardado no estado — assim um range que o
 * usuário montou à mão e que calha de ser "os últimos 30 dias" acende o mesmo
 * atalho, e clicar nele desliga (comportamento que o protótipo especifica).
 */
export function matchPeriodShortcut(state: MetricsPeriodState): PeriodShortcut | null {
  const now = new Date();

  if (state.period === "month") {
    return state.month === now.getMonth() + 1 && state.year === now.getFullYear()
      ? "month"
      : null;
  }

  if (state.period === "custom" && state.customRange?.from && state.customRange?.to) {
    const from = asDate(state.customRange.from);
    const to = asDate(state.customRange.to);
    if (!sameDay(to, now)) return null;
    for (const [days, shortcut] of [[7, "7d"], [30, "30d"], [90, "90d"]] as const) {
      const expected = new Date();
      expected.setDate(now.getDate() - (days - 1));
      if (sameDay(from, expected)) return shortcut;
    }
  }

  return null;
}

/**
 * Cria o estado inicial padrão para MetricsPeriodState.
 */
export function createInitialPeriodState(): MetricsPeriodState {
  const now = new Date();
  return {
    period: "all",
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    customRange: null,
    weekDate: null,
  };
}
