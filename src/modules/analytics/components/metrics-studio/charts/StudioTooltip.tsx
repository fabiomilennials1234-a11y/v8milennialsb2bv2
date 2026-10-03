import { formatMetricValue } from "@/modules/analytics/lib/tv-metric-format";

interface Row {
  label: string;
  value: number;
  swatch?: string;
}

interface StudioTooltipProps {
  title: string;
  rows: Row[];
  formatId: string;
}

/**
 * Tooltip único do estúdio — recharts e o canvas de vela renderizam o mesmo
 * corpo, então linha, pizza e vela não divergem visualmente.
 */
export function StudioTooltip({ title, rows, formatId }: StudioTooltipProps) {
  return (
    // V5: tooltip é tinta — o mesmo vocabulário do Tooltip primitivo.
    <div className="pointer-events-none rounded-xl border border-tinta-line/60 bg-tinta px-3 py-2 text-tinta-foreground shadow-relevo-tinta">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.06em] text-tinta-muted">
        {title}
      </div>
      <div className="space-y-0.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2 text-[12px]">
            {row.swatch && (
              <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: row.swatch }} />
            )}
            <span className="text-tinta-muted">{row.label}</span>
            <span className="ml-auto font-bold tabular-nums text-tinta-foreground">
              {formatMetricValue(row.value, formatId)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
