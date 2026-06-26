/**
 * Formatadores e config de horizonte da ferramenta master de unit economics.
 * Currency/percent sempre pt-BR. Tudo puro (sem I/O), unit-testável.
 */

import {
  startOfMonth,
  startOfQuarter,
  startOfYear,
  format,
  parseISO,
} from "date-fns";
import { ptBR } from "date-fns/locale";

export type Horizonte = "mensal" | "trimestral" | "anual";

export interface HorizonteMeta {
  key: Horizonte;
  label: string;
  /** Horizonte da curva de payback (meses) — projeção, desacoplada da janela de dados. */
  curveMeses: number;
}

/**
 * O seletor de horizonte controla DUAS coisas (DESIGN §7):
 *  1. a janela de datas (período-CALENDÁRIO corrente) passada ao
 *     `useOrgSalesSummary` — alinha a coorte do Insights à aba Saúde (decisão CTO);
 *  2. o `curveMeses` da curva J (projeção da recuperação; a calc clampa a [3,120]).
 *     A curva é desacoplada da janela de dados — projeta, não observa.
 */
export const HORIZONTES: HorizonteMeta[] = [
  { key: "mensal", label: "Mensal", curveMeses: 12 },
  { key: "trimestral", label: "Trimestral", curveMeses: 18 },
  { key: "anual", label: "Anual", curveMeses: 24 },
];

export function horizonteMeta(h: Horizonte): HorizonteMeta {
  return HORIZONTES.find((x) => x.key === h) ?? HORIZONTES[0];
}

/** Início do período-calendário corrente para o horizonte (mês / trimestre / ano). */
function periodStart(h: Horizonte, ref: Date): Date {
  switch (h) {
    case "trimestral":
      return startOfQuarter(ref);
    case "anual":
      return startOfYear(ref);
    case "mensal":
    default:
      return startOfMonth(ref);
  }
}

/**
 * Janela [start, end] (YYYY-MM-DD) do período-CALENDÁRIO corrente, não trailing:
 *  - mensal → [1º dia do mês, hoje]
 *  - trimestral → [1º dia do trimestre, hoje]
 *  - anual → [1º dia do ano, hoje]
 * Alinha a coorte (created_at) do Insights à aba Saúde do funil (decisão CTO).
 * `ref` é injetável p/ testes determinísticos.
 */
export function horizonteRange(
  h: Horizonte,
  ref: Date = new Date(),
): { start: string; end: string } {
  return {
    start: format(periodStart(h, ref), "yyyy-MM-dd"),
    end: format(ref, "yyyy-MM-dd"),
  };
}

/**
 * Rótulo pt-BR explícito do período observado, p/ exibir perto dos KPIs.
 * Ex.: "01/06 – 26/06/2026" (ano único) ou "15/12/2025 – 03/01/2026".
 */
export function formatPeriodRange(start: string, end: string): string {
  const s = parseISO(start);
  const e = parseISO(end);
  const sameYear = s.getFullYear() === e.getFullYear();
  const left = format(s, sameYear ? "dd/MM" : "dd/MM/yyyy", { locale: ptBR });
  const right = format(e, "dd/MM/yyyy", { locale: ptBR });
  return `${left} – ${right}`;
}

const brl0 = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const brl2 = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Moeda pt-BR. `cents` para ticket médio / valores sensíveis a centavos. */
export function formatBRL(value: number, opts?: { cents?: boolean }): string {
  const v = Number.isFinite(value) ? value : 0;
  return (opts?.cents ? brl2 : brl0).format(v);
}

/** Moeda com sinal explícito de débito (−R$ X) para o fundo da curva. */
export function formatSignedBRL(value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  if (v < 0) return `−${formatBRL(Math.abs(v))}`;
  return formatBRL(v);
}

const pctFmt = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

/** Percentual pt-BR: `10` → "10 %", `1.5` → "1,5 %". */
export function formatPercent(value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  return `${pctFmt.format(v)} %`;
}

const pct0Fmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/** ROI pt-BR com sinal explícito: `150` → "+150 %", `-100` → "−100 %", `0` → "0 %". */
export function formatSignedPercent(value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  const rounded = Math.round(v);
  if (rounded > 0) return `+${pct0Fmt.format(rounded)} %`;
  if (rounded < 0) return `−${pct0Fmt.format(Math.abs(rounded))} %`;
  return "0 %";
}

const numFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/** Inteiro pt-BR (nº de vendas etc.). */
export function formatInt(value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  return numFmt.format(Math.round(v));
}

const comprasFmt = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Nº de compras do payback: "1,3". */
export function formatCompras(value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  return comprasFmt.format(v);
}

/** Mês fracionário → rótulo curto: 5.4 → "mês 5". */
export function formatMes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `mês ${Math.round(value)}`;
}
