/**
 * Geometria pura da Curva J — escalas, gerador de path monotone-cubic
 * (hand-roll, ZERO dep: d3-shape não vem transitivo de forma estável do
 * recharts) e posicionamento de marcadores. Sem React, unit-testável.
 *
 * O gerador usa interpolação cúbica monotônica (Fritsch–Carlson): preserva a
 * monotonicidade dos dados (não cria overshoot/wiggle entre pontos), exatamente
 * o que uma curva de payback em J precisa.
 */

import type {
  PaybackCurvePoint,
  PaybackCurveMarks,
} from "../../../lib/unit-economics";

export interface Pt {
  x: number;
  y: number;
}

export interface JCurvePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_PADDING: JCurvePadding = {
  top: 24,
  right: 24,
  bottom: 28,
  left: 56,
};

export interface JCurveGeometry {
  width: number;
  height: number;
  pad: JCurvePadding;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  /** y em px da régua do zero. */
  zeroY: number;
  /** Escalas. */
  sx: (mes: number) => number;
  sy: (valor: number) => number;
  /** Domínio do eixo X (meses). */
  xMax: number;
  /** Pontos da curva primária já em px. */
  pixelPoints: Pt[];
  /** Path suave (monotone cubic) da curva primária. */
  linePath: string;
  /** Área fechada (linha + volta pela régua do zero) para preencher. */
  areaPath: string;
  /** Path suave do overlay fantasma (curva real), se fornecido — mesmas escalas. */
  ghostPath: string | null;
  /** Marcadores em px (null quando não aplicável). */
  bottomMark: { x: number; y: number; valor: number } | null;
  breakEvenMark: { x: number; mes: number } | null;
}

/**
 * Gera o `d` de um path cúbico monotônico (Fritsch–Carlson) através de `pts`.
 * Sem overshoot entre nós — ideal para a curva de payback.
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

  // Tangentes nos nós.
  const tan: number[] = new Array(n);
  tan[0] = slope[0];
  tan[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      tan[i] = 0; // extremo local → tangente horizontal (preserva monotonicidade)
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

interface BuildArgs {
  points: PaybackCurvePoint[];
  marks: PaybackCurveMarks;
  width: number;
  height: number;
  /** Curva real de referência (aba Projeção) — entra no domínio p/ alinhar. */
  ghostPoints?: PaybackCurvePoint[] | null;
  pad?: JCurvePadding;
}

/**
 * Constrói toda a geometria em px a partir dos pontos da calc lib.
 * Domínio Y inclui sempre o zero e ganha folga simétrica (8%).
 */
export function buildJCurveGeometry({
  points,
  marks,
  width,
  height,
  ghostPoints,
  pad = DEFAULT_PADDING,
}: BuildArgs): JCurveGeometry {
  const plotLeft = pad.left;
  const plotRight = width - pad.right;
  const plotTop = pad.top;
  const plotBottom = height - pad.bottom;
  const plotW = Math.max(1, plotRight - plotLeft);
  const plotH = Math.max(1, plotBottom - plotTop);

  const xMax = Math.max(1, marks.horizonteMeses);

  const allValues = [
    ...points.map((p) => p.valor),
    ...(ghostPoints?.map((p) => p.valor) ?? []),
    0,
  ];
  let yMin = Math.min(...allValues);
  let yMax = Math.max(...allValues);
  if (yMin === yMax) {
    // Série degenerada (tudo zero) — abre um domínio simbólico p/ a régua.
    yMin = -1;
    yMax = 1;
  }
  const padY = (yMax - yMin) * 0.08;
  yMin -= padY;
  yMax += padY;
  const ySpan = yMax - yMin || 1;

  const sx = (mes: number) => plotLeft + (Math.min(Math.max(mes, 0), xMax) / xMax) * plotW;
  const sy = (valor: number) => plotTop + ((yMax - valor) / ySpan) * plotH;

  const zeroY = sy(0);

  const pixelPoints: Pt[] = points.map((p) => ({ x: sx(p.mes), y: sy(p.valor) }));
  const linePath = monotoneCubicPath(pixelPoints);

  const ghostPixels = ghostPoints?.map((p) => ({ x: sx(p.mes), y: sy(p.valor) }));
  const ghostPath = ghostPixels && ghostPixels.length > 1 ? monotoneCubicPath(ghostPixels) : null;

  // Área fechada = curva + descida à régua do zero + retorno.
  const first = pixelPoints[0];
  const last = pixelPoints[pixelPoints.length - 1];
  const areaPath =
    pixelPoints.length > 1
      ? `${linePath}L${last.x},${zeroY}L${first.x},${zeroY}Z`
      : "";

  // Fundo do J: ponto de menor valor da curva canônica (= depth real ancorado).
  let bottomMark: JCurveGeometry["bottomMark"] = null;
  if (points.length > 0) {
    let minIdx = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i].valor < points[minIdx].valor) minIdx = i;
    }
    if (points[minIdx].valor < 0) {
      bottomMark = {
        x: sx(points[minIdx].mes),
        y: sy(points[minIdx].valor),
        valor: points[minIdx].valor,
      };
    }
  }

  const breakEvenMark =
    marks.breakEvenMes != null
      ? { x: sx(marks.breakEvenMes), mes: marks.breakEvenMes }
      : null;

  return {
    width,
    height,
    pad,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    zeroY,
    sx,
    sy,
    xMax,
    pixelPoints,
    linePath,
    areaPath,
    ghostPath,
    bottomMark,
    breakEvenMark,
  };
}
