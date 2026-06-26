/**
 * Formatadores e config de horizonte da ferramenta master de unit economics.
 * Currency/percent sempre pt-BR. Tudo puro (sem I/O), unit-testável.
 */

export type Horizonte = "mensal" | "trimestral" | "anual";

export interface HorizonteMeta {
  key: Horizonte;
  label: string;
  /** Janela de agregação de vendas (dias, trailing a partir de hoje). */
  windowDays: number;
  /** Horizonte da curva de payback (meses) — escala com a janela observada. */
  curveMeses: number;
}

/**
 * O seletor de horizonte controla DUAS coisas (DESIGN §7):
 *  1. a janela de datas passada ao `useOrgSalesSummary` (trailing window);
 *  2. o `horizonteMeses` da curva (quanto mais longa a observação, mais longe
 *     projetamos a recuperação — a calc clampa a [3,120]).
 */
export const HORIZONTES: HorizonteMeta[] = [
  { key: "mensal", label: "Mensal", windowDays: 30, curveMeses: 12 },
  { key: "trimestral", label: "Trimestral", windowDays: 90, curveMeses: 18 },
  { key: "anual", label: "Anual", windowDays: 365, curveMeses: 24 },
];

export function horizonteMeta(h: Horizonte): HorizonteMeta {
  return HORIZONTES.find((x) => x.key === h) ?? HORIZONTES[0];
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Janela [start, end] (YYYY-MM-DD), end = hoje, start = hoje − windowDays. */
export function horizonteRange(h: Horizonte): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - horizonteMeta(h).windowDays);
  return { start: toISODate(start), end: toISODate(end) };
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
