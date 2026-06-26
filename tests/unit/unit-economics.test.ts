import { describe, it, expect } from "vitest";
import {
  computeCac,
  cacBands,
  computeLtv,
  computePaybacks,
  computePaybackCurve,
  computeUnitEconomics,
  type UnitEconomicsInputs,
} from "../../src/modules/identity/master/lib/unit-economics";

// Caso base com números redondos para asserts exatos (modelo da planilha):
//   faturamento     = 100 * 10 = 1000
//   impostoValor    = 0.10 * 1000 = 100
//   adminValor      = 0.05 * 1000 = 50
//   comissaoValor   = 0.00 * 1000 = 0          (comissaoPct = 0 → neutro no base)
//   despesasTotais  = 200 + 50 + 50 + 100 + 50 + 0 = 450
//   cacAtual        = anuncios / vendas = 200 / 10 = 20   (CAC REAL — a agulha = aquisição)
//   custoNaoAquisic = despesasTotais − anuncios = 250
//   cacMaximo       = custoNaoAquisic / vendas = 250 / 10 = 25  (= Ticket − Lucro Líquido)
//   cacIdeal (Bom)  = 25 / 2 = 12,5
//   cacMinimo(Escala)= 25 / 3 ≈ 8,3333
//   margemPorVenda  = 100 − 20 = 80            (ancora o payback, separado do teto)
//   ltv             = 100 * 3 = 300
//   margemComLtv    = 300 − 20 = 280
function makeInput(overrides: Partial<UnitEconomicsInputs> = {}): UnitEconomicsInputs {
  return {
    ticketMedio: 100,
    numVendas: 10,
    anuncios: 200,
    embalagem: 50,
    frete: 50,
    impostoPct: 10,
    adminPct: 5,
    comissaoPct: 0,
    recompras: 3,
    horizonteMeses: 12,
    ...overrides,
  };
}

// Caso GOLDEN da planilha do CTO (espelho fiel dos números apresentados):
//   Ticket 2.000 · 2 vendas · investido (anúncios) 2.000 · custos não-aquisição 2.400
//   → CAC atual 1.000 · Máximo 1.200 · Bom 600 · Escala 400 · Lucro Líquido 800
function planilhaInput(): UnitEconomicsInputs {
  return {
    ticketMedio: 2000,
    numVendas: 2,
    anuncios: 2000, // "Valor investido" → CAC atual = 2000/2 = 1000
    embalagem: 1200, // Custo do Ticket (COGS) total: 600/venda × 2
    frete: 0,
    impostoPct: 0,
    adminPct: 30, // Despesas (opex): 0,30 × 4000 = 1200
    comissaoPct: 0,
    recompras: 0,
    horizonteMeses: 12,
  };
}

