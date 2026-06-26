import { describe, it, expect } from "vitest";
import {
  computeEconomicsTimeline,
  computeMarkerMes,
  phaseKeyAtMes,
  TIMELINE_MONTHS,
} from "../../src/modules/identity/master/lib/economics-timeline";
import type { UnitEconomicsInputs } from "../../src/modules/identity/master/lib/unit-economics";

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
    horizonteMeses: 18,
    ...overrides,
  };
}

// Caso canônico do CTO (Milennials):
//   ticket 5153,75 / 8 vendas / anúncios 15000 / imposto 10% / admin 20%
//   → despesas 27369 → cacAtual 3421,125; máx 5153,75; ideal 2576,875; mín 1288,4375
function milennials(): UnitEconomicsInputs {
  return makeInput({
    ticketMedio: 5153.75,
    numVendas: 8,
    anuncios: 15000,
    embalagem: 0,
    frete: 0,
    impostoPct: 10,
    adminPct: 20,
    comissaoPct: 0,
  });
}

describe("computeMarkerMes — 4 regimes do CAC", () => {
  it("cacAtual indefinido (null) → markerMes null", () => {
    expect(computeMarkerMes(null, 100, 25)).toBeNull();
  });

  it("bandas indefinidas (ticket <= 0) → markerMes null", () => {
    expect(computeMarkerMes(45, null, null)).toBeNull();
  });

  it("cacAtual > máximo → meses [1, 4]: mapeia [máx, 2×máx] → [4, 1]", () => {
    // no teto → 4 (fronteira contínua com o ramo de baixo)
    expect(computeMarkerMes(100, 100, 25)).toBeCloseTo(4, 10);
    // 15% acima → 4 − 0.15*3 = 3,55
    expect(computeMarkerMes(115, 100, 25)).toBeCloseTo(3.55, 10);
    // 2× o teto → 1
    expect(computeMarkerMes(200, 100, 25)).toBeCloseTo(1, 10);
    // muito acima → clampa em 1
    expect(computeMarkerMes(500, 100, 25)).toBeCloseTo(1, 10);
  });

  it("cacAtual ≈ máximo → markerMes 4 (banda break-even)", () => {
    expect(computeMarkerMes(100, 100, 25)).toBeCloseTo(4, 10);
    expect(phaseKeyAtMes(computeMarkerMes(100, 100, 25)!)).toBe("breakeven");
  });

  it("cacAtual entre máx e mín → 4 + (máx−cac)/(máx−mín)·8, clamp [4,12]", () => {
    // base: cac 45, máx 100, mín 25 → 4 + 55/75*8 = 9,8667
    expect(computeMarkerMes(45, 100, 25)).toBeCloseTo(9.8667, 3);
  });

  it("cacAtual ≤ mínimo → mês 12", () => {
    expect(computeMarkerMes(25, 100, 25)).toBe(12);
    expect(computeMarkerMes(10, 100, 25)).toBe(12);
  });

  it("caso Milennials → markerMes ≈ 7,59 (banda Ganho de margem)", () => {
    const m = computeMarkerMes(3421.125, 5153.75, 1288.4375)!;
    expect(m).toBeCloseTo(7.586, 2);
    expect(phaseKeyAtMes(m)).toBe("margem");
  });
});

describe("phaseKeyAtMes", () => {
  it("mapeia mês → fase (marcador nunca passa de 12)", () => {
    expect(phaseKeyAtMes(1)).toBe("prejuizo");
    expect(phaseKeyAtMes(3.5)).toBe("prejuizo");
    expect(phaseKeyAtMes(4)).toBe("breakeven");
    expect(phaseKeyAtMes(5.9)).toBe("breakeven");
    expect(phaseKeyAtMes(6)).toBe("margem");
    expect(phaseKeyAtMes(12)).toBe("margem");
    expect(phaseKeyAtMes(13)).toBe("alavancagem");
  });
});

describe("computeEconomicsTimeline — estrutura e marcador", () => {
  it("expõe 18 meses, 4 fases canônicas e defined=true no caso saudável", () => {
    const t = computeEconomicsTimeline(milennials());
    expect(t.defined).toBe(true);
    expect(t.months).toHaveLength(TIMELINE_MONTHS);
    expect(t.months[0]).toBe(1);
    expect(t.months[t.months.length - 1]).toBe(18);
    expect(t.phases.map((p) => p.key)).toEqual([
      "prejuizo",
      "breakeven",
      "margem",
      "alavancagem",
    ]);
    expect(t.caixa).toHaveLength(18);
    expect(t.investimento).toHaveLength(18);
    expect(t.roi).toHaveLength(18);
  });

  it("Milennials → markerMes ≈ 7,59 e markerPhaseKey 'margem'", () => {
    const t = computeEconomicsTimeline(milennials());
    expect(t.markerMes).not.toBeNull();
    expect(t.markerMes!).toBeCloseTo(7.586, 2);
    expect(t.markerPhaseKey).toBe("margem");
    expect(t.meta.cacAtual).toBeCloseTo(3421.125, 6);
    expect(t.meta.cacMaximo).toBeCloseTo(5153.75, 6);
    expect(t.meta.cacMinimo).toBeCloseTo(1288.4375, 6);
  });
});

