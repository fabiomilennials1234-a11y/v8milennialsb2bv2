import { describe, it, expect } from "vitest";
import {
  COMPATIBILIDADE,
  CORTES_POR_PESSOA,
  ENGINE_BY_ID,
  ENGINE_METRICS,
  FORMATO_DA_MEDIDA,
  ROTULO_DO_CORTE,
  cortesVisiveis,
  ehEscalar,
  medidasDe,
  parEhCompativel,
  type MetricRecorte,
} from "./metrics-studio-engine-map";

/**
 * Rede contra o erro caro: oferecer na UI um par (medida, corte) que o motor
 * recusa com EXCEPTION 22023 — erro que não é capturado por
 * isMissingSchemaError e derruba a janela em runtime.
 */

/**
 * Medidas do catálogo. As 7 primeiras estão em PROD (conferidas 2026-08-11);
 * `leads_sem_responsavel` entra pela migration 20270811120000 (SCRUM-311).
 */
const MEDIDAS_DO_CATALOGO = [
  "receita",
  "num_vendas",
  "leads_criados",
  "reunioes_marcadas",
  "reunioes_realizadas",
  "leads_na_etapa",
  "tempo_medio_etapa",
  "leads_sem_responsavel",
];

/** Fora de prod: migration 20260727140000 nunca aplicada. */
const MEDIDAS_FORA_DE_PROD = ["reunioes_no_show"];

describe("engine map — integridade contra o catálogo do motor", () => {
  it("toda medida referenciada existe no catálogo do motor", () => {
    for (const m of ENGINE_METRICS) {
      for (const medida of medidasDe(m)) {
        expect(MEDIDAS_DO_CATALOGO, `${m.id} → ${medida}`).toContain(medida);
      }
    }
  });

  it("nada aponta para medida ausente de prod", () => {
    const referenciadas = ENGINE_METRICS.flatMap(medidasDe);
    for (const ausente of MEDIDAS_FORA_DE_PROD) {
      expect(referenciadas).not.toContain(ausente);
    }
  });

  it("TODO corte oferecido está na tabela de compatibilidade", () => {
    for (const m of ENGINE_METRICS) {
      for (const corte of m.cortes) {
        expect(parEhCompativel(m, corte), `${m.id} × ${corte}`).toBe(true);
      }
    }
  });

  it("nenhuma métrica oferece corte que o motor recusa", () => {
    for (const m of ENGINE_METRICS) {
      if (m.measureRef.kind !== "leaf") continue;
      const aceitos = COMPATIBILIDADE[m.measureRef.id];
      for (const corte of m.cortes) {
        expect(aceitos, `${m.id}`).toContain(corte);
      }
    }
  });

  it("tempo_medio_etapa não oferece total — a exceção do catálogo", () => {
    const m = ENGINE_BY_ID.get("tempo_medio_etapa")!;
    expect(COMPATIBILIDADE.tempo_medio_etapa).not.toContain("total");
    expect(m.cortes).not.toContain("total");
    expect(parEhCompativel(m, "total")).toBe(false);
  });

  it("o formato bate com o formato canônico da medida (leaf)", () => {
    for (const m of ENGINE_METRICS) {
      if (m.measureRef.kind !== "leaf") continue;
      expect(m.formatId, m.id).toBe(FORMATO_DA_MEDIDA[m.measureRef.id]);
    }
  });
});

describe("engine map — decisões do grill", () => {
  it("G2: toda métrica declara ao menos um corte, e o primeiro é o default", () => {
    for (const m of ENGINE_METRICS) {
      expect(m.cortes.length, m.id).toBeGreaterThan(0);
      expect(parEhCompativel(m, m.cortes[0]), m.id).toBe(true);
    }
  });

  it("G2: razão não oferece corte — o motor força total nos dois filhos", () => {
    for (const m of ENGINE_METRICS) {
      if (m.measureRef.kind === "ratio") {
        expect(m.cortes, m.id).toEqual(["total"]);
      }
    }
  });

  it("razão é sempre escalar; leaf é escalar só no total", () => {
    for (const m of ENGINE_METRICS) {
      if (m.measureRef.kind === "ratio") {
        expect(ehEscalar(m, "total"), m.id).toBe(true);
      } else {
        expect(ehEscalar(m, "total"), m.id).toBe(true);
        const naoTotal = m.cortes.find((c) => c !== "total");
        if (naoTotal) expect(ehEscalar(m, naoTotal), `${m.id}/${naoTotal}`).toBe(false);
      }
    }
  });

  it("G6: sem permissão de Ranking, cortes por pessoa somem", () => {
    const receita = ENGINE_BY_ID.get("receita")!;
    const comPermissao = cortesVisiveis(receita, true);
    const semPermissao = cortesVisiveis(receita, false);

    expect(comPermissao).toContain("closer");
    expect(comPermissao).toContain("sdr");
    for (const corte of CORTES_POR_PESSOA) {
      expect(semPermissao).not.toContain(corte);
    }
    // O resto sobrevive — a trava é cirúrgica, não desliga a métrica.
    expect(semPermissao).toContain("total");
    expect(semPermissao).toContain("origem");
  });

  it("G6: métrica sem corte por pessoa não muda com a permissão", () => {
    const leads = ENGINE_BY_ID.get("leads_criados")!;
    expect(cortesVisiveis(leads, false)).toEqual(cortesVisiveis(leads, true));
  });

  it("G6: nenhuma métrica fica sem corte algum quando a trava aplica", () => {
    for (const m of ENGINE_METRICS) {
      expect(cortesVisiveis(m, false).length, m.id).toBeGreaterThan(0);
    }
  });

  it("G1: a oferta é 8 medidas + 3 razões", () => {
    const leafs = ENGINE_METRICS.filter((m) => m.measureRef.kind === "leaf");
    const ratios = ENGINE_METRICS.filter((m) => m.measureRef.kind === "ratio");
    expect(leafs).toHaveLength(8);
    expect(ratios).toHaveLength(3);
  });

  it("SCRUM-311: leads_sem_responsavel não oferece corte por pessoa", () => {
    const m = ENGINE_BY_ID.get("leads_sem_responsavel")!;
    expect(m.cortes).not.toContain("closer");
    expect(m.cortes).not.toContain("sdr");
    // Nem série temporal: é estado atual, não contagem de período.
    expect(m.cortes).not.toContain("tempo");
  });
});

describe("engine map — higiene", () => {
  it("não há id duplicado", () => {
    const ids = ENGINE_METRICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("todo corte usado tem rótulo de UI", () => {
    const usados = new Set<MetricRecorte>(ENGINE_METRICS.flatMap((m) => m.cortes));
    for (const corte of usados) {
      expect(ROTULO_DO_CORTE[corte], corte).toBeTruthy();
    }
  });

  it("toda métrica tem rótulo humano, sem id cru vazando para a tela", () => {
    for (const m of ENGINE_METRICS) {
      expect(m.label.length, m.id).toBeGreaterThan(2);
      expect(m.label).not.toBe(m.id);
    }
  });
});
