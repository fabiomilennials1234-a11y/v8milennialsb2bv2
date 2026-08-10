import type { MetricUnit } from "@/modules/analytics/lib/metrics-studio-catalog";
import { formatMetricValue } from "@/modules/analytics/lib/metrics-studio-catalog";

interface Row {
  label: string;
  value: number;
  swatch?: string;
}

interface StudioTooltipProps {
  title: string;
  rows: Row[];
  unit: MetricUnit;
}

/**
 * Tooltip único do estúdio — recharts e o canvas de vela renderizam o mesmo
 * corpo, então linha, pizza e vela não divergem visualmente.
 */
export function StudioTooltip({ title, rows, unit }: StudioTooltipProps) {
  return (
    <div className="pointer-events-none rounded-lg border border-border/70 bg-popover/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </div>
      <div className="space-y-0.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2 text-[12px]">
            {row.swatch && (
              <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: row.swatch }} />
            )}
            <span className="text-muted-foreground">{row.label}</span>
            <span className="ml-auto font-semibold tabular-nums text-foreground">
              {formatMetricValue(row.value, unit)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
