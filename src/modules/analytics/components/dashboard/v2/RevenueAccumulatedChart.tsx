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
    // Corpo da janela "Receita acumulada" — o título mora na moldura.
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[2rem] font-extrabold leading-none tracking-[-0.04em] tabular-nums">
            {formatK(animatedTotal)}
          </span>
          {deltaPct !== null && (
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
                deltaPct >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
              )}
            >
              {deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(1).replace(".", ",")}%
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-muted-foreground">
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
      {/* O gráfico ocupa a altura que a janela der. A geometria continua no
          sistema W×H; o traço não escala (`non-scaling-stroke`) e o ponto
          final é HTML, para não virar elipse quando a proporção muda. O
          tracejado de desenho é longo (2400) porque, sem escala, o comprimento
          da linha passa a ser medido em pixels da tela. */}
      <div className="relative mt-3 min-h-[128px] flex-1">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
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
              vectorEffect="non-scaling-stroke"
              className="cmd-drawline"
              style={{ strokeDasharray: 2400, strokeDashoffset: 2400, animationDelay: ".9s" }}
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
              vectorEffect="non-scaling-stroke"
              className="cmd-drawline"
              style={{ strokeDasharray: 2400, strokeDashoffset: 2400, animationDelay: ".7s" }}
            />
          )}
          {projPts && (
            <polyline
              points={projPts}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              strokeDasharray="3 6"
              vectorEffect="non-scaling-stroke"
              opacity={0.6}
              className="cmd-fadein"
              style={{ animationDelay: "2.1s" }}
            />
          )}
        </svg>
        {currentPts && (
          <span
            aria-hidden
            className="cmd-fadein absolute h-[13px] w-[13px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-primary"
            style={{ left: `${(lastX / W) * 100}%`, top: `${(lastY / H) * 100}%`, animationDelay: "2.1s" }}
          />
        )}
      </div>
    </div>
  );
}

export const RevenueAccumulatedChart = memo(RevenueAccumulatedChartBase);
