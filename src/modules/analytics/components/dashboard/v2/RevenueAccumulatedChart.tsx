import { memo, useMemo } from "react";
import { useCountUp } from "@/shared/hooks/useCountUp";
import { cn } from "@/lib/utils";

interface DailyPoint {
  day: string;
  revenue: number;
}

interface RevenueAccumulatedChartProps {
  /** Vendas diárias do período corrente. */
  daily: DailyPoint[];
  /** Vendas diárias do período anterior (linha cinza de comparação). */
  prevDaily: DailyPoint[];
  /** Início do período corrente — indexa a série por offset de dias (funciona pra semana/trimestre). */
  periodStart: Date;
  prevStart: Date;
  dayOfPeriod: number;
  daysTotal: number;
  totalRevenue: number;
  deltaPct: number | null;
  currentLabel: string;
  prevLabel: string;
}

const W = 800;
const H = 128;
const PAD_TOP = 6;
const PAD_BOTTOM = 8;

function formatK(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(1).replace(".", ",")}K`;
  return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
}

/** Acumula a série diária indexada por offset de dias desde o início do período (1-based). */
function cumulative(daily: DailyPoint[], start: Date, daysTotal: number, upToDay: number): number[] {
  const byDay = new Array<number>(daysTotal + 1).fill(0);
  const startMs = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  for (const p of daily) {
    const t = new Date(p.day);
    const dayMs = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
    const d = Math.floor((dayMs - startMs) / 86_400_000) + 1;
    if (d >= 1 && d <= daysTotal) byDay[d] += p.revenue;
  }
  const cum: number[] = [];
  let acc = 0;
  for (let d = 1; d <= Math.min(upToDay, daysTotal); d++) {
    acc += byDay[d];
    cum.push(acc);
  }
  return cum;
}

function toPoints(values: number[], daysTotal: number, maxY: number, startDay = 1): string {
  if (values.length === 0 || maxY <= 0) return "";
  return values
    .map((v, i) => {
      const x = ((startDay - 1 + i) / Math.max(daysTotal - 1, 1)) * W;
      const y = PAD_TOP + (1 - v / maxY) * (H - PAD_TOP - PAD_BOTTOM);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * Receita acumulada do período — linha gold (realizado), projeção tracejada por
 * run-rate e período anterior em cinza. Linhas se desenham via stroke-dashoffset.
 */
function RevenueAccumulatedChartBase({
  daily, prevDaily, periodStart, prevStart, dayOfPeriod, daysTotal, totalRevenue, deltaPct, currentLabel, prevLabel,
}: RevenueAccumulatedChartProps) {
  const animatedTotal = useCountUp(totalRevenue, 1300, true);

  const { currentPts, projPts, prevPts, areaPts, lastX, lastY } = useMemo(() => {
    const cur = cumulative(daily, periodStart, daysTotal, dayOfPeriod);
    const prev = cumulative(prevDaily, prevStart, daysTotal, daysTotal);
    const curTotal = cur.length ? cur[cur.length - 1] : 0;
    const runRate = dayOfPeriod > 0 ? curTotal / dayOfPeriod : 0;
    const proj: number[] = [];
    for (let d = dayOfPeriod; d <= daysTotal; d++) proj.push(curTotal + runRate * (d - dayOfPeriod));
    const maxY = Math.max(curTotal, proj[proj.length - 1] ?? 0, prev[prev.length - 1] ?? 0, 1);

    const currentPts = toPoints(cur, daysTotal, maxY);
    const projPts = toPoints(proj, daysTotal, maxY, dayOfPeriod);
    const prevPts = toPoints(prev, daysTotal, maxY);
    const lastX = ((dayOfPeriod - 1) / Math.max(daysTotal - 1, 1)) * W;
    const lastY = maxY > 0 ? PAD_TOP + (1 - curTotal / maxY) * (H - PAD_TOP - PAD_BOTTOM) : H;
    const areaPts = currentPts ? `${currentPts} ${lastX.toFixed(1)},${H} 0,${H}` : "";
    return { currentPts, projPts, prevPts, areaPts, lastX, lastY };
  }, [daily, prevDaily, periodStart, prevStart, dayOfPeriod, daysTotal]);

  return (
    <div className="cmd-cell cmd-rise px-5 pb-3.5 pt-[18px]" style={{ animationDelay: ".46s" }}>
      <div className="flex items-baseline justify-between">
        <div>
          <span className="cmd-lbl">Receita acumulada</span>
          <div className="mt-1 text-[26px] font-black tracking-[-0.04em] tabular-nums">
            {formatK(animatedTotal)}{" "}
            {deltaPct !== null && (
              <span
                className={cn(
                  "ml-1 inline-flex -translate-y-[5px] items-center rounded-[7px] px-[7px] py-[2.5px] align-middle text-[11px] font-bold",
                  deltaPct >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
                )}
              >
                {deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(1).replace(".", ",")}%
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-4 text-[11.5px] font-semibold text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <i className="h-[3px] w-3.5 rounded-sm bg-primary" />{currentLabel}
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-[3px] w-3.5 rounded-sm bg-muted-foreground/50" />{prevLabel}
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-0 w-3.5 border-t-2 border-dashed border-muted-foreground/60" />Projeção
          </span>
        </div>
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-2.5">
        <defs>
          <linearGradient id="cmd-rev-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="hsl(var(--primary))" stopOpacity=".22" />
            <stop offset="1" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
        </defs>
        {prevPts && (
          <polyline
            points={prevPts}
            fill="none"
            stroke="hsl(var(--muted-foreground) / .45)"
            strokeWidth={2}
            className="cmd-drawline"
            style={{ strokeDasharray: 900, strokeDashoffset: 900, animationDelay: ".9s" }}
          />
        )}
        {areaPts && (
          <polygon points={areaPts} fill="url(#cmd-rev-area)" className="cmd-fadein" style={{ animationDelay: "1.7s" }} />
        )}
        {currentPts && (
          <polyline
            points={currentPts}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth={2.5}
            strokeLinecap="round"
            className="cmd-drawline"
            style={{ strokeDasharray: 900, strokeDashoffset: 900, animationDelay: ".7s" }}
          />
        )}
        {projPts && (
          <polyline
            points={projPts}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            strokeDasharray="3 6"
            opacity={0.6}
            className="cmd-fadein"
            style={{ animationDelay: "2.1s" }}
          />
        )}
        {currentPts && (
          <circle
            cx={lastX} cy={lastY} r={4.5}
            fill="hsl(var(--primary))"
            stroke="hsl(var(--background))"
            strokeWidth={2}
            className="cmd-fadein"
            style={{ animationDelay: "2.1s" }}
          />
        )}
      </svg>
    </div>
  );
}

export const RevenueAccumulatedChart = memo(RevenueAccumulatedChartBase);
