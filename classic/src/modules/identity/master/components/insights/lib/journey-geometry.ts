/**
 * Geometria pura da Linha do Tempo de unit economics — escalas dual-axis com
 * ZERO COMPARTILHADO, gerador de path monotone-cubic (hand-roll, ZERO dep) e
 * posicionamento de bandas/marcador. Sem React, unit-testável.
 *
 * O gerador `monotoneCubicPath` (Fritsch–Carlson) preserva a monotonicidade dos
 * dados entre nós (sem overshoot/wiggle) — herdado da antiga Curva J e reusado
 * pelas 3 séries. Os domínios dos eixos já vêm alinhados no zero da calc lib
 * (`economics-timeline.ts`); aqui só projetamos em pixels.
 */

import type {
  EconomicsTimeline,
  PhaseKey,
  TimelinePoint,
} from "../../../lib/economics-timeline";

export interface Pt {
  x: number;
  y: number;
}

export interface JourneyPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** `left`/`right` acomodam os ticks dos dois eixos (R$ esq., ROI dir.). */
export const DEFAULT_JOURNEY_PADDING: JourneyPadding = {
  top: 30,
  right: 56,
  bottom: 30,
  left: 60,
};

export interface JourneyBand {
  key: PhaseKey;
  nome: string;
  x0: number;
  x1: number;
}

export interface JourneyMarkerGeo {
  mes: number;
  phaseKey: PhaseKey;
  x: number;
  caixaY: number;
  investY: number;
  roiY: number;
  caixaValor: number;
  investValor: number;
  roiValor: number;
}

export interface AxisTick {
  valor: number;
  y: number;
}

export interface MonthTick {
  mes: number;
  x: number;
}

export interface JourneyGeometry {
  width: number;
  height: number;
  pad: JourneyPadding;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  /** y em px da régua do zero — comum aos dois eixos (R$ 0 · ROI 0). */
  zeroY: number;
  sxMes: (mes: number) => number;
  syReais: (valor: number) => number;
  syRoi: (valor: number) => number;
  /** Paths das 3 séries. */
  caixaLinePath: string;
  caixaAreaPath: string;
  investLinePath: string;
  roiLinePath: string;
  ghostCaixaPath: string | null;
  bands: JourneyBand[];
  marker: JourneyMarkerGeo | null;
  reaisTicks: AxisTick[];
  roiTicks: AxisTick[];
  monthTicks: MonthTick[];
}

/**
 * Gera o `d` de um path cúbico monotônico (Fritsch–Carlson) através de `pts`.
 * Sem overshoot entre nós.
 */
