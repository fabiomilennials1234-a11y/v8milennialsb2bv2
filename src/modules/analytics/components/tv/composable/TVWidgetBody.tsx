import { BarRenderer } from "./renderers/BarRenderer";
import { LineRenderer } from "./renderers/LineRenderer";
import { DonutRenderer } from "./renderers/DonutRenderer";
import { seriesState, type MetricSeriesPoint, type RawMeasure } from "@/modules/analytics/lib/tv-series";
import type { TvChartType } from "@/modules/analytics/lib/tv-chart-type";

interface TVWidgetBodyProps {
  chartType: TvChartType;
  measure?: RawMeasure | null;
  formatId?: string | null;
}

/**
 * Corpo do widget (#1218) — a única região que varia entre os formatos.
 * Escolhe o renderer e trata a DEGRADAÇÃO (AC: sem dado, dado vazio, 1 categoria,
 * muitas categorias). Vai DENTRO do WidgetFrame como children — o valor de
 * cabeça e a proveniência são do frame, não do corpo.
 *
 * `number` não tem corpo: o valor de cabeça do frame já é o widget inteiro.
 */
export function TVWidgetBody({ chartType, measure, formatId }: TVWidgetBodyProps) {
  if (chartType === "number") return null;

  const series: MetricSeriesPoint[] = Array.isArray(measure?.series) ? measure!.series! : [];
  const state = seriesState(measure);

  // Sem dado: o corpo NÃO inventa forma vazia. O valor de cabeça do frame já
  // mostra "—"; o corpo some para não desenhar um gráfico de nada (AC degrada).
  if (state === "empty") return null;

  switch (chartType) {
    case "bar":
      return <BarRenderer series={series} formatId={formatId} />;
    case "line":
      // 1 ponto não é linha. Cai para o valor de cabeça (corpo some).
      return state === "single" ? null : <LineRenderer series={series} />;
    case "donut":
      return <DonutRenderer series={series} formatId={formatId} />;
    default:
      return null;
  }
}
