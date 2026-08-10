import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MetricUnit } from "@/modules/analytics/lib/metrics-studio-catalog";
import { formatMetricValue, STUDIO_PALETTE } from "@/modules/analytics/lib/metrics-studio-catalog";
import type { SamplePoint } from "@/modules/analytics/lib/metrics-studio-sample";
import { StudioTooltip } from "./StudioTooltip";

interface StudioLineChartProps {
  series: SamplePoint[];
  unit: MetricUnit;
  /** Abaixo de ~200px de altura os eixos viram ruído — o card compacto some com eles. */
  compact: boolean;
}

const ACCENT = STUDIO_PALETTE[0];

export function StudioLineChart({ series, unit, compact }: StudioLineChartProps) {
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
            tickFormatter={(v: number) => formatMetricValue(v, unit)}
          />
        )}

        <Tooltip
          cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <StudioTooltip
                title={String(label)}
                unit={unit}
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