export function monotoneCubicPath(pts: Pt[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  if (n === 2) return `M${pts[0].x},${pts[0].y}L${pts[1].x},${pts[1].y}`;

  const dx: number[] = [];
  const dy: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    dy[i] = pts[i + 1].y - pts[i].y;
    slope[i] = dx[i] !== 0 ? dy[i] / dx[i] : 0;
  }

  const tan: number[] = new Array(n);
  tan[0] = slope[0];
  tan[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      tan[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      tan[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }

  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = pts[i].x + dx[i] / 3;
    const c1y = pts[i].y + (tan[i] * dx[i]) / 3;
    const c2x = pts[i + 1].x - dx[i] / 3;
    const c2y = pts[i + 1].y - (tan[i + 1] * dx[i]) / 3;
    d += `C${c1x},${c1y} ${c2x},${c2y} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

/** Interpolação linear do valor de uma série num mês fracionário. */
export function interpValueAt(points: TimelinePoint[], mes: number): number {
  if (points.length === 0) return 0;
  if (mes <= points[0].mes) return points[0].valor;
  const last = points[points.length - 1];
  if (mes >= last.mes) return last.valor;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (mes >= a.mes && mes <= b.mes) {
      const span = b.mes - a.mes || 1;
      const t = (mes - a.mes) / span;
      return a.valor + (b.valor - a.valor) * t;
    }
  }
  return last.valor;
}

/** ~4 ticks "redondos" cobrindo [min, max] e incluindo o zero. */
function buildTicks(
  min: number,
  max: number,
  proj: (v: number) => number,
): AxisTick[] {
  const span = max - min || 1;
  const raw = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(raw) || 1)));
  const step = Math.max(Math.round(raw / mag) * mag, mag);
  const ticks: AxisTick[] = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + step * 0.5; v += step) {
    const rv = Math.abs(v) < step * 0.001 ? 0 : v;
    ticks.push({ valor: rv, y: proj(rv) });
  }
  if (!ticks.some((t) => t.valor === 0) && min < 0 && max > 0) {
    ticks.push({ valor: 0, y: proj(0) });
  }
  return ticks;
}

interface BuildArgs {
  timeline: EconomicsTimeline;
  width: number;
  height: number;
  ghostCaixa?: TimelinePoint[] | null;
  pad?: JourneyPadding;
}

export function buildJourneyGeometry({
  timeline,
  width,
  height,
  ghostCaixa,
  pad = DEFAULT_JOURNEY_PADDING,
}: BuildArgs): JourneyGeometry {
  const plotLeft = pad.left;
  const plotRight = width - pad.right;
  const plotTop = pad.top;
  const plotBottom = height - pad.bottom;
  const plotW = Math.max(1, plotRight - plotLeft);
  const plotH = Math.max(1, plotBottom - plotTop);

  const { months, caixa, investimento, roi, axis } = timeline;
  const mMin = months[0] ?? 1;
  const mMax = months[months.length - 1] ?? 18;
  const mSpan = mMax - mMin || 1;

  const sxMes = (mes: number) =>
    plotLeft + (clamp(mes, mMin, mMax) - mMin) / mSpan * plotW;

  const reaisSpan = axis.reaisMax - axis.reaisMin || 1;
  const roiSpan = axis.roiMax - axis.roiMin || 1;
  const syReais = (v: number) => plotTop + ((axis.reaisMax - v) / reaisSpan) * plotH;
  const syRoi = (v: number) => plotTop + ((axis.roiMax - v) / roiSpan) * plotH;

  // Zero compartilhado (a calc garante syReais(0) === syRoi(0)).
  const zeroY = syReais(0);

  // ── Paths ──
  const caixaPx: Pt[] = caixa.map((p) => ({ x: sxMes(p.mes), y: syReais(p.valor) }));
  const caixaLinePath = monotoneCubicPath(caixaPx);
  const firstC = caixaPx[0];
  const lastC = caixaPx[caixaPx.length - 1];
  const caixaAreaPath =
    caixaPx.length > 1
      ? `${caixaLinePath}L${lastC.x},${zeroY}L${firstC.x},${zeroY}Z`
      : "";

  const investPx: Pt[] = investimento.map((p) => ({
    x: sxMes(p.mes),
    y: syReais(p.valor),
  }));
  const investLinePath = monotoneCubicPath(investPx);

  const roiPx: Pt[] = roi.map((p) => ({ x: sxMes(p.mes), y: syRoi(p.valor) }));
  const roiLinePath = monotoneCubicPath(roiPx);

  const ghostPx = ghostCaixa?.map((p) => ({ x: sxMes(p.mes), y: syReais(p.valor) }));
  const ghostCaixaPath = ghostPx && ghostPx.length > 1 ? monotoneCubicPath(ghostPx) : null;

  // ── Bandas (tiling contíguo por ponto médio entre fases adjacentes) ──
  const bands: JourneyBand[] = timeline.phases.map((ph, i, arr) => {
    const leftMes = i === 0 ? mMin : (arr[i - 1].endMes + ph.startMes) / 2;
    const rightMes =
      i === arr.length - 1 ? mMax : (ph.endMes + arr[i + 1].startMes) / 2;
    return { key: ph.key, nome: ph.nome, x0: sxMes(leftMes), x1: sxMes(rightMes) };
  });

  // ── Marcador ──
  let marker: JourneyMarkerGeo | null = null;
  if (timeline.markerMes !== null && timeline.markerPhaseKey !== null) {
    const mes = timeline.markerMes;
    const caixaValor = interpValueAt(caixa, mes);
    const investValor = interpValueAt(investimento, mes);
    const roiValor = interpValueAt(roi, mes);
    marker = {
      mes,
      phaseKey: timeline.markerPhaseKey,
      x: sxMes(mes),
      caixaY: syReais(caixaValor),
      investY: syReais(investValor),
      roiY: syRoi(roiValor),
      caixaValor,
      investValor,
      roiValor,
    };
  }

  // ── Ticks ──
  const reaisTicks = buildTicks(axis.reaisMin, axis.reaisMax, syReais);
  const roiTicks = buildTicks(axis.roiMin, axis.roiMax, syRoi);
  const monthTicks: MonthTick[] = months
    .filter((m) => m === mMin || m === mMax || m % 3 === 0)
    .map((m) => ({ mes: m, x: sxMes(m) }));

  return {
    width,
    height,
    pad,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    zeroY,
    sxMes,
    syReais,
    syRoi,
    caixaLinePath,
    caixaAreaPath,
    investLinePath,
    roiLinePath,
    ghostCaixaPath,
    bands,
    marker,
    reaisTicks,
    roiTicks,
    monthTicks,
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