describe("computeCac", () => {
  it("computa faturamento, impostos, admin, despesas e CAC atual (= anúncios/vendas)", () => {
    const r = computeCac(makeInput());
    expect(r.faturamento).toBe(1000);
    expect(r.impostoValor).toBe(100);
    expect(r.adminValor).toBe(50);
    expect(r.comissaoValor).toBe(0); // comissaoPct = 0 (default base) → termo neutro
    expect(r.despesasTotais).toBe(450);
    expect(r.cacAtual).toBe(20); // anúncios 200 / 10 vendas
  });

  it("comissaoPct entra em despesasTotais (→ teto), NÃO no CAC atual (que é só anúncios)", () => {
    // comissaoPct 10 → comissaoValor = 0.10 * 1000 = 100
    // despesasTotais = 200 + 50 + 50 + 100 + 50 + 100 = 550 (sobe o custo não-aquisição → teto)
    // cacAtual permanece 20 (anúncios/vendas inalterado)
    const r = computeCac(makeInput({ comissaoPct: 10 }));
    expect(r.comissaoValor).toBe(100);
    expect(r.despesasTotais).toBe(550);
    expect(r.cacAtual).toBe(20);
  });

  it("comissaoPct = 0 é neutro (não altera despesas vs. ausência da comissão)", () => {
    const semComissao = computeCac(makeInput({ comissaoPct: 0 }));
    expect(semComissao.comissaoValor).toBe(0);
    expect(semComissao.despesasTotais).toBe(450);
    expect(semComissao.cacAtual).toBe(20);
  });

  it("numVendas = 0 → CAC atual indefinido (null, não NaN/Infinity)", () => {
    const r = computeCac(makeInput({ numVendas: 0 }));
    expect(r.faturamento).toBe(0);
    expect(r.despesasTotais).toBe(300); // 200+50+50, impostos/admin = 0
    expect(r.cacAtual).toBeNull();
  });

  it("numVendas negativo → CAC atual indefinido (null)", () => {
    const r = computeCac(makeInput({ numVendas: -5 }));
    expect(r.cacAtual).toBeNull();
  });

  it("inputs não-finitos são coeridos a 0 (sem NaN)", () => {
    const r = computeCac(
      makeInput({
        anuncios: NaN as unknown as number,
        frete: Infinity as unknown as number,
        comissaoPct: NaN as unknown as number,
      }),
    );
    expect(Number.isFinite(r.despesasTotais)).toBe(true);
    expect(Number.isFinite(r.cacAtual as number)).toBe(true);
    expect(r.cacAtual).toBe(0); // anúncios não-finito → coerido a 0 → 0/10 = 0
    expect(r.comissaoValor).toBe(0); // comissaoPct não-finito → coerido a 0
  });

  it("valores negativos fluem mas mantêm finitude", () => {
    const r = computeCac(makeInput({ anuncios: -1000 }));
    expect(Number.isFinite(r.despesasTotais)).toBe(true);
    expect(r.despesasTotais).toBe(-750); // -1000+50+50+100+50
    expect(r.cacAtual).toBe(-100); // anúncios -1000 / 10 vendas
  });

  it("CAC atual (aquisição) PODE ultrapassar o teto → zona vermelha", () => {
    // anuncios 900 → cacAtual 90. Teto = custos não-aquisição/venda.
    // despesasTotais 1150; nonAd = 1150 − 900 = 250 → cacMaximo 25.
    // cacAtual 90 > cacMaximo 25 → agulha na zona vermelha (aquisição > teto).
    const input = makeInput({ anuncios: 900 });
    const r = computeCac(input);
    expect(r.despesasTotais).toBe(1150);
    expect(r.cacAtual).toBe(90);
    const b = cacBands(input);
    expect(b.cacMaximo).toBe(25);
    expect(r.cacAtual! > (b.cacMaximo as number)).toBe(true);
  });
});

describe("cacBands (Ticket − Lucro Líquido)", () => {
  it("máx = custos não-aquisição/venda; Bom = máx/2; Escala = máx/3", () => {
    const b = cacBands(makeInput());
    expect(b.cacMaximo).toBe(25); // nonAd 250 / 10 vendas
    expect(b.cacIdeal).toBe(12.5); // máx/2
    expect(b.cacMinimo).toBeCloseTo(25 / 3, 10); // máx/3 (Escala)
    expect(b.cacIdeal).toBe((b.cacMaximo as number) / 2);
    expect(b.cacMinimo).toBeCloseTo((b.cacMaximo as number) / 3, 10);
  });

  it("GOLDEN planilha do CTO: ticket 2.000 → Máx 1.200 / Bom 600 / Escala 400", () => {
    const b = cacBands(planilhaInput());
    expect(b.cacMaximo).toBe(1200); // = Ticket 2000 − Lucro Líquido 800
    expect(b.cacIdeal).toBe(600);
    expect(b.cacMinimo).toBe(400);
  });

  it("ticket <= 0 → bandas indefinidas (null)", () => {
    const b0 = cacBands(makeInput({ ticketMedio: 0 }));
    expect(b0).toEqual({ cacMaximo: null, cacIdeal: null, cacMinimo: null });
    const bNeg = cacBands(makeInput({ ticketMedio: -100 }));
    expect(bNeg).toEqual({ cacMaximo: null, cacIdeal: null, cacMinimo: null });
  });

  it("numVendas <= 0 → bandas indefinidas (sem rateio por venda → null)", () => {
    expect(cacBands(makeInput({ numVendas: 0 }))).toEqual({
      cacMaximo: null,
      cacIdeal: null,
      cacMinimo: null,
    });
  });

  it("ticket não-finito → bandas indefinidas (coerção defensiva → null)", () => {
    expect(cacBands(makeInput({ ticketMedio: NaN as unknown as number }))).toEqual({
      cacMaximo: null,
      cacIdeal: null,
      cacMinimo: null,
    });
  });
});

