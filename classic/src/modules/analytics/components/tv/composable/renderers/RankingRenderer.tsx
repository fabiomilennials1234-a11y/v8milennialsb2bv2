import { formatMetricValue } from "@/modules/analytics/lib/tv-metric-format";
import { ordinalColor, type MetricSeriesPoint } from "@/modules/analytics/lib/tv-series";

interface RankingRendererProps {
  series: MetricSeriesPoint[];
  formatId?: string | null;
  /** podium (top 3, degraus) | list (ranking numerado). Default podium. */
  variant?: string | null;
}

/** Iniciais de um nome para o avatar de identidade (§2.6c). "João Silva" → "JS". */
function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Ranking de pessoas (#1253, spec §2.1 #4). "Quem está na frente?" — ordenado
 * por valor, com identidade. Ao contrário da Barra, NÃO colapsa em "Outros": um
 * leaderboard mostra as posições, não uma composição de um todo.
 *
 * div + CSS (não recharts): posições ordenadas com rótulo + valor, geometria
 * simples a 3m. Cor = rampa ORDINAL (posição tem ordem → a cor tem ordem); o
 * número fica creme (canal do valor, §3.2 — nunca hue decorativo no número).
 *
 * `podium`: top 3 com degrau (nº 1 destacado em gold). `list`: até 6, numerado.
 */
export function RankingRenderer({ series, formatId, variant }: RankingRendererProps) {
  const sorted = [...series].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const isList = variant === "list";
  const rows = sorted.slice(0, isList ? 6 : 3);

  return (
    <div className="flex h-full flex-col justify-center gap-2">
      {rows.map((row, i) => {
        const isLeader = i === 0 && !isList;
        return (
          <div key={row.key ?? row.label} className="flex items-center gap-3">
            {/* Chip de posição — cor ordinal na geometria, número creme. */}
            <div
              className="flex shrink-0 items-center justify-center rounded-full font-bold tabular-nums"
              style={{
                width: "1.6em",
                height: "1.6em",
                fontSize: "var(--tv-label)",
                color: "hsl(var(--tv-surface, var(--background)))",
                backgroundColor: isLeader ? "hsl(var(--primary))" : ordinalColor(i),
              }}
            >
              {i + 1}
            </div>
            {/* Avatar de identidade (iniciais) — só no pódio, onde há espaço. */}
            {!isList && (
              <div
                className="flex shrink-0 items-center justify-center rounded-full border font-semibold text-muted-foreground"
                style={{ width: "1.8em", height: "1.8em", fontSize: "var(--tv-label)", borderColor: "hsl(var(--border))" }}
                aria-hidden
              >
                {initials(row.label)}
              </div>
            )}
            <span
              className="min-w-0 flex-1 truncate text-muted-foreground"
              style={{ fontSize: "var(--tv-label)" }}
              title={row.label}
            >
              {row.label}
            </span>
            <span
              className="shrink-0 font-semibold tabular-nums text-foreground"
              style={{ fontSize: isLeader ? "var(--tv-value-sm)" : "var(--tv-label)" }}
            >
              {formatMetricValue(row.value, formatId)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
