import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { formatMetricValue } from "@/modules/analytics/lib/tv-metric-format";
import {
  categoricalColor,
  groupTopN,
  headValueFromMeasure,
  type MetricSeriesPoint,
} from "@/modules/analytics/lib/tv-series";

interface DonutRendererProps {
  series: MetricSeriesPoint[];
  formatId?: string | null;
}

/**
 * Donut (#1218, spec §3.2/§3.3). "De que é feito?" (≤4 categorias + Outros).
 *
 * A spec é dura: pizza é o formato MAIS FRACO para TV — comparar ângulos a 3m é
 * ruim, e ângulo é a única codificação da pizza. Por isso é DONUT: o anel dá
 * espessura constante (mais legível que ângulo) e o CENTRO carrega o valor de
 * cabeça (§1②) sem card extra. Teto de 4 fatias + "Outros" — nunca roda de 30.
 *
 * recharts, SEM tooltip (§3.1 regra 6). Rótulo vai NO elemento, não em legenda
 * flutuante. Cor = rampa CATEGÓRICA (sem ordem → hues distintos).
 */
export function DonutRenderer({ series, formatId }: DonutRendererProps) {
  // Teto de 4 fatias + "Outros" = 5 buckets no máx (§3.3). groupTopN(_, 5)
  // guarda 1 vaga para "Outros", então colapsa a partir da 5ª categoria.
  const donutRows = groupTopN(series, 5);
  // Total do centro sobre os buckets exibidos — bate com o que o olho soma.
  const total = headValueFromMeasure({ series: donutRows });

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={donutRows}
            dataKey="value"
            nameKey="label"
            innerRadius="62%"
            outerRadius="92%"
            paddingAngle={2}
            stroke="none"
            isAnimationActive={false}
          >
            {donutRows.map((row, i) => (
              <Cell key={row.key ?? row.label} fill={categoricalColor(i)} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      {/* Total no centro = valor de cabeça, resolvendo §1② sem card extra. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-semibold leading-none text-foreground" style={{ fontSize: "var(--tv-value-sm)" }}>
          {formatMetricValue(total, formatId)}
        </span>
      </div>

      {/* Rótulos no elemento (chips), não legenda flutuante separada. */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex flex-wrap justify-center gap-x-3 gap-y-1">
        {donutRows.map((row, i) => (
          <span
            key={row.key ?? row.label}
            className="flex items-center gap-1 text-muted-foreground"
            style={{ fontSize: "var(--tv-meta)" }}
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: categoricalColor(i) }} />
            <span className="max-w-[8ch] truncate" title={row.label}>{row.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