describe("computeLtv", () => {
  it("ltv = ticketMedio * recompras", () => {
    expect(computeLtv(makeInput())).toBe(300);
  });

  it("recompras = 0 → ltv = 0", () => {
    expect(computeLtv(makeInput({ recompras: 0 }))).toBe(0);
  });
});

describe("computePaybacks", () => {
  it("margem, payback1, ltv, margemComLtv, payback2 no caso saudável", () => {
    const p = computePaybacks(makeInput());
    expect(p.margemPorVenda).toBe(80); // ticket 100 − cacAtual 20
    expect(p.payback1).toBeCloseTo(20 / 80, 10);
    expect(p.payback1Possivel).toBe(true);
    expect(p.ltv).toBe(300);
    expect(p.margemComLtv).toBe(280); // 300 − 20
    expect(p.payback2).toBeCloseTo(20 / 280, 10);
    expect(p.payback2Possivel).toBe(true);
  });

  it("margemPorVenda <= 0 → payback1 impossível (null + flag)", () => {
    // ticket 10 < cacAtual 20 (anúncios/vendas) → margem 10−20 = −10
    const p = computePaybacks(makeInput({ ticketMedio: 10 }));
    expect(p.margemPorVenda).toBe(-10);
    expect(p.payback1).toBeNull();
    expect(p.payback1Possivel).toBe(false);
  });

  it("margemComLtv <= 0 → payback2 impossível (null + flag)", () => {
    // ticket 10, recompras 1 → ltv 10, cacAtual 20 → margemComLtv 10−20 = −10
    const p = computePaybacks(makeInput({ ticketMedio: 10, recompras: 1 }));
    expect(p.margemComLtv).toBe(-10);
    expect(p.payback2).toBeNull();
    expect(p.payback2Possivel).toBe(false);
  });

  it("recompras = 0 → ltv 0, margemComLtv = -cacAtual, payback2 impossível", () => {
    const p = computePaybacks(makeInput({ recompras: 0 }));
    expect(p.ltv).toBe(0);
    expect(p.margemComLtv).toBe(-20); // 0 − cacAtual 20
    expect(p.payback2).toBeNull();
    expect(p.payback2Possivel).toBe(false);
    // payback1 ainda válido (margem por venda positiva)
    expect(p.payback1Possivel).toBe(true);
  });

  it("numVendas = 0 → tudo dependente de CAC vira null", () => {
    const p = computePaybacks(makeInput({ numVendas: 0 }));
    expect(p.margemPorVenda).toBeNull();
    expect(p.payback1).toBeNull();
    expect(p.margemComLtv).toBeNull();
    expect(p.payback2).toBeNull();
  });

  it("payback é ancorado no CAC ATUAL (aquisição), não no teto", () => {
    const input = makeInput();
    const { cacAtual } = computeCac(input);
    const p = computePaybacks(input);
    expect(cacAtual).toBe(20);
    expect(p.payback1).toBeCloseTo((cacAtual as number) / (p.margemPorVenda as number), 10);
    expect(p.payback2).toBeCloseTo((cacAtual as number) / (p.margemComLtv as number), 10);
  });
});

