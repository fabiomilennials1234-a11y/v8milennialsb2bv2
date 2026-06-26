/**
 * Unit economics — pure, side-effect-free CAC / Payback engine (MASTER ferramenta).
 *
 * Toda a matemática da ferramenta master de unit economics vive aqui. ZERO I/O,
 * ZERO React, 100% determinístico e unit-testável. A UI (outro agente) consome
 * cada sub-cálculo para exibir os termos intermediários auditáveis.
 *
 * Fórmulas canônicas (confirmadas pelo CTO):
 *   faturamento     = ticketMedio * numVendas
 *   impostoValor    = (impostoPct/100) * faturamento
 *   adminValor      = (adminPct/100) * faturamento
 *   despesasTotais  = anuncios + embalagem + frete + impostoValor + adminValor
 *   cacMaximo       = despesasTotais / numVendas      // o CAC calculado É o teto
 *   cacIdeal        = cacMaximo / 2
 *   cacMinimo       = cacIdeal / 2
 *   margemPorVenda  = ticketMedio - cacMaximo
 *   payback1        = cacMaximo / margemPorVenda       // nº de compras p/ recuperar CAC
 *   ltv             = ticketMedio * recompras
 *   margemComLtv    = ltv - cacMaximo
 *   payback2        = cacMaximo / margemComLtv          // nº de compras (com LTV)
 *
 * Contrato defensivo: divisões guardadas (retornam `null`, nunca `NaN`/`Infinity`);
 * inputs não-finitos são coeridos a 0; cenários impossíveis (numVendas=0,
 * margem<=0) retornam `null` + flag, nunca um número mentiroso.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export interface UnitEconomicsInputs {
  /** Ticket médio por venda (R$). */
  ticketMedio: number;
  /** Número de vendas no período. CAC é indefinido quando <= 0. */
  numVendas: number;
  /** Investimento em anúncios (R$). */
  anuncios: number;
  /** Custo de embalagem (R$). */
  embalagem: number;
  /** Custo de frete (R$). */
  frete: number;
  /** Imposto como % do faturamento (ex.: 10 = 10%). */
  impostoPct: number;
  /** Custo administrativo como % do faturamento (ex.: 5 = 5%). */
  adminPct: number;
  /** Nº médio de recompras por cliente (alimenta LTV). */
  recompras: number;
  /** Horizonte da curva de payback em meses (default 12, clamp 3..120). */
  horizonteMeses?: number;
}

export interface CacResult {
  faturamento: number;
  impostoValor: number;
  adminValor: number;
  despesasTotais: number;
  /** `null` quando numVendas <= 0 (CAC indefinido). */
  cacMaximo: number | null;
}

export interface CacBands {
  cacMaximo: number | null;
  cacIdeal: number | null;
  cacMinimo: number | null;
}

export interface PaybackResult {
  /** `null` quando CAC é indefinido. Pode ser negativo (negócio no prejuízo). */
  margemPorVenda: number | null;
  /** Nº de compras p/ recuperar o CAC. `null` quando margemPorVenda <= 0. */
  payback1: number | null;
  payback1Possivel: boolean;
  /** ltv = ticketMedio * recompras. Sempre computável (>= 0). */
  ltv: number;
  /** ltv - cacMaximo. `null` quando CAC é indefinido. */
  margemComLtv: number | null;
  /** Nº de compras p/ recuperar o CAC considerando LTV. `null` se margemComLtv <= 0. */
  payback2: number | null;
  payback2Possivel: boolean;
}

export interface PaybackCurveMarks {
  /** Fundo da curva (maior caixa consumido, <= 0). `null` se indefinido. */
  maxCashConsumed: number | null;
  /** Mês do fundo. */
  maxCashMes: number | null;
  /** Mês em que o caixa acumulado cruza 0 (break-even). `null` se não cruza no horizonte. */
  breakEvenMes: number | null;
  /** Mês em que o fluxo mensal vira >= 0 (negócio se auto-financia). `null` se nunca. */
  selfFundingMes: number | null;
  horizonteMeses: number;
}

export interface PaybackCurvePoint {
  mes: number;
  valor: number;
}

export interface PaybackCurveResult {
  /** `false` quando o modelo é indefinido (numVendas <= 0) — sem curva. */
  defined: boolean;
  /** Pontos {mes, valor} (mês 0..horizonte) da curva canônica em J. */
  points: PaybackCurvePoint[];
  marks: PaybackCurveMarks;
  /** Parâmetros do modelo mensal subjacente (auditáveis pela UI). */
  model: {
    investimentoMensal: number | null;
    retornoMensalPleno: number | null;
    rampMeses: number;
  };
}

