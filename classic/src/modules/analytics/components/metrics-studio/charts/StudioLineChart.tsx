import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { STUDIO_PALETTE } from "@/modules/analytics/lib/metrics-studio-catalog";
import { formatMetricValue } from "@/modules/analytics/lib/tv-metric-format";
import type { MetricSeriesPoint } from "@/modules/analytics/lib/tv-series";
import { StudioTooltip } from "./StudioTooltip";

interface StudioLineChartProps {
  /** Já ordenada cronologicamente por quem chama — o motor devolve por valor. */
  series: MetricSeriesPoint[];
  formatId: string;
  /** Abaixo de ~200px de altura os eixos viram ruído. */
  compact: boolean;
}

const ACCENT = STUDIO_PALETTE[0];

export function StudioLineChart({ series, formatId, compact }: StudioLineChartProps) {
  // `useId` devolve ":r0:" — dois-pontos é reservado para namespace em XML e
  // quebra o `url(#…)` do fill em parte dos engines. Tira antes de usar.
  const gradientId = `studio-grad-${useId().replace(/:/g, "")}`;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={series} margin={{ top: 6, right: 6, bottom: 0, left: compact ? 0 : -14 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.28} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>

        {!compact && (
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          />
        )}
        {!compact && (
          <YAxis
            width={52}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(v: number) => formatMetricValue(v, formatId)}
          />
        )}

        <Tooltip
          cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <StudioTooltip
                title={String(label)}
                formatId={formatId}
                rows={[{ label: "Valor", value: Number(payload[0].value), swatch: ACCENT }]}
              />
            ) : null
          }
        />

        <Area
          type="monotone"
          dataKey="value"
          stroke={ACCENT}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0, fill: ACCENT }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
