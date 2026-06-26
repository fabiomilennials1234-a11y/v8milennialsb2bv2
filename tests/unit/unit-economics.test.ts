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

// Caso base "saudável" com números redondos para asserts exatos:
//   faturamento    = 100 * 10 = 1000
//   impostoValor   = 0.10 * 1000 = 100
//   adminValor     = 0.05 * 1000 = 50
//   despesasTotais = 200 + 50 + 50 + 100 + 50 = 450
//   cacMaximo      = 450 / 10 = 45
//   margemPorVenda = 100 - 45 = 55
//   ltv            = 100 * 3 = 300
//   margemComLtv   = 300 - 45 = 255
function makeInput(overrides: Partial<UnitEconomicsInputs> = {}): UnitEconomicsInputs {
  return {
    ticketMedio: 100,
    numVendas: 10,
    anuncios: 200,
    embalagem: 50,
    frete: 50,
    impostoPct: 10,
    adminPct: 5,
    recompras: 3,
    horizonteMeses: 12,
    ...overrides,
  };
}

describe("computeCac", () => {
  it("computa faturamento, impostos, admin, despesas e CAC máximo", () => {
    const r = computeCac(makeInput());
    expect(r.faturamento).toBe(1000);
    expect(r.impostoValor).toBe(100);
    expect(r.adminValor).toBe(50);
    expect(r.despesasTotais).toBe(450);
    expect(r.cacMaximo).toBe(45);
  });

  it("numVendas = 0 → CAC indefinido (null, não NaN/Infinity)", () => {
    const r = computeCac(makeInput({ numVendas: 0 }));
    expect(r.faturamento).toBe(0);
    expect(r.despesasTotais).toBe(300); // 200+50+50, impostos/admin = 0
    expect(r.cacMaximo).toBeNull();
  });

  it("numVendas negativo → CAC indefinido (null)", () => {
    const r = computeCac(makeInput({ numVendas: -5 }));
    expect(r.cacMaximo).toBeNull();
  });

  it("inputs não-finitos são coeridos a 0 (sem NaN)", () => {
    const r = computeCac(
      makeInput({ anuncios: NaN as unknown as number, frete: Infinity as unknown as number }),
    );
    expect(Number.isFinite(r.despesasTotais)).toBe(true);
    expect(Number.isFinite(r.cacMaximo as number)).toBe(true);
  });

  it("valores negativos fluem mas mantêm finitude", () => {
    const r = computeCac(makeInput({ anuncios: -1000 }));
    expect(Number.isFinite(r.despesasTotais)).toBe(true);
    expect(r.despesasTotais).toBe(-750); // -1000+50+50+100+50
    expect(r.cacMaximo).toBe(-75);
  });
});

describe("cacBands", () => {
  it("cacIdeal = max/2, cacMinimo = ideal/2", () => {
    const b = cacBands(45);
    expect(b.cacMaximo).toBe(45);
    expect(b.cacIdeal).toBe(22.5);
    expect(b.cacMinimo).toBe(11.25);
  });

  it("propaga null quando CAC é indefinido", () => {
    const b = cacBands(null);
    expect(b).toEqual({ cacMaximo: null, cacIdeal: null, cacMinimo: null });
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
    expect(p.margemPorVenda).toBe(55);
    expect(p.payback1).toBeCloseTo(45 / 55, 10);
    expect(p.payback1Possivel).toBe(true);
    expect(p.ltv).toBe(300);
    expect(p.margemComLtv).toBe(255);
    expect(p.payback2).toBeCloseTo(45 / 255, 10);
    expect(p.payback2Possivel).toBe(true);
  });

  it("margemPorVenda <= 0 → payback1 impossível (null + flag)", () => {
    // ticket 20: faturamento 200 → imposto 20 + admin 10 → despesas 330 →
    // cacMaximo 33 → margem 20-33 = -13 (imposto/admin escalam com faturamento)
    const p = computePaybacks(makeInput({ ticketMedio: 20 }));
    expect(p.margemPorVenda).toBe(-13);
    expect(p.payback1).toBeNull();
    expect(p.payback1Possivel).toBe(false);
  });

  it("margemComLtv <= 0 → payback2 impossível (null + flag)", () => {
    // ticket 20, recompras 1 → ltv 20, cacMaximo 33 → margemComLtv 20-33 = -13
    const p = computePaybacks(makeInput({ ticketMedio: 20, recompras: 1 }));
    expect(p.margemComLtv).toBe(-13);
    expect(p.payback2).toBeNull();
    expect(p.payback2Possivel).toBe(false);
  });

  it("recompras = 0 → ltv 0, margemComLtv = -cac, payback2 impossível", () => {
    const p = computePaybacks(makeInput({ recompras: 0 }));
    expect(p.ltv).toBe(0);
    expect(p.margemComLtv).toBe(-45);
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
});

describe("computePaybackCurve — caso saudável (J completo)", () => {
  const curve = computePaybackCurve(makeInput());
  const valores = curve.points.map((p) => p.valor);
  const meses = curve.points.map((p) => p.mes);

  it("é definido e expõe os parâmetros do modelo", () => {
    expect(curve.defined).toBe(true);
    expect(curve.model.investimentoMensal).toBe(450);
    expect(curve.model.retornoMensalPleno).toBe(550); // 10 * 55
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
    // ticket 20 → cac 33 → margem -13 → retorno mensal negativo, nunca recupera
    const curve = computePaybackCurve(makeInput({ ticketMedio: 20 }));
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
    expect(all.cac.cacMaximo).toBe(45);
    expect(all.bands.cacIdeal).toBe(22.5);
    expect(all.bands.cacMinimo).toBe(11.25);
    expect(all.paybacks.margemPorVenda).toBe(55);
    expect(all.curve.defined).toBe(true);
  });

  it("propaga indefinição quando numVendas = 0", () => {
    const all = computeUnitEconomics(makeInput({ numVendas: 0 }));
    expect(all.cac.cacMaximo).toBeNull();
    expect(all.bands.cacMaximo).toBeNull();
    expect(all.paybacks.payback1).toBeNull();
    expect(all.curve.defined).toBe(false);
  });
});
