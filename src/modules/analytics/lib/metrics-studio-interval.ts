import { zonedDateParts, zonedDayStartOfYMD, zonedDayEndOfYMD } from "@/shared/time/zoned-day";
import type { PeriodRange } from "@/modules/analytics/hooks/useCommandMetrics";
import type { StudioPeriod, StudioRange } from "./metrics-studio-period";

const DAY = 86_400_000;
const calendar = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const move = (date: Date, days: number) => new Date(date.getTime() + days * DAY);

/** Mesmas datas-calendário de metric_period_bounds, inclusive mês e trimestre. */
export function studioInterval(period: StudioPeriod, now: Date, timezone: string, custom?: StudioRange | null): PeriodRange {
  const { y, m, d, weekdayMon0 } = zonedDateParts(now, timezone);
  const today = calendar(y, m, d);
  let start = today;
  let end = today;
  let prevStart: Date;
  let prevEnd: Date;
  if (period === "month" || period === "quarter") {
    const months = period === "month" ? 1 : 3;
    const firstMonth = months === 1 ? m : Math.floor((m - 1) / 3) * 3 + 1;
    start = calendar(y, firstMonth, 1);
    end = calendar(y, firstMonth + months, 0);
    prevStart = calendar(y, firstMonth - months, 1);
    prevEnd = move(start, -1);
    if (period === "quarter") {
      // O motor usa trimestre ATÉ HOJE, com igual número de dias no comparativo.
      end = today;
      prevEnd = move(prevStart, Math.round((today.getTime() - start.getTime()) / DAY));
    }
  } else {
    if (period === "week") {
      start = move(today, -weekdayMon0);
      end = move(start, 6);
    } else if (period === "custom") {
      if (!custom) throw new Error("Escolha as duas datas do intervalo");
      const parse = (iso: string) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("Data inválida");
        const date = new Date(`${iso}T00:00:00Z`);
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) throw new Error("Data inválida");
        return date;
      };
      start = parse(custom.from);
      end = parse(custom.to);
      if (end < start) throw new Error("O fim não pode anteceder o início");
    }
    const days = Math.round((end.getTime() - start.getTime()) / DAY) + 1;
    prevEnd = move(start, -1);
    prevStart = move(start, -days);
  }
  const startOf = (date: Date) => zonedDayStartOfYMD(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), timezone);
  const endOf = (date: Date) => zonedDayEndOfYMD(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), timezone);
  const daysTotal = Math.round((end.getTime() - start.getTime()) / DAY) + 1;
  return {
    start: startOf(start), end: endOf(end), prevStart: startOf(prevStart), prevEnd: endOf(prevEnd), daysTotal,
    dayOfPeriod: Math.max(0, Math.min(daysTotal, Math.round((today.getTime() - start.getTime()) / DAY) + 1)),
    prevLabel: period === "month" ? "no mês anterior" : period === "week" ? "na semana anterior" : "no período anterior",
  };
}
