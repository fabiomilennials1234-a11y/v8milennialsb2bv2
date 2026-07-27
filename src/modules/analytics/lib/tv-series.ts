/**
 * Preparo de séries para os renderers da TV (#1218, spec §3.1/§3.3).
 *
 * Camada PURA: recebe a série que o motor devolve (`{key,label,value}[]`) e
 * aplica as regras de convivência (§3.1) antes de qualquer pixel — máx de
 * categorias, agrupamento de excedente em "Outros", soma para o valor de cabeça.
 *
 * Não chama o motor. Consome o que já veio no snapshot (uma chamada por
 * atualização). `resolveHeadValue` do #1207 continua sendo quem honra empty_reason.
 */

import { isEmptyReason } from "./tv-metric-format";

export interface MetricSeriesPoint {
  key: string | null;
  label: string;
  value: number;
}

export interface RawMeasure {
  value?: number | null;
  series?: MetricSeriesPoint[] | null;
  empty_reason?: string | null;
  /** Alvo/meta para o formato Progresso (#1253). O motor NÃO serve isto no S1
   *  (decisão Cais mode b) — fica ausente e o Progresso degrada para Número. */
  target?: number | null;
}

/** Rótulo do bucket de excedente. Uma categoria, não "e outros 12". */
export const OTHERS_LABEL = "Outros";

/**
 * Valor de cabeça de um widget de série (§1②/§3.1: todo formato tem valor de
 * cabeça — barra=soma, linha=total do período, donut=total).
 *
 * Regra: se o motor já deu um escalar (`value`), ele manda. Senão, soma a série.
 * `empty_reason` vence tudo (§5.2): sem registros → null (vira travessão), nunca 0.
 */
export function headValueFromMeasure(m?: RawMeasure | null): number | null {
  if (!m) return null;
  if (isEmptyReason(m.empty_reason)) return null;
  if (m.value !== null && m.value !== undefined) return m.value;
  if (Array.isArray(m.series) && m.series.length > 0) {
    return m.series.reduce((sum, p) => sum + (p.value ?? 0), 0);
  }
  return null;
}

/**
 * Ordena desc por valor e agrupa o excedente acima de `max` num único bucket
 * "Outros" (§3.1 regra 4: máx 5 categorias; §3.3 donut: máx 4 fatias + Outros).
 *
 * "Outros" só nasce quando há MAIS de um item excedente que justifique — um
 * único item além do teto vira "Outros" com um só membro, o que é honesto mas
 * inútil; então o teto efetivo é `max`, e o (max+1)-ésimo em diante colapsa.
 */
export function groupTopN(series: MetricSeriesPoint[], max: number): MetricSeriesPoint[] {
  if (!Array.isArray(series) || series.length === 0) return [];
  const sorted = [...series].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  if (sorted.length <= max) return sorted;

  const head = sorted.slice(0, max - 1); // guarda 1 vaga para "Outros"
  const tail = sorted.slice(max - 1);
  const othersValue = tail.reduce((sum, p) => sum + (p.value ?? 0), 0);
  return [...head, { key: "__others__", label: OTHERS_LABEL, value: othersValue }];
}

/** Percentual de cada fatia sobre o total — para rótulo do donut (§3.3). */
export function withShare(series: MetricSeriesPoint[]): (MetricSeriesPoint & { share: number })[] {
  const total = series.reduce((sum, p) => sum + (p.value ?? 0), 0);
  return series.map((p) => ({ ...p, share: total > 0 ? (p.value ?? 0) / total : 0 }));
}

/** Estado de uma série para os renderers escolherem a degradação (§3.1, AC). */
export type SeriesState = "empty" | "single" | "multi";

export function seriesState(m?: RawMeasure | null): SeriesState {
  const n = Array.isArray(m?.series) ? m!.series!.length : 0;
  if (isEmptyReason(m?.empty_reason) || n === 0) return "empty";
  if (n === 1) return "single";
  return "multi";
}

/** Rampa ordinal (barra/funil/ranking) — cor por posição, até 5 degraus. */
export function ordinalColor(index: number): string {
  const ramp = Math.min(index + 1, 5);
  return `hsl(var(--metric-ramp-${ramp}))`;
}

/** Rampa categórica (donut) — cor por categoria, cicla em 5 hues. */
export function categoricalColor(index: number): string {
  return `hsl(var(--chart-${(index % 5) + 1}))`;
}