describe("computeEconomicsTimeline — shape das 3 séries", () => {
  const t = computeEconomicsTimeline(milennials());
  const caixa = t.caixa.map((p) => p.valor);
  const invest = t.investimento.map((p) => p.valor);
  const roi = t.roi.map((p) => p.valor);

  it("investimento é monotônico não-decrescente e >= 0", () => {
    expect(invest[0]).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < invest.length; i++) {
      expect(invest[i]).toBeGreaterThanOrEqual(invest[i - 1] - 1e-9);
    }
    // degrau mais íngreme nos ciclos: cresce mais entre 12→18 que entre 1→7
    const earlyStep = invest[6] - invest[0];
    const cycleStep = invest[17] - invest[11];
    expect(cycleStep).toBeGreaterThan(earlyStep);
  });

  it("caixa: começa ~0, mergulha (fundo no mês 4), cruza 0 (~mês 5) e termina em alta", () => {
    // mês 1 (índice 0) ≈ 0
    expect(Math.abs(caixa[0])).toBeLessThan(1e-6);
    // fundo (mínimo global) no mês 4 → índice 3
    let idxMin = 0;
    for (let i = 1; i < caixa.length; i++) if (caixa[i] < caixa[idxMin]) idxMin = i;
    expect(t.months[idxMin]).toBe(4);
    expect(caixa[idxMin]).toBeLessThan(0);
    // break-even: caixa no mês 5 (índice 4) ≈ 0, com sinais opostos em volta
    expect(Math.abs(caixa[4])).toBeLessThan(1e-6);
    expect(caixa[3]).toBeLessThan(0);
    expect(caixa[5]).toBeGreaterThan(0);
    // ondas crescentes: mês 18 acima do mês 12
    expect(caixa[17]).toBeGreaterThan(caixa[11]);
  });

  it("roi (%): negativo no início, cruza 0 no MESMO mês do caixa (~5) e sobe", () => {
    expect(roi[0]).toBeLessThan(0); // mês 1 ≈ −100%
    expect(roi[0]).toBeCloseTo(-100, 6);
    expect(Math.abs(roi[4])).toBeLessThan(1e-6); // mês 5 cruza 0 (igual ao caixa)
    expect(roi[3]).toBeLessThan(0);
    expect(roi[5]).toBeGreaterThan(0);
    expect(roi[11]).toBeGreaterThan(0); // mês 12 em alta
  });
});

describe("computeEconomicsTimeline — zero compartilhado", () => {
  it("a fração acima do zero é a mesma nos dois eixos (syReais(0) === syRoi(0))", () => {
    const t = computeEconomicsTimeline(milennials());
    const { reaisMin, reaisMax, roiMin, roiMax } = t.axis;
    // ambos os domínios contêm o zero
    expect(reaisMin).toBeLessThan(0);
    expect(reaisMax).toBeGreaterThan(0);
    expect(roiMin).toBeLessThan(0);
    expect(roiMax).toBeGreaterThan(0);
    // fração acima do zero idêntica → o pixel do 0 coincide p/ qualquer plot
    const fReais = reaisMax / (reaisMax - reaisMin);
    const fRoi = roiMax / (roiMax - roiMin);
    expect(fReais).toBeCloseTo(fRoi, 9);
  });

  it("o domínio ROI cobre os extremos reais da série", () => {
    const t = computeEconomicsTimeline(milennials());
    const roi = t.roi.map((p) => p.valor);
    expect(t.axis.roiMax).toBeGreaterThanOrEqual(Math.max(...roi));
    expect(t.axis.roiMin).toBeLessThanOrEqual(Math.min(...roi));
  });
});

describe("computeEconomicsTimeline — guards defensivos", () => {
  it("numVendas = 0 → defined=false e markerMes null (sem marcador)", () => {
    const t = computeEconomicsTimeline(makeInput({ numVendas: 0 }));
    expect(t.defined).toBe(false);
    expect(t.markerMes).toBeNull();
    expect(t.markerPhaseKey).toBeNull();
    expect(t.meta.cacAtual).toBeNull();
    // ainda assim, as séries canônicas seguem populadas (forma esmaecida)
    expect(t.caixa).toHaveLength(18);
  });

  it("numVendas negativo → defined=false", () => {
    expect(computeEconomicsTimeline(makeInput({ numVendas: -3 })).defined).toBe(false);
  });

  it("ticket <= 0 → bandas indefinidas → markerMes null (mesmo com vendas)", () => {
    const t = computeEconomicsTimeline(makeInput({ ticketMedio: 0 }));
    expect(t.meta.cacMaximo).toBeNull();
    expect(t.markerMes).toBeNull();
  });

  it("inputs não-finitos / extremos → tudo finito, sem NaN/Infinity", () => {
    const t = computeEconomicsTimeline(
      makeInput({
        anuncios: NaN as unknown as number,
        frete: Infinity as unknown as number,
        ticketMedio: -50,
        recompras: 0,
      }),
    );
    for (const series of [t.caixa, t.investimento, t.roi]) {
      for (const p of series) {
        expect(Number.isFinite(p.valor)).toBe(true);
        expect(Number.isFinite(p.mes)).toBe(true);
      }
    }
    for (const v of [t.axis.reaisMin, t.axis.reaisMax, t.axis.roiMin, t.axis.roiMax]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
