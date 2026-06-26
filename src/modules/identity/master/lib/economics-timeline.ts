/**
 * Linha do tempo canônica de unit economics — pure, side-effect-free.
 *
 * Substitui a narrativa da Curva J única (caixa descontado × tempo) por uma
 * LINHA DO TEMPO com 3 séries (caixa acumulado, investimento, ROI), 4 fases
 * fixas e um marcador "Você está aqui" cuja posição (`markerMes`) deriva do CAC
 * atual da org versus as bandas-alvo (ticket médio).
 *
 * PRINCÍPIO (DESIGN JOURNEY-CHART-REDESIGN §0/§11): a FORMA é canônica e fixa —
 * a MESMA história para todas as orgs (mergulho → break-even → ganho de margem →
 * alavancagem). Só a ESCALA (profundidade do caixa, altura do investimento, pico
 * do ROI, posição do marcador) vem do dado real. Toda org reconhece a mesma
 * narrativa — é o que torna a peça *deste produto*.
 *
 * Ancoragens dos dados (confirmadas pelo CTO):
 *   - investimento[]  → escalado pelo gasto de anúncios mensal (`inputs.anuncios`).
 *   - caixa[] (fundo) → ancorado no investimento acumulado do período de prejuízo
 *                       (despesas mensais × meses até o fundo).
 *   - caixa[] (subida)→ ancorada na margem mensal = faturamento − despesasTotais.
 *   - roi[]           → forma canônica direta (cruza 0 no MESMO mês do caixa, p/
 *                       honrar a régua de zero compartilhado), com pico ancorado
 *                       na margem-sobre-custo real (bounded, ilustrativo).
 *
 * Eixos com ZERO COMPARTILHADO (decisão-chave do design §3): os domínios do eixo
 * R$ (caixa+investimento) e do eixo ROI(%) são retornados já alinhados de modo
 * que o pixel do 0 dos dois coincida — break-even é UM único momento visual.
 *
 * Contrato defensivo: inputs não-finitos → 0; numVendas<=0 → `defined:false` e
 * `markerMes:null` (sem marcador), mas as séries canônicas seguem populadas
 * (forma esmaecida didática — o card nunca fica vazio). Tudo finito, sem NaN.
 */

import {
  computeCac,
  cacBands,
  type UnitEconomicsInputs,
} from "./unit-economics";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos (contrato §11)
// ─────────────────────────────────────────────────────────────────────────────

export type PhaseKey = "prejuizo" | "breakeven" | "margem" | "alavancagem";

export interface TimelinePoint {
  mes: number;
  valor: number;
}

export interface TimelinePhase {
  key: PhaseKey;
  /** Rótulo pt-BR (chip de fase / footer). */
  nome: string;
  startMes: number;
  endMes: number;
}

/** Domínios dos dois eixos, já alinhados no zero compartilhado. */
export interface TimelineAxis {
  reaisMin: number;
  reaisMax: number;
  roiMin: number;
  roiMax: number;
}

