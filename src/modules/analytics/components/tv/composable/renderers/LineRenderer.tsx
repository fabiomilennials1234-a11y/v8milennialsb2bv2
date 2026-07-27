import { useId } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import type { MetricSeriesPoint } from "@/modules/analytics/lib/tv-series";

interface LineRendererProps {
  series: MetricSeriesPoint[];
  /** Sparkline: sem eixos, para encaixe em NewLeadsBlock (#1221) e células estreitas. */
  sparkline?: boolean;
}

/**
 * Linha (#1218, spec §3.2/§3.4). "Está subindo?" — série única no tempo.
 *
 * recharts 2.x (API 2.x, não 3.x) via as primitivas do wrapper shadcn.
 * Config da spec §3.4: SEM CartesianGrid, SEM Tooltip (não há cursor na parede),
 * strokeWidth 3 (2px some a 3m), dot=false, área a 12%. Eixo Y com 2 marcas
 * (mín/máx), X com no máx 3 (`preserveStartEnd`). Stroke = --primary.
 *
 * Modo `sparkline`: sem eixos nenhum — é o corpo que o NewLeadsBlock (#1221)
 * consome. A linha sozinha já responde "subindo?" numa célula pequena.
 */
export function LineRenderer({ series, sparkline = false }: LineRendererProps) {
  const gradId = useId().replace(/:/g, "");
  const data = series.map((p) => ({ x: p.label, y: p.value ?? 0 }));
  const values = data.map((d) => d.y);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`tv-line-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.12} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        {!sparkline && (
          <YAxis
            domain={[min, max]}
            tickCount={2}
            axisLine={false}
            tickLine={false}
            width={40}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: "var(--tv-meta)" }}
          />
        )}
        {!sparkline && (
          <XAxis
            dataKey="x"
            interval="preserveStartEnd"
            minTickGap={40}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: "var(--tv-meta)" }}
          />
        )}
        <Area
          type="monotone"
          dataKey="y"
          stroke="hsl(var(--primary))"
          strokeWidth={3}
          fill={`url(#tv-line-${gradId})`}
          dot={false}
          activeDot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
