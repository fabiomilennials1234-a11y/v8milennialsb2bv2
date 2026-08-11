import { useMemo } from "react";
import { useMetricMeasure, type MetricMeasureResult } from "./useMetricMeasure";
import type { EngineMetric, MetricRecorte } from "@/modules/analytics/lib/metrics-studio-engine-map";
import {
  periodoAnterior,
  periodoAtual,
  type StudioPeriod,
} from "@/modules/analytics/lib/metrics-studio-period";
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
  /** Já ordenada: cronológica em `tempo`, por valor nos demais cortes. */
  series: MetricSeriesPoint[];
  valorAnterior: number | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useMetricWindowData(
  metric: EngineMetric,
  corte: MetricRecorte,
  period: StudioPeriod,
): MetricWindowData {
  // `hoje` fica fora do useMemo de propósito: recalcular a cada render é
  // barato, e congelar a data numa aba aberta o dia inteiro faria a janela
  // continuar mostrando ontem.
  const atual = periodoAtual(period);
  const anterior = periodoAnterior(period);

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

  const series = useMemo(() => {
    const bruta = medida?.series;
    if (!Array.isArray(bruta) || bruta.length === 0) return [];
    if (corte !== "tempo") return bruta;
    // `key` é 'YYYY-MM-DD', então ordenação lexicográfica é cronológica.
    return [...bruta].sort((a, b) => (a.key ?? "").localeCompare(b.key ?? ""));
  }, [medida, corte]);

  return {
    medida,
    series,
    valorAnterior: headValueFromMeasure(comparativo.data ?? null),
    isLoading: principal.isLoading,
    isError: principal.isError,
    refetch: () => {
      void principal.refetch();
      void comparativo.refetch();
    },
  };
}
