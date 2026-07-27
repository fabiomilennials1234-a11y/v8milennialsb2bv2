import { BarRenderer } from "./renderers/BarRenderer";
import { LineRenderer } from "./renderers/LineRenderer";
import { DonutRenderer } from "./renderers/DonutRenderer";
import { RankingRenderer } from "./renderers/RankingRenderer";
import { ProgressRenderer } from "./renderers/ProgressRenderer";
import { FunnelRenderer } from "./renderers/FunnelRenderer";
import { seriesState, headValueFromMeasure, type MetricSeriesPoint, type RawMeasure } from "@/modules/analytics/lib/tv-series";
import type { TvChartType } from "@/modules/analytics/lib/tv-chart-type";

interface TVWidgetBodyProps {
  chartType: TvChartType;
  measure?: RawMeasure | null;
  formatId?: string | null;
  /** Param do estilo (#1253): ranking podium|list, progress tube|bar|radial. */
  styleVariant?: string | null;
}

/**
 * Corpo do widget (#1218 / #1253) — a única região que varia entre os formatos.
 * Escolhe o renderer e trata a DEGRADAÇÃO (sem dado, vazio, 1 categoria, muitas).
 * Vai DENTRO do WidgetFrame como children — o valor de cabeça e a proveniência
 * são do frame, não do corpo.
 *
 * `number` não tem corpo: o valor de cabeça do frame já é o widget inteiro.
 */
export function TVWidgetBody({ chartType, measure, formatId, styleVariant }: TVWidgetBodyProps) {
  if (chartType === "number") return null;

  // Progresso é ESCALAR (valor ÷ alvo), não série — tratado ANTES do check de
  // série vazia. Sem alvo (S1), o ProgressRenderer devolve null e o widget
  // degrada para Número (o valor de cabeça do frame é o corpo).
  if (chartType === "progress") {
    return (
      <ProgressRenderer
        value={headValueFromMeasure(measure)}
        target={measure?.target ?? null}
        formatId={formatId}
        variant={styleVariant}
      />
    );
  }

  const series: MetricSeriesPoint[] = Array.isArray(measure?.series) ? measure!.series! : [];
  const state = seriesState(measure);

  // Sem dado de série: o corpo NÃO inventa forma vazia. O frame já mostra "—".
  if (state === "empty") return null;

  switch (chartType) {
    case "bar":
      return <BarRenderer series={series} formatId={formatId} />;
    case "line":
      // 1 ponto não é linha. Cai para o valor de cabeça (corpo some).
      return state === "single" ? null : <LineRenderer series={series} />;
    case "donut":
      return <DonutRenderer series={series} formatId={formatId} />;
    case "ranking":
      return <RankingRenderer series={series} formatId={formatId} variant={styleVariant} />;
    case "funnel":
      // Funil PRESERVA a ordem de estágio da série (não re-ordena por volume).
      // A ordenação por estágio é do dado/motor (map §1: "ordem de estágio no
      // motor, hoje val-desc") — deferida; o renderer honra a ordem recebida.
      return <FunnelRenderer series={series} formatId={formatId} variant={styleVariant} />;
    default:
      return null;
  }
}
