import { formatMetricValue } from "@/modules/analytics/lib/tv-metric-format";
import {
  groupTopN,
  ordinalColor,
  type MetricSeriesPoint,
} from "@/modules/analytics/lib/tv-series";

interface BarRendererProps {
  series: MetricSeriesPoint[];
  formatId?: string | null;
}

/**
 * Barra horizontal (#1218, spec §3.2/§3.4). "Quem/qual mais?" (≤5 categorias).
 *
 * div + CSS de propósito, NÃO recharts: a 3m são 5 barras horizontais, geometria
 * simples; recharts + ResponsiveContainer para isso é peso morto no bundle e um
 * recálculo a mais em resize (§3.4).
 *
 * Regras de convivência (§3.1): rótulo + valor NO FIM da barra (sem legenda
 * flutuante), sem eixo, sem gridline, sem tooltip. Cor = rampa ORDINAL (o dado
 * tem ordem → a cor tem ordem). Máx 5 categorias, a 6ª+ vira "Outros".
 */
export function BarRenderer({ series, formatId }: BarRendererProps) {
  const rows = groupTopN(series, 5);
  const max = Math.max(...rows.map((r) => r.value ?? 0), 0);

  return (
    <div className="flex h-full flex-col justify-center gap-2">
      {rows.map((row, i) => {
        // Largura relativa ao maior; piso de 2% para a barra do zero ainda existir.
        const pct = max > 0 ? Math.max((row.value ?? 0) / max, 0.02) * 100 : 0;
        return (
          <div key={row.key ?? row.label} className="flex items-center gap-3">
            <div className="relative min-w-0 flex-1">
              <div
                className="h-full rounded-sm"
                style={{
                  width: `${pct}%`,
                  minHeight: "0.9em",
                  backgroundColor: ordinalColor(i),
                  transition: "width var(--tv-dur-base) var(--tv-ease-out)",
                }}
              />
            </div>
            {/* Rótulo + valor colados à barra, alinhados, tabular. */}
            <div className="flex shrink-0 items-baseline gap-2" style={{ fontSize: "var(--tv-label)" }}>
              <span className="max-w-[10ch] truncate text-muted-foreground" title={row.label}>
                {row.label}
              </span>
              <span className="font-semibold tabular-nums text-foreground">
                {formatMetricValue(row.value, formatId)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
