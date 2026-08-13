import { useMemo } from "react";
import { useMetricMeasure, type MetricMeasureResult } from "./useMetricMeasure";
import type { EngineMetric, MetricRecorte } from "@/modules/analytics/lib/metrics-studio-engine-map";
import {
  periodoAnterior,
  periodoAtual,
  type IntervaloCustom,
  type StudioPeriod,
} from "@/modules/analytics/lib/metrics-studio-period";
import {
  agruparSerie,
  ehMedidaDeMedia,
  granularidadeAutomatica,
  type Granularidade,
} from "@/modules/analytics/lib/metrics-studio-granularidade";
import { headValueFromMeasure, type MetricSeriesPoint } from "@/modules/analytics/lib/tv-series";

/**
 * Dado de UMA janela do Estúdio (SCRUM-310).
 *
 * Concentra aqui as três asperezas do motor, para que a janela não precise
 * conhecer nenhuma delas:
 *
 * 1. `value` XOR `series`. Com recorte `total` vem o número e `series: null`;
 *    com qualquer outro vem a série e `value: null`. O valor de cabeça sai de
 *    `headValueFromMeasure`, que soma a série quando o escalar não veio.
 *
 * 2. TODA série do motor vem ordenada por VALOR desc — inclusive `tempo`.
 *    Desenhar linha nessa ordem produz um gráfico temporal embaralhado. Aqui a
 *    série de tempo é reordenada por `key` (que é `YYYY-MM-DD`).
 *
 * 3. G4 do grill: o comparativo exige uma SEGUNDA chamada, com a referência
 *    deslocada. Ela é sempre no recorte `total` — comparar fatia a fatia é
 *    outra pergunta, e mais cara.
 *
 * O comparativo NÃO bloqueia a janela: `isLoading` observa só a consulta
 * principal. O número aparece assim que existe, e a setinha entra depois.
 */

export interface MetricWindowData {
  medida: MetricMeasureResult | null;
  /** Já ordenada e agrupada: cronológica em `tempo`, por valor nos demais. */
  series: MetricSeriesPoint[];
  /** Granularidade REALMENTE aplicada — a janela rotula por ela, não pelo pedido. */
  granularidade: Granularidade;
  valorAnterior: number | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useMetricWindowData(
  metric: EngineMetric,
  corte: MetricRecorte,
  period: StudioPeriod,
  intervalo?: IntervaloCustom | null,
  /** `undefined` = automática pelo tamanho da janela. */
  granularidadePedida?: Granularidade,
): MetricWindowData {
  // `hoje` fica fora do useMemo de propósito: recalcular a cada render é
  // barato, e congelar a data numa aba aberta o dia inteiro faria a janela
  // continuar mostrando ontem.
  const atual = periodoAtual(period, undefined, intervalo);
  const anterior = periodoAnterior(period, undefined, intervalo);

  const principal = useMetricMeasure({
    measureRef: metric.measureRef,
    recorte: corte,
    period: atual.period,
    ref: atual.ref,
    start: atual.start,
    end: atual.end,
    filters: metric.filtrosFixos,
  });

  const comparativo = useMetricMeasure({
    measureRef: metric.measureRef,
    recorte: "total",
    period: anterior.period,
    ref: anterior.ref,
    start: anterior.start,
    end: anterior.end,
    filters: metric.filtrosFixos,
  });

  const medida = principal.data ?? null;

  // Granularidade efetiva: o que a pessoa pediu, ou a automática pelo número de
  // pontos que o motor devolveu. Fica fora do `useMemo` da série porque a
  // janela precisa dela para rotular o seletor mesmo quando a série está vazia.
  const pontosBrutos = Array.isArray(medida?.series) ? medida.series.length : 0;
  const granularidade: Granularidade =
    corte === "tempo" ? (granularidadePedida ?? granularidadeAutomatica(pontosBrutos)) : "dia";

  const series = useMemo(() => {
    const bruta = medida?.series;
    if (!Array.isArray(bruta) || bruta.length === 0) return [];
    if (corte !== "tempo") return bruta;
    // `key` é 'YYYY-MM-DD', então ordenação lexicográfica é cronológica.
    const cronologica = [...bruta].sort((a, b) => (a.key ?? "").localeCompare(b.key ?? ""));
    return agruparSerie(cronologica, granularidade, ehMedidaDeMedia(medida?.measure_id));
  }, [medida, corte, granularidade]);

  return {
    medida,
    series,
    granularidade,
    valorAnterior: headValueFromMeasure(comparativo.data ?? null),
    isLoading: principal.isLoading,
    isError: principal.isError,
    refetch: () => {
      void principal.refetch();
      void comparativo.refetch();
    },
  };
}
