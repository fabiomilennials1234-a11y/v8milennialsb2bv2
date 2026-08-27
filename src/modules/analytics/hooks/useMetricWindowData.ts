import { useMemo } from "react";
import { useMetricMeasure, type MetricMeasureResult } from "./useMetricMeasure";
import type { EngineMetric, MetricRecorte } from "@/modules/analytics/lib/metrics-studio-engine-map";
import {
  periodoAnterior,
  periodoAtual,
  type StudioPeriod,
  type StudioRange,
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

/**
 * Cobertura do preenchimento de uma medida de dinheiro do funil (SCRUM-545).
 *
 * `null` quando a medida não devolve cobertura — a maioria. Ausência é
 * "não se aplica", nunca "cobertura total".
 */
export interface MetricCoverage {
  total: number;
  comValor: number;
  /** 0–100. `0` quando não há negócio nenhum, e aí a janela já está vazia. */
  percentual: number;
  /** Abaixo de 80% o número parcial engana mais do que informa. */
  parcial: boolean;
}

export function coberturaDaMedida(medida: MetricMeasureResult | null): MetricCoverage | null {
  const total = medida?.coverage_total;
  const comValor = medida?.coverage_com_valor;
  // Checagem por tipo, não por veracidade: `0` é cobertura legítima e
  // `comValor > 0` seria falso justamente no caso que mais precisa do aviso.
  if (typeof total !== "number" || typeof comValor !== "number") return null;
  if (total <= 0) return { total: 0, comValor: 0, percentual: 0, parcial: false };
  const percentual = (comValor / total) * 100;
  return { total, comValor, percentual, parcial: percentual < 80 };
}

export interface MetricWindowData {
  medida: MetricMeasureResult | null;
  /** Já ordenada: cronológica em `tempo`, por valor nos demais cortes. */
  series: MetricSeriesPoint[];
  /**
   * Quantos negócios sustentam o número, e em quantos há valor lançado.
   * `null` na maioria das medidas — ver `coberturaDaMedida`.
   */
  cobertura: MetricCoverage | null;
  valorAnterior: number | null;
  /** Alvo do período (SCRUM-389). `null` = medida sem alvo ou mês sem meta. */
  meta: number | null;
  /**
   * Percentual do alvo alcançado, JÁ MULTIPLICADO POR 100 (SCRUM-389).
   *
   * A multiplicação mora aqui de propósito. O formatador `percent_1` apenas
   * SUFIXA "%" — quem entrega 0,87 imprime "0,9%" para uma meta 87% batida. É
   * a mesma armadilha de 100× que o ADR-0023 nomeia no motor, e ela não some
   * por estar no front.
   *
   * `null` quando não há alvo, e também quando o alvo é ZERO: dividir por zero
   * daria Infinity, e "∞% da meta" é pior que ausência.
   */
  atingimento: number | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * Percentual do alvo. Exportada para o teste poder exercitar as bordas sem
 * montar um hook — são elas que quebram na frente do cliente.
 */
export function percentualDaMeta(valor: number | null, alvo: number | null | undefined): number | null {
  if (valor === null || alvo === null || alvo === undefined) return null;
  if (alvo === 0) return null;
  return (valor / alvo) * 100;
}

export function useMetricWindowData(
  metric: EngineMetric,
  corte: MetricRecorte,
  period: StudioPeriod,
  range?: StudioRange | null,
): MetricWindowData {
  // `hoje` fica fora do useMemo de propósito: recalcular a cada render é
  // barato, e congelar a data numa aba aberta o dia inteiro faria a janela
  // continuar mostrando ontem.
  //
  // `custom` sem intervalo levanta erro nas duas funções (SCRUM-313). A página
  // só troca para `custom` depois que as duas pontas foram escolhidas, então o
  // caminho não é alcançável pela UI — mas se alguém chamar este hook direto
  // sem o intervalo, é melhor estourar aqui do que medir um período que o
  // usuário não pediu.
  const atual = periodoAtual(period, undefined, range);
  const anterior = periodoAnterior(period, undefined, range);

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

  const meta = medida?.target ?? null;

  return {
    medida,
    series,
    cobertura: coberturaDaMedida(medida),
    valorAnterior: headValueFromMeasure(comparativo.data ?? null),
    meta,
    atingimento: percentualDaMeta(headValueFromMeasure(medida), meta),
    isLoading: principal.isLoading,
    isError: principal.isError,
    refetch: () => {
      void principal.refetch();
      void comparativo.refetch();
    },
  };
}
