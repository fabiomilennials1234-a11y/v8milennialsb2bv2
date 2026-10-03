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
    // Corpo da janela "Realizado versus esperado" — o título mora na moldura.
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">Faturamento</span>
          <span
            className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
            title="A meta segue mensal mesmo com período personalizado selecionado."
          >
            mês
          </span>
        </span>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
            deltaPp >= 0 ? "bg-success/10 text-success-strong" : "bg-destructive/10 text-destructive",
          )}
        >
          {deltaPp >= 0 ? `+${deltaPp}pp à frente` : `${deltaPp}pp atrás`}
        </span>
      </div>
      {/* Ocupa a altura da janela: traço sem escala e rótulos/ponto em HTML,
          que não distorcem quando a proporção muda (antes o texto do SVG
          esticava junto com o `preserveAspectRatio="none"`). */}
      <div className="relative mt-3 min-h-[150px] flex-1">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
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
            vectorEffect="non-scaling-stroke"
          />
          {pts && (
            <>
              <polygon points={`${pts} ${lastX.toFixed(1)},${H} 0,${H}`} fill="url(#cmd-rve-area)" className="cmd-fadein" style={{ animationDelay: "1.2s" }} />
              <polyline
                points={pts}
                fill="none" stroke="hsl(var(--primary))" strokeWidth={2.5} strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                className="cmd-drawline"
                style={{ strokeDasharray: 2400, strokeDashoffset: 2400, animationDelay: ".5s" }}
              />
            </>
          )}
        </svg>
        {pts && (
          <>
            <span
              aria-hidden
              className="cmd-fadein absolute h-[13px] w-[13px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-primary"
              style={{ left: `${(lastX / W) * 100}%`, top: `${(lastY / H) * 100}%`, animationDelay: "1.4s" }}
            />
            <span
              className="cmd-fadein absolute -translate-y-full whitespace-nowrap pb-2 text-[11px] font-extrabold tabular-nums text-foreground"
              style={{
                top: `${(lastY / H) * 100}%`,
                ...(lastX / W > 0.8 ? { right: `${(1 - lastX / W) * 100}%` } : { left: `${(lastX / W) * 100}%` }),
                animationDelay: "1.4s",
              }}
            >
              {lastLabel}
            </span>
          </>
        )}
        <span className="absolute right-0 top-3 text-[10px] font-semibold text-muted-foreground">
          linha esperada
        </span>
      </div>
    </div>
  );
}

export const RealVsExpectedChart = memo(RealVsExpectedChartBase);
