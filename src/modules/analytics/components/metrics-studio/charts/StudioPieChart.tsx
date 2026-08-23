import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { STUDIO_PALETTE } from "@/modules/analytics/lib/metrics-studio-catalog";
import { formatMetricValue } from "@/modules/analytics/lib/tv-metric-format";
import type { MetricSeriesPoint } from "@/modules/analytics/lib/tv-series";
import { StudioTooltip } from "./StudioTooltip";

interface StudioPieChartProps {
  slices: MetricSeriesPoint[];
  formatId: string;
  /** Sem largura para a legenda, a rosca fica sozinha e centralizada. */
  compact: boolean;
}

export function StudioPieChart({ slices, formatId, compact }: StudioPieChartProps) {
  const total = slices.reduce((acc, s) => acc + s.value, 0) || 1;

  return (
    <div className="flex h-full w-full items-center gap-3">
      <div className="h-full min-w-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <StudioTooltip
                    title={String(payload[0].name)}
                    formatId={formatId}
                    rows={[
                      {
                        label: `${((Number(payload[0].value) / total) * 100).toFixed(1)}% do total`,
                        value: Number(payload[0].value),
                        swatch: payload[0].payload?.fill,
                      },
                    ]}
                  />
                ) : null
              }
            />
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius="58%"
              outerRadius="86%"
              paddingAngle={2}
              stroke="hsl(var(--card))"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {slices.map((slice, i) => (
                <Cell key={slice.key ?? slice.label} fill={STUDIO_PALETTE[i % STUDIO_PALETTE.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>

      {!compact && (
        <ul className="max-h-full w-[42%] max-w-[190px] shrink-0 space-y-1 overflow-y-auto pr-1 scrollbar-hide">
          {slices.map((slice, i) => (
            <li key={slice.key ?? slice.label} className="flex items-center gap-2 text-[11px]">
              <span
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ background: STUDIO_PALETTE[i % STUDIO_PALETTE.length] }}
              />
              <span className="truncate text-muted-foreground">{slice.label}</span>
              <span className="ml-auto shrink-0 font-semibold tabular-nums">
                {formatMetricValue(slice.value, formatId)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