describe("computePaybackCurve — caso saudável (J completo)", () => {
  const curve = computePaybackCurve(makeInput());
  const valores = curve.points.map((p) => p.valor);
  const meses = curve.points.map((p) => p.mes);

  it("é definido e expõe os parâmetros do modelo", () => {
    expect(curve.defined).toBe(true);
    expect(curve.model.investimentoMensal).toBe(450); // despesasTotais
    expect(curve.model.retornoMensalPleno).toBe(800); // 10 vendas * margem 80
    expect(curve.model.rampMeses).toBe(3); // round(recompras)=3
  });

  it("gera horizonte+1 pontos (mês 0..12) em ordem", () => {
    expect(curve.points).toHaveLength(13);
    expect(meses).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("começa na origem (0,0)", () => {
    expect(curve.points[0]).toEqual({ mes: 0, valor: 0 });
  });

  it("tem fundo negativo (mergulho do J)", () => {
    expect(Math.min(...valores)).toBeLessThan(0);
  });

  it("o fundo do shape fica em ~breakEven/2", () => {
    const be = curve.marks.breakEvenMes as number;
    expect(be).toBeGreaterThan(0);
    let idxMin = 0;
    for (let i = 1; i < valores.length; i++) {
      if (valores[i] < valores[idxMin]) idxMin = i;
    }
    expect(Math.abs(idxMin - Math.round(be / 2))).toBeLessThanOrEqual(1);
  });

  it("cruza ~0 no breakEvenMes", () => {
    const be = curve.marks.breakEvenMes as number;
    const depth = Math.abs(curve.marks.maxCashConsumed as number);
    const valNoBreak = curve.points[Math.round(be)].valor;
    expect(Math.abs(valNoBreak)).toBeLessThan(depth * 0.35);
  });

  it("shape é monotônico em J: desce até o fundo, depois sobe", () => {
    let idxMin = 0;
    for (let i = 1; i < valores.length; i++) {
      if (valores[i] < valores[idxMin]) idxMin = i;
    }
    for (let i = 1; i <= idxMin; i++) {
      expect(valores[i]).toBeLessThanOrEqual(valores[i - 1] + 1e-9);
    }
    for (let i = idxMin + 1; i < valores.length; i++) {
      expect(valores[i]).toBeGreaterThanOrEqual(valores[i - 1] - 1e-9);
    }
  });

  it("termina no lucro (período de profit)", () => {
    expect(valores[valores.length - 1]).toBeGreaterThan(0);
  });

  it("marcos reais: maxCashConsumed < 0 e selfFundingMes definido", () => {
    expect(curve.marks.maxCashConsumed as number).toBeLessThan(0);
    expect(curve.marks.maxCashMes).not.toBeNull();
    expect(curve.marks.breakEvenMes).not.toBeNull();
    expect(curve.marks.selfFundingMes).not.toBeNull();
    expect(curve.marks.horizonteMeses).toBe(12);
  });
});

describe("computePaybackCurve — edge cases", () => {
  it("numVendas = 0 → curva indefinida (sem pontos)", () => {
    const curve = computePaybackCurve(makeInput({ numVendas: 0 }));
    expect(curve.defined).toBe(false);
    expect(curve.points).toHaveLength(0);
    expect(curve.marks.maxCashConsumed).toBeNull();
    expect(curve.marks.breakEvenMes).toBeNull();
    expect(curve.model.investimentoMensal).toBeNull();
  });

  it("margemPorVenda <= 0 → sem break-even, curva só desce e termina negativa", () => {
    // ticket 10 < cacAtual 20 → margem -10 → retorno mensal negativo, nunca recupera
    const curve = computePaybackCurve(makeInput({ ticketMedio: 10 }));
    expect(curve.defined).toBe(true);
    expect(curve.marks.breakEvenMes).toBeNull();
    expect(curve.marks.selfFundingMes).toBeNull();
    const valores = curve.points.map((p) => p.valor);
    expect(valores[0]).toBe(0);
    expect(valores[valores.length - 1]).toBeLessThan(0);
    // monotônico não-crescente (só o braço descendente)
    for (let i = 1; i < valores.length; i++) {
      expect(valores[i]).toBeLessThanOrEqual(valores[i - 1] + 1e-9);
    }
  });

  it("horizonteMeses é clampado (default 12; 0 → 3 mínimo)", () => {
    expect(computePaybackCurve(makeInput({ horizonteMeses: 0 })).marks.horizonteMeses).toBe(3);
    expect(computePaybackCurve(makeInput({ horizonteMeses: undefined })).marks.horizonteMeses).toBe(12);
    expect(computePaybackCurve(makeInput({ horizonteMeses: 999 })).marks.horizonteMeses).toBe(120);
  });

  it("todos os valores da curva são finitos (sem NaN/Infinity)", () => {
    const curve = computePaybackCurve(makeInput({ recompras: 0, anuncios: -10 }));
    for (const p of curve.points) {
      expect(Number.isFinite(p.valor)).toBe(true);
      expect(Number.isFinite(p.mes)).toBe(true);
    }
  });
});

describe("computeUnitEconomics — agregador", () => {
  it("encadeia cac → bands → paybacks → curve coerentemente", () => {
    const all = computeUnitEconomics(makeInput());
    expect(all.cac.cacAtual).toBe(20); // CAC real (agulha = aquisição)
    expect(all.bands.cacMaximo).toBe(25); // Ticket − Lucro Líquido
    expect(all.bands.cacIdeal).toBe(12.5); // máx/2 (Bom)
    expect(all.bands.cacMinimo).toBeCloseTo(25 / 3, 10); // máx/3 (Escala)
    expect(all.paybacks.margemPorVenda).toBe(80); // ticket − cacAtual (separado do teto)
    expect(all.bands.cacMaximo).not.toBe(all.paybacks.margemPorVenda);
    expect(all.curve.defined).toBe(true);
  });

  it("GOLDEN planilha (ticket 2.000 / 2 vendas): CAC atual 1.000 vs bandas 1.200/600/400", () => {
    const all = computeUnitEconomics(planilhaInput());
    expect(all.cac.faturamento).toBe(4000);
    expect(all.cac.despesasTotais).toBe(4400); // 2000 ads + 1200 COGS + 1200 opex
    expect(all.cac.cacAtual).toBe(1000); // anúncios 2000 / 2 vendas
    expect(all.bands.cacMaximo).toBe(1200); // Ticket 2000 − Lucro Líquido 800
    expect(all.bands.cacIdeal).toBe(600); // Bom
    expect(all.bands.cacMinimo).toBe(400); // Escala
    // Lucro Líquido = Ticket − cacMaximo = 2000 − 1200 = 800 (espelha a planilha)
    expect(2000 - (all.bands.cacMaximo as number)).toBe(800);
    // CAC atual 1.000 cai na zona amarela: Bom (600) < atual < Máximo (1.200)
    expect(all.cac.cacAtual! > (all.bands.cacIdeal as number)).toBe(true);
    expect(all.cac.cacAtual! < (all.bands.cacMaximo as number)).toBe(true);
  });

  it("caso Milennials (ticket 5153,75 / 8 vendas, ads 15000): CAC atual ACIMA do teto", () => {
    // anúncios 15000 / 8 = 1875 de CAC atual; nonAd = 27369 − 15000 = 12369 → máx 1546,125.
    const all = computeUnitEconomics(
      makeInput({
        ticketMedio: 5153.75,
        numVendas: 8,
        anuncios: 15000,
        embalagem: 0,
        frete: 0,
        impostoPct: 10,
        adminPct: 20,
        comissaoPct: 0,
      }),
    );
    expect(all.cac.faturamento).toBeCloseTo(41230, 10);
    expect(all.cac.despesasTotais).toBeCloseTo(27369, 10);
    expect(all.cac.cacAtual).toBeCloseTo(1875, 10); // anúncios/vendas
    expect(all.bands.cacMaximo).toBeCloseTo(1546.125, 10);
    expect(all.bands.cacIdeal).toBeCloseTo(773.0625, 10);
    expect(all.bands.cacMinimo).toBeCloseTo(515.375, 10);
    // CAC atual (1875) acima do teto (1546,125) → zona vermelha
    expect(all.cac.cacAtual! > (all.bands.cacMaximo as number)).toBe(true);
  });

  it("numVendas = 0 → CAC atual E bandas indefinidos (sem rateio por venda)", () => {
    const all = computeUnitEconomics(makeInput({ numVendas: 0 }));
    expect(all.cac.cacAtual).toBeNull();
    expect(all.bands.cacMaximo).toBeNull();
    expect(all.bands.cacIdeal).toBeNull();
    expect(all.bands.cacMinimo).toBeNull();
    expect(all.paybacks.payback1).toBeNull();
    expect(all.curve.defined).toBe(false);
  });

  it("ticket = 0 → CAC atual calculável, mas bandas indefinidas (ticket <= 0 → null)", () => {
    // ticket 0 → faturamento/impostos/admin 0 → despesas 300; cacAtual = anúncios 200 / 10 = 20
    const all = computeUnitEconomics(makeInput({ ticketMedio: 0 }));
    expect(all.cac.cacAtual).toBe(20);
    expect(all.bands.cacMaximo).toBeNull();
    expect(all.bands.cacIdeal).toBeNull();
    expect(all.bands.cacMinimo).toBeNull();
    // margem por venda segue separada (negativa aqui), ancorando o payback
    expect(all.paybacks.margemPorVenda).toBe(-20);
  });
});