export interface UnitEconomics {
  cac: CacResult;
  bands: CacBands;
  paybacks: PaybackResult;
  curve: PaybackCurveResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers defensivos
// ─────────────────────────────────────────────────────────────────────────────

/** Coerge qualquer entrada a um número finito (não-finito → 0). */
function num(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Divisão guardada: retorna `null` em vez de NaN/Infinity. */
function safeDiv(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  const r = a / b;
  return Number.isFinite(r) ? r : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-cálculos (exportados para a UI exibir termos auditáveis)
// ─────────────────────────────────────────────────────────────────────────────

export function computeCac(inputs: UnitEconomicsInputs): CacResult {
  const ticketMedio = num(inputs.ticketMedio);
  const numVendas = num(inputs.numVendas);
  const anuncios = num(inputs.anuncios);
  const embalagem = num(inputs.embalagem);
  const frete = num(inputs.frete);
  const impostoPct = num(inputs.impostoPct);
  const adminPct = num(inputs.adminPct);

  const faturamento = ticketMedio * numVendas;
  const impostoValor = (impostoPct / 100) * faturamento;
  const adminValor = (adminPct / 100) * faturamento;
  const despesasTotais = anuncios + embalagem + frete + impostoValor + adminValor;

  // O CAC calculado É o máximo (teto): despesas totais rateadas por venda.
  const cacMaximo = numVendas > 0 ? safeDiv(despesasTotais, numVendas) : null;

  return { faturamento, impostoValor, adminValor, despesasTotais, cacMaximo };
}

export function cacBands(cacMaximo: number | null): CacBands {
  if (cacMaximo === null) {
    return { cacMaximo: null, cacIdeal: null, cacMinimo: null };
  }
  const cacIdeal = cacMaximo / 2;
  const cacMinimo = cacIdeal / 2;
  return { cacMaximo, cacIdeal, cacMinimo };
}

export function computeLtv(inputs: UnitEconomicsInputs): number {
  return num(inputs.ticketMedio) * num(inputs.recompras);
}

export function computePaybacks(inputs: UnitEconomicsInputs): PaybackResult {
  const ticketMedio = num(inputs.ticketMedio);
  const { cacMaximo } = computeCac(inputs);
  const ltv = computeLtv(inputs);

  const margemPorVenda = cacMaximo === null ? null : ticketMedio - cacMaximo;

  // Payback só é possível se cada venda gera margem positiva.
  const payback1 =
    cacMaximo !== null && margemPorVenda !== null && margemPorVenda > 0
      ? safeDiv(cacMaximo, margemPorVenda)
      : null;

  const margemComLtv = cacMaximo === null ? null : ltv - cacMaximo;

  const payback2 =
    cacMaximo !== null && margemComLtv !== null && margemComLtv > 0
      ? safeDiv(cacMaximo, margemComLtv)
      : null;

  return {
    margemPorVenda,
    payback1,
    payback1Possivel: payback1 !== null,
    ltv,
    margemComLtv,
    payback2,
    payback2Possivel: payback2 !== null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Curva de payback em J — "ilustrativa ancorada"
// ─────────────────────────────────────────────────────────────────────────────
//
// MODELO (mensal, simples, ancorado nos números reais):
//
//   investimentoMensal  = despesasTotais                  // run-rate de gasto/mês
//   retornoMensalPleno  = numVendas * margemPorVenda        // margem/mês a plena maturação
//
// A monetização de uma coorte NÃO é instantânea: a margem de cada venda se
// realiza ao longo do ciclo de recompra. Modelamos isso com uma rampa de
// maturação `matur(t) = min(t / rampMeses, 1)` — os primeiros meses são
// dominados pelo investimento (o caixa MERGULHA: o fundo do J), e conforme a
// base madura os retornos superam o investimento (o caixa SOBE: a recuperação).
//   rampMeses tem proxy em `recompras` (mais recompras = cauda de monetização
//   mais longa), clampado a [2, horizonte].
//
//   fluxo(t)         = retornoMensalPleno * matur(t) - investimentoMensal
//   caixaAcumulado(t)= Σ_{i=1..t} fluxo(i)
//
// Marcos lidos da série REAL:
//   maxCashConsumed = min(caixaAcumulado)        // o fundo do J (<= 0)
//   breakEvenMes    = t onde caixaAcumulado cruza 0 (interpolado)
//   selfFundingMes  = t onde fluxo(t) >= 0        // mês que o negócio se banca
//
// A série real já é um J limpo (fluxo monotônico crescente → único mínimo). Mas,
// para o VISUAL, geramos uma curva canônica suave (cosseno) ANCORADA na
// profundidade real (maxCashConsumed) e no timing real (breakEvenMes), passando
// por (0,0) → fundo em ~breakEven/2 → 0 em breakEvenMes → sobe até o pico real.
// O shape importa pro encantamento; os marcos e a profundidade são reais.

export function computePaybackCurve(inputs: UnitEconomicsInputs): PaybackCurveResult {
  const numVendas = num(inputs.numVendas);
  const recompras = num(inputs.recompras);
  // undefined/null → default 12; um valor explícito (inclusive 0) é clampado a [3,120].
  const horizonteRaw = inputs.horizonteMeses == null ? 12 : num(inputs.horizonteMeses);
  const horizonte = clamp(Math.round(horizonteRaw), 3, 120);

  const { cacMaximo, despesasTotais } = computeCac(inputs);
  const { margemPorVenda } = computePaybacks(inputs);

  const emptyMarks: PaybackCurveMarks = {
    maxCashConsumed: null,
    maxCashMes: null,
    breakEvenMes: null,
    selfFundingMes: null,
    horizonteMeses: horizonte,
  };

  // CAC indefinido (numVendas <= 0) → nada a modelar.
  if (cacMaximo === null || margemPorVenda === null) {
    return {
      defined: false,
      points: [],
      marks: emptyMarks,
      model: { investimentoMensal: null, retornoMensalPleno: null, rampMeses: 0 },
    };
  }

  const investimentoMensal = despesasTotais;
  const retornoMensalPleno = numVendas * margemPorVenda;
  const rampMeses = clamp(Math.round(recompras) || 2, 2, horizonte);

  // ── (a) Série mensal real ──
  const series: number[] = [0];
  const fluxo: number[] = [0];
  let caixa = 0;
  let selfFundingMes: number | null = null;
  for (let t = 1; t <= horizonte; t++) {
    const matur = Math.min(t / rampMeses, 1);
    const retorno = retornoMensalPleno * matur;
    const f = retorno - investimentoMensal;
    if (selfFundingMes === null && f >= 0) selfFundingMes = t;
    caixa += f;
    series.push(caixa);
    fluxo.push(f);
  }

  // Fundo do J = mínimo global da série.
  let maxCashConsumed = series[0];
  let maxCashMes = 0;
  for (let t = 0; t <= horizonte; t++) {
    if (series[t] < maxCashConsumed) {
      maxCashConsumed = series[t];
      maxCashMes = t;
    }
  }

  // Break-even = 1º mês (após mergulhar) com caixa >= 0, interpolado linearmente.
  let breakEvenMes: number | null = null;
  for (let t = 1; t <= horizonte; t++) {
    if (series[t - 1] < 0 && series[t] >= 0) {
      const span = series[t] - series[t - 1];
      const frac = span !== 0 ? -series[t - 1] / span : 0;
      breakEvenMes = t - 1 + clamp(frac, 0, 1);
      break;
    }
  }

  const marks: PaybackCurveMarks = {
    maxCashConsumed,
    maxCashMes,
    breakEvenMes,
    selfFundingMes,
    horizonteMeses: horizonte,
  };

  // ── (b) Curva canônica em J (visual), ancorada nos marcos reais ──
  const depth = Math.min(maxCashConsumed, 0); // <= 0
  const peak = Math.max(series[horizonte], 0); // pico real no fim do horizonte
  const points = buildCanonicalJ(horizonte, depth, breakEvenMes, peak);

  return {
    defined: true,
    points,
    marks,
    model: { investimentoMensal, retornoMensalPleno, rampMeses },
  };
}

/**
 * Gera a curva canônica em J por segmentos suaves (cosseno), mês 0..horizonte.
 *
 *   [0, bottomMes]          desce  0 → depth        (ease cosseno)
 *   [bottomMes, breakEven]  sobe   depth → 0        (ease cosseno)
 *   [breakEven, horizonte]  sobe   0 → peak         (ease seno)
 *
 * Sem break-even no horizonte → braço único descendente (0 → depth no fim): o
 * negócio nunca se paga na janela. bottomMes ancora em ~breakEven/2 (spec).
 */
function buildCanonicalJ(
  horizonte: number,
  depth: number,
  breakEvenMes: number | null,
  peak: number,
): PaybackCurvePoint[] {
  const be = breakEvenMes;
  const bottomMes = be !== null ? clamp(be / 2, 0.5, horizonte) : horizonte;

  // ease cosseno: 0→1 (queda) e 1→0 (subida) com derivada nula nas pontas.
  const cosFall = (u: number) => (1 - Math.cos(Math.PI * clamp(u, 0, 1))) / 2;
  const cosRise = (u: number) => (1 + Math.cos(Math.PI * clamp(u, 0, 1))) / 2;

  const points: PaybackCurvePoint[] = [];
  for (let t = 0; t <= horizonte; t++) {
    let valor: number;
    if (t <= bottomMes) {
      valor = depth * cosFall(bottomMes === 0 ? 1 : t / bottomMes);
    } else if (be !== null && t <= be) {
      const denom = be - bottomMes || 1;
      valor = depth * cosRise((t - bottomMes) / denom);
    } else if (be !== null) {
      const denom = horizonte - be || 1;
      const u = clamp((t - be) / denom, 0, 1);
      valor = peak * Math.sin((Math.PI / 2) * u);
    } else {
      // sem break-even: mantém no fundo após o braço descendente
      valor = depth;
    }
    // Normaliza -0 → 0 (depth * 0 produz -0 quando depth < 0).
    points.push({ mes: t, valor: valor === 0 ? 0 : valor });
  }
  return points;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agregador de conveniência
// ─────────────────────────────────────────────────────────────────────────────

/** Computa tudo de uma vez. Cada sub-resultado também é exportado isoladamente. */
export function computeUnitEconomics(inputs: UnitEconomicsInputs): UnitEconomics {
  const cac = computeCac(inputs);
  return {
    cac,
    bands: cacBands(cac.cacMaximo),
    paybacks: computePaybacks(inputs),
    curve: computePaybackCurve(inputs),
  };
}