export interface EconomicsTimeline {
  /**
   * `false` quando numVendas<=0 (sem dado real). As séries seguem populadas
   * (forma canônica esmaecida), mas `markerMes` é `null` (sem marcador).
   */
  defined: boolean;
  /** Eixo X: meses 1..N (N = 18 = 12 + ciclos de alavancagem). */
  months: number[];
  /** Caixa acumulado (R$) — J + ondas crescentes. Protagonista. */
  caixa: TimelinePoint[];
  /** Investimento em tráfego (R$) — sobe, degraus nos ciclos 12+. Monotônico. */
  investimento: TimelinePoint[];
  /** ROI (%) — negativo → cruza 0 (~mês 5) → sobe → oscila nos ciclos. */
  roi: TimelinePoint[];
  /** 4 fases fixas (mesma história p/ todas as orgs). */
  phases: TimelinePhase[];
  /** Posição do marcador (mês fracionário). `null` → sem marcador. */
  markerMes: number | null;
  /** Fase em que o marcador cai. `null` quando markerMes é null. */
  markerPhaseKey: PhaseKey | null;
  /** Domínios dos eixos com zero compartilhado: syReais(0) === syRoi(0). */
  axis: TimelineAxis;
  /** Valores reais auditáveis (tooltip do marcador / a11y). */
  meta: {
    cacAtual: number | null;
    cacMaximo: number | null;
    cacMinimo: number | null;
    /** Margem mensal = faturamento − despesasTotais. */
    marginMensal: number;
    /** Investimento mensal usado p/ escalar a linha (= anúncios, clampado >=0). */
    investMensal: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes do modelo canônico
// ─────────────────────────────────────────────────────────────────────────────

/** Horizonte da linha do tempo: 12 meses + 6 de ciclos de alavancagem. */
export const TIMELINE_MONTHS = 18;
/** Mês do fundo do J (maior caixa consumido). */
const BOTTOM_MES = 4;
/** Mês em que caixa e ROI cruzam 0 (break-even — régua compartilhada). */
const BREAKEVEN_MES = 5;
/** Mês que encerra a fase de ganho de margem (e referência do pico canônico). */
const MARGEM_END_MES = 12;
/** Meses de margem usados p/ ancorar a altura da subida do caixa. */
const RISE_REF_MONTHS = 7;

/** Fases canônicas e fixas (§4). */
const PHASES: readonly TimelinePhase[] = [
  { key: "prejuizo", nome: "Prejuízo", startMes: 1, endMes: 3 },
  { key: "breakeven", nome: "Break-even", startMes: 4, endMes: 5 },
  { key: "margem", nome: "Ganho de margem", startMes: 6, endMes: 12 },
  { key: "alavancagem", nome: "Alavancagem · ciclos", startMes: 12, endMes: 18 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function num(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Ease cosseno de queda: 0→1 com derivada nula nas pontas. */
function cosFall(u: number): number {
  return (1 - Math.cos(Math.PI * clamp(u, 0, 1))) / 2;
}

/** Ease cosseno de subida: 1→0 com derivada nula nas pontas. */
function cosRise(u: number): number {
  return (1 + Math.cos(Math.PI * clamp(u, 0, 1))) / 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formas canônicas normalizadas (independentes da escala)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Caixa normalizado: 0 (mês 1) → −1 (fundo, mês 4) → 0 (break-even, mês 5) →
 * +1 (mês 12) → ondas crescentes (~1.55, mês 18). O ramo negativo é escalado
 * pela profundidade real; o positivo pela margem real — contínuos no 0.
 */
function caixaNorm(m: number): number {
  if (m <= BOTTOM_MES) {
    const u = (m - 1) / (BOTTOM_MES - 1);
    return -cosFall(u); // 0 → −1
  }
  if (m <= BREAKEVEN_MES) {
    const u = (m - BOTTOM_MES) / (BREAKEVEN_MES - BOTTOM_MES);
    return -cosRise(u); // −1 → 0
  }
  if (m <= MARGEM_END_MES) {
    const u = (m - BREAKEVEN_MES) / (MARGEM_END_MES - BREAKEVEN_MES);
    return Math.sin((Math.PI / 2) * u); // 0 → 1
  }
  const u = (m - MARGEM_END_MES) / (TIMELINE_MONTHS - MARGEM_END_MES);
  const base = 1 + 0.55 * u; // tendência de alta
  const ripple = 0.1 * u * Math.sin((2 * Math.PI * (m - MARGEM_END_MES)) / 3);
  return base + ripple; // ondas crescentes
}

/**
 * Investimento normalizado: monotônico não-decrescente, rampa suave 1→~2 até o
 * mês 12 e degrau mais íngreme nos ciclos (12+). Sempre >= 0.
 */
function investNorm(m: number): number {
  const baseRamp = 1 + 0.09 * (m - 1);
  const cycleBoost = m > MARGEM_END_MES ? 0.25 * (m - MARGEM_END_MES) : 0;
  return baseRamp + cycleBoost;
}

/**
 * ROI normalizado: −1 (mês 1) → 0 (break-even, mês 5, MESMO mês do caixa) →
 * +1 (mês 12) → oscila em alta nos ciclos. Ramo negativo escalado pelo piso
 * (−100%); positivo pelo pico ancorado na margem-sobre-custo.
 */
function roiNorm(m: number): number {
  if (m <= BREAKEVEN_MES) {
    const u = (m - 1) / (BREAKEVEN_MES - 1);
    return -cosRise(u); // −1 → 0
  }
  if (m <= MARGEM_END_MES) {
    const u = (m - BREAKEVEN_MES) / (MARGEM_END_MES - BREAKEVEN_MES);
    return Math.sin((Math.PI / 2) * u); // 0 → 1
  }
  const u = (m - MARGEM_END_MES) / (TIMELINE_MONTHS - MARGEM_END_MES);
  const base = 1 + 0.35 * u;
  const ripple = 0.14 * u * Math.sin((2 * Math.PI * (m - MARGEM_END_MES)) / 2.5);
  return base + ripple;
}

// ─────────────────────────────────────────────────────────────────────────────
// Marcador — posição derivada do CAC atual vs bandas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `markerMes` a partir do CAC atual vs bandas (DESIGN §5):
 *   - cacAtual indefinido / bandas indefinidas → `null` (sem marcador).
 *   - cacAtual > máximo → meses [1, 4]: mapeia [máx, 2×máx] → [4, 1] (clamp).
 *   - cacAtual ≤ mínimo → mês 12.
 *   - entre máx e mín → 4 + (máx − cac)/(máx − mín) × 8, clamp [4, 12].
 *
 * Ex. Milennials (cac 3421,125; máx 5153,75; mín 1288,4375) → ≈ 7,59.
 */
export function computeMarkerMes(
  cacAtual: number | null,
  cacMaximo: number | null,
  cacMinimo: number | null,
): number | null {
  if (cacAtual === null || cacMaximo === null || cacMinimo === null) return null;
  if (!Number.isFinite(cacAtual) || cacMaximo <= cacMinimo) return null;

  if (cacAtual > cacMaximo) {
    // Quão acima do teto: 0 no teto, 1 em 2×teto (ou mais).
    const frac = clamp((cacAtual - cacMaximo) / cacMaximo, 0, 1);
    return clamp(4 - frac * 3, 1, 4);
  }
  if (cacAtual <= cacMinimo) return 12;

  const m = 4 + ((cacMaximo - cacAtual) / (cacMaximo - cacMinimo)) * 8;
  return clamp(m, 4, 12);
}

/** Fase em que um mês (fracionário) cai. Marcador nunca passa de 12 → nunca alavancagem. */
export function phaseKeyAtMes(mes: number): PhaseKey {
  if (mes < 4) return "prejuizo";
  if (mes < 6) return "breakeven";
  if (mes <= 12) return "margem";
  return "alavancagem";
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder principal
// ─────────────────────────────────────────────────────────────────────────────

export function computeEconomicsTimeline(
  inputs: UnitEconomicsInputs,
): EconomicsTimeline {
  const numVendas = num(inputs.numVendas);
  const anuncios = num(inputs.anuncios);

  const { faturamento, despesasTotais, cacAtual } = computeCac(inputs);
  const bands = cacBands(inputs.ticketMedio);

  const marginMensal = faturamento - despesasTotais;
  const investMensal = Math.max(anuncios, 0);

  // ── Escalas reais (ancoragens), com pisos defensivos p/ a forma nunca sumir ──
  const burnMensal = Math.abs(despesasTotais);
  // Profundidade = investimento/burn acumulado no período de prejuízo (até o fundo).
  const depthAnchor = Math.max(burnMensal, Math.abs(anuncios), 1);
  const depthReais = depthAnchor * BOTTOM_MES;
  // Subida ancorada na margem mensal; piso relativo à profundidade p/ recuperar
  // visualmente mesmo quando a margem real é ínfima (forma canônica garantida).
  const riseReais = Math.max(
    Math.abs(marginMensal) * RISE_REF_MONTHS,
    depthReais * 0.8,
  );

  // ROI %: piso canônico −100% no mês 1; pico ancorado na margem-sobre-custo real.
  const roiMarginPct = burnMensal > 0 ? (marginMensal / burnMensal) * 100 : 0;
  const roiPeakPct = clamp(Math.abs(roiMarginPct) * 3, 60, 400);
  const roiFloorMag = 100;

  // ── Séries (meses 1..N) ──
  const months: number[] = [];
  const caixa: TimelinePoint[] = [];
  const investimento: TimelinePoint[] = [];
  const roi: TimelinePoint[] = [];

  for (let m = 1; m <= TIMELINE_MONTHS; m++) {
    months.push(m);

    const cN = caixaNorm(m);
    const caixaValor = cN >= 0 ? cN * riseReais : cN * depthReais;
    caixa.push({ mes: m, valor: caixaValor === 0 ? 0 : caixaValor });

    investimento.push({ mes: m, valor: investMensal * investNorm(m) });

    const rN = roiNorm(m);
    const roiValor = rN >= 0 ? rN * roiPeakPct : rN * roiFloorMag;
    roi.push({ mes: m, valor: roiValor === 0 ? 0 : roiValor });
  }

  // ── Eixos com zero compartilhado ──
  const axis = buildSharedZeroAxis(caixa, investimento, roi);

  // ── Marcador ──
  const markerMes = computeMarkerMes(cacAtual, bands.cacMaximo, bands.cacMinimo);
  const markerPhaseKey = markerMes !== null ? phaseKeyAtMes(markerMes) : null;

  return {
    defined: numVendas > 0,
    months,
    caixa,
    investimento,
    roi,
    phases: PHASES.map((p) => ({ ...p })),
    markerMes,
    markerPhaseKey,
    axis,
    meta: {
      cacAtual,
      cacMaximo: bands.cacMaximo,
      cacMinimo: bands.cacMinimo,
      marginMensal,
      investMensal,
    },
  };
}

/**
 * Domínios dos eixos R$ (caixa+investimento) e ROI(%) com o ZERO no MESMO pixel.
 *
 * O eixo R$ define a fração da altura acima do zero `f = reaisMax/(reaisMax −
 * reaisMin)`. O eixo ROI então recebe um span S tal que sua fração positiva seja
 * exatamente `f` — garantindo `syReais(0) === syRoi(0)` para QUALQUER dimensão de
 * plot (a UI não precisa refazer a conta).
 */
function buildSharedZeroAxis(
  caixa: TimelinePoint[],
  investimento: TimelinePoint[],
  roi: TimelinePoint[],
): TimelineAxis {
  const reaisVals = [
    ...caixa.map((p) => p.valor),
    ...investimento.map((p) => p.valor),
    0,
  ];
  let reaisMinData = Math.min(...reaisVals);
  let reaisMaxData = Math.max(...reaisVals);
  if (reaisMinData === reaisMaxData) {
    reaisMinData = -1;
    reaisMaxData = 1;
  }
  const reaisSpan = reaisMaxData - reaisMinData || 1;
  const reaisPad = reaisSpan * 0.08;
  const reaisMin = reaisMinData - reaisPad;
  const reaisMax = reaisMaxData + reaisPad;

  // Fração da altura acima do zero (determinada pelo eixo protagonista, R$).
  const f = clamp(reaisMax / (reaisMax - reaisMin), 0.05, 0.95);

  const roiVals = roi.map((p) => p.valor);
  const roiMaxData = Math.max(...roiVals, 0);
  const roiMinData = Math.min(...roiVals, 0);
  const roiPosNeed = Math.max(roiMaxData, 1) * 1.08;
  const roiNegNeed = Math.max(-roiMinData, 1) * 1.08;
  // S grande o suficiente p/ caber ambos os extremos mantendo a fração `f`.
  const S = Math.max(roiPosNeed / f, roiNegNeed / (1 - f));
  const roiMax = f * S;
  const roiMin = -(1 - f) * S;

  return { reaisMin, reaisMax, roiMin, roiMax };
}
