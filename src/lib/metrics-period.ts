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
    const ref = weekDate ?? new Date();
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
    const { from, to } = customRange;
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
  const monday = startOfWeek(date, { weekStartsOn: 1 });
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return { from: monday, to: friday };
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
