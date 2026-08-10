/**
 * Série de AMOSTRA do Estúdio de Métricas.
 *
 * ⚠ Dado sintético e determinístico — a UI é a proposta, o número não é real.
 * O seam é de propósito estreito: `buildMetricSample(metric, periodKey)` devolve
 * exatamente o que as janelas consomem (valor, delta, série temporal, fatias).
 * Trocar por `useMetricMeasure` = reimplementar esta função, sem tocar em
 * componente nenhum.
 */

import type { MetricUnit, StudioMetric } from "./metrics-studio-catalog";

export interface SamplePoint {
  /** Rótulo curto do bucket (dd/MM). */
  label: string;
  value: number;
  /** OHLC do bucket — alimenta o gráfico de vela. */
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SampleSlice {
  label: string;
  value: number;
}

export interface MetricSample {
  value: number;
  /** Variação sobre o período anterior, em pontos percentuais do próprio valor. */
  deltaPct: number;
  series: SamplePoint[];
  slices: SampleSlice[];
}

/** Hash estável de string → seed de 32 bits. */
function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — PRNG determinístico, sem dependência. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ordem de grandeza plausível por unidade — evita "R$ 7" e "412%". */
const BASE_BY_UNIT: Record<MetricUnit, number> = {
  currency: 48000,
  count: 180,
  percent: 34,
  ratio: 1.8,
  duration: 480,
};

const SLICES_BY_FAMILY: Record<string, string[]> = {
  origem: ["Meta Ads", "Indicação", "Google", "Orgânico", "Outbound", "Evento"],
  receita: ["Recorrente", "Projeto", "Upsell", "Primeiro pedido"],
  negocio: ["Qualificação", "Confirmação", "Proposta", "Negociação", "Fechamento"],
  conversao: ["Preço", "Sem retorno", "Concorrente", "Sem fit", "Timing", "Outros"],
  equipe: ["Ana", "Hellayne", "Lucas", "Marcelo", "Copilot"],
  qualidade: ["Diamante", "Ouro", "Prata", "Bronze", "Desqualificado"],
  reuniao: ["Compareceu", "No-show", "Remarcada"],
  aquisicao: ["Meta Ads", "Indicação", "Google", "Orgânico", "Outbound"],
  meta: ["Realizado", "Restante"],
};

const BUCKETS = 14;

/**
 * Constrói a amostra de uma métrica. `periodKey` entra no seed para que trocar
 * o período mude os números de forma estável (mesmo período → mesma série).
 */
export function buildMetricSample(metric: StudioMetric, periodKey: string): MetricSample {
  const rand = rng(hashSeed(`${metric.id}:${periodKey}`));
  const base = BASE_BY_UNIT[metric.unit];

  // Passeio aleatório com tendência suave — nem reta, nem serrote.
  const drift = (rand() - 0.45) * 0.06;
  const volatility = metric.unit === "percent" || metric.unit === "ratio" ? 0.07 : 0.14;

  const series: SamplePoint[] = [];
  let cursor = base * (0.72 + rand() * 0.3);
  const today = new Date();

  for (let i = BUCKETS - 1; i >= 0; i--) {
    const open = cursor;
    const shock = (rand() - 0.5) * 2 * volatility;
    const close = Math.max(base * 0.18, open * (1 + drift + shock));
    const wick = Math.abs(close - open) * (0.4 + rand()) + base * 0.015;

    const day = new Date(today);
    day.setDate(today.getDate() - i);

    series.push({
      label: `${String(day.getDate()).padStart(2, "0")}/${String(day.getMonth() + 1).padStart(2, "0")}`,
      value: round(close, metric.unit),
      open: round(open, metric.unit),
      close: round(close, metric.unit),
      high: round(Math.max(open, close) + wick, metric.unit),
      low: round(Math.max(0, Math.min(open, close) - wick), metric.unit),
    });

    cursor = close;
  }

  // Percentual é o próprio nível, não a soma dos buckets.
  const isLevel = metric.unit === "percent" || metric.unit === "ratio" || metric.unit === "duration";
  const value = isLevel
    ? round(series[series.length - 1].close, metric.unit)
    : round(series.reduce((acc, p) => acc + p.value, 0), metric.unit);

  const first = series[0].open || 1;
  const last = series[series.length - 1].close;
  const deltaPct = round(((last - first) / first) * 100, "percent");

  const labels = SLICES_BY_FAMILY[metric.family] ?? ["A", "B", "C", "D"];
  const weights = labels.map(() => 0.25 + rand());
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const slices: SampleSlice[] = labels
    .map((label, i) => ({ label, value: round((value * weights[i]) / weightSum, metric.unit) }))
    .sort((a, b) => b.value - a.value);

  return { value, deltaPct, series, slices };
}

function round(n: number, unit: MetricUnit): number {
  if (unit === "ratio") return Math.round(n * 100) / 100;
  if (unit === "percent") return Math.round(n * 10) / 10;
  return Math.round(n);
}
