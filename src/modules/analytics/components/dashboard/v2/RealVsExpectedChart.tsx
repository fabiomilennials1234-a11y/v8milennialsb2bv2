import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";

interface RealVsExpectedChartProps {
  dailySales: Array<{ day: string; revenue: number }>;
  goalTarget: number;
  month: number;
  year: number;
}

const W = 460;
const H = 150;
const PAD = 8;

function formatK(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(0)}K`;
  return `R$ ${Math.round(value)}`;
}

/**
 * Real vs esperado — acumulado do mês (gold) contra a linha linear da meta
 * (tracejada). Versão Comando do MetaComparativeChart.
 */
function RealVsExpectedChartBase({ dailySales, goalTarget, month, year }: RealVsExpectedChartProps) {
  const { pts, lastX, lastY, lastLabel, deltaPp } = useMemo(() => {
    const now = new Date();
    const isCurrent = month === now.getMonth() + 1 && year === now.getFullYear();
    const daysInMonth = new Date(year, month, 0).getDate();
    const maxDay = isCurrent ? now.getDate() : daysInMonth;

    const byDay = new Array<number>(daysInMonth + 1).fill(0);
    for (const p of dailySales) {
      const d = new Date(p.day).getUTCDate();
      if (d >= 1 && d <= daysInMonth) byDay[d] += p.revenue;
    }
    const cum: number[] = [];
    let acc = 0;
    for (let d = 1; d <= maxDay; d++) {
      acc += byDay[d];
      cum.push(acc);
    }
    const maxY = Math.max(goalTarget, acc, 1);
    const x = (d: number) => ((d - 1) / Math.max(daysInMonth - 1, 1)) * W;
    const y = (v: number) => PAD + (1 - v / maxY) * (H - PAD * 2);

    const pts = cum.map((v, i) => `${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const realizedPct = goalTarget > 0 ? (acc / goalTarget) * 100 : 0;
    const expectedPct = (maxDay / daysInMonth) * 100;
    return {
      pts,
      lastX: x(maxDay),
      lastY: y(acc),
      lastLabel: formatK(acc),
      deltaPp: Math.round(realizedPct - expectedPct),
    };
  }, [dailySales, goalTarget, month, year]);

  return (
    <div className="cmd-cell cmd-rise p-5" style={{ animationDelay: ".25s" }}>
      <div className="flex items-center justify-between">
        <span className="cmd-lbl">Real vs esperado — faturamento</span>
        <span
          className={cn(
            "inline-flex items-center rounded-[7px] px-[7px] py-[2.5px] text-[11px] font-bold",
            deltaPp >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
          )}
        >
          {deltaPp >= 0 ? `+${deltaPp}pp à frente` : `${deltaPp}pp atrás`}
        </span>
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-3.5">
        <defs>
          <linearGradient id="cmd-rve-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="hsl(var(--primary))" stopOpacity=".22" />
            <stop offset="1" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Linha esperada: 0 no dia 1 → meta no último dia */}
        <line
          x1={0} y1={H - PAD} x2={W} y2={PAD}
          stroke="hsl(var(--muted-foreground) / .55)" strokeWidth={1.5} strokeDasharray="5 5"
        />
        {pts && (
          <>
            <polygon points={`${pts} ${lastX.toFixed(1)},${H} 0,${H}`} fill="url(#cmd-rve-area)" className="cmd-fadein" style={{ animationDelay: "1.2s" }} />
            <polyline
              points={pts}
              fill="none" stroke="hsl(var(--primary))" strokeWidth={2.5} strokeLinecap="round"
              className="cmd-drawline"
              style={{ strokeDasharray: 700, strokeDashoffset: 700, animationDelay: ".5s" }}
            />
            <circle cx={lastX} cy={lastY} r={4.5} fill="hsl(var(--primary))" stroke="hsl(var(--background))" strokeWidth={2} className="cmd-fadein" style={{ animationDelay: "1.4s" }} />
            <text x={Math.min(lastX + 7, W - 56)} y={Math.max(lastY - 8, 12)} className="fill-foreground" style={{ font: "800 11px Inter" }}>
              {lastLabel}
            </text>
          </>
        )}
        <text x={W - 96} y={Math.max(PAD + 22, 24)} className="fill-muted-foreground/70" style={{ font: "600 10px Inter" }}>
          linha esperada
        </text>
      </svg>
    </div>
  );
}

export const RealVsExpectedChart = memo(RealVsExpectedChartBase);
