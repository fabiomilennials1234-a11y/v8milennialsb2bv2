import { describe, it, expect } from "vitest";
import {
  COMPATIBILIDADE,
  ENGINE_MAP,
  FORMATO_DA_MEDIDA,
  bindingDe,
  medidasDe,
  parEhCompativel,
} from "./metrics-studio-engine-map";
import { METRIC_BY_ID, STUDIO_METRICS } from "./metrics-studio-catalog";

/**
 * Estas asserções são a rede que impede o erro caro: montar um par
 * (medida, recorte) que o motor recusa com EXCEPTION 22023 — erro que NÃO é
 * capturado por isMissingSchemaError e derruba a janela em runtime.
 */

/** As 7 medidas do catálogo em PROD, medidas em 2026-08-11. */
const MEDIDAS_EM_PROD = [
  "receita",
  "num_vendas",
  "leads_criados",
  "reunioes_marcadas",
  "reunioes_realizadas",
  "leads_na_etapa",
  "tempo_medio_etapa",
];

/** Fora de prod porque a migration 20260727140000 nunca foi aplicada. */
const MEDIDAS_FORA_DE_PROD = ["reunioes_no_show"];

describe("engine map — integridade contra o catálogo do motor", () => {
  it("toda medida referenciada existe no catálogo de PROD", () => {
    for (const [metricId, binding] of Object.entries(ENGINE_MAP)) {
      for (const medida of medidasDe(binding)) {
        expect(MEDIDAS_EM_PROD, `${metricId} → ${medida}`).toContain(medida);
      }
    }
  });

  it("nenhum binding aponta para medida que não está em prod", () => {
    const referenciadas = Object.values(ENGINE_MAP).flatMap(medidasDe);
    for (const ausente of MEDIDAS_FORA_DE_PROD) {
      expect(referenciadas).not.toContain(ausente);
    }
  });

  it("todo par (medida, recorte) está na tabela de compatibilidade", () => {
    for (const [metricId, binding] of Object.entries(ENGINE_MAP)) {
      expect(parEhCompativel(binding), `${metricId}`).toBe(true);
    }
  });

  it("tempo_medio_etapa não aceita recorte total — a exceção do catálogo", () => {
    expect(COMPATIBILIDADE.tempo_medio_etapa).not.toContain("total");
    expect(
      parEhCompativel({
        measureRef: { kind: "leaf", id: "tempo_medio_etapa" },
        recorte: "total",
        formatId: "duration_human",
        escalar: true,
      }),
    ).toBe(false);
  });

  it("o formato do binding bate com o formato canônico da medida (leaf)", () => {
    for (const [metricId, binding] of Object.entries(ENGINE_MAP)) {
      if (binding.measureRef.kind !== "leaf") continue;
      expect(binding.formatId, `${metricId}`).toBe(FORMATO_DA_MEDIDA[binding.measureRef.id]);
    }
  });
});

describe("engine map — coerência com o catálogo do Estúdio", () => {
  it("toda chave do mapa é uma métrica que existe no Estúdio", () => {
    for (const metricId of Object.keys(ENGINE_MAP)) {
      expect(METRIC_BY_ID.has(metricId), metricId).toBe(true);
    }
  });

  it("bindingDe devolve undefined para métrica sem tradução — o caso da amostra", () => {
    expect(bindingDe("curva_abc")).toBeUndefined();
    expect(bindingDe("negocios_por_lead")).toBeUndefined();
    expect(bindingDe("taxa_resposta_automacao")).toBeUndefined();
  });

  it("meta_definida e reunioes_no_show ficam fora: dependem de migration não aplicada", () => {
    expect(bindingDe("meta_definida")).toBeUndefined();
    expect(bindingDe("reunioes_no_show")).toBeUndefined();
  });

  it("razão é sempre escalar — o motor devolve series null em kind=ratio", () => {
    for (const [metricId, binding] of Object.entries(ENGINE_MAP)) {
      if (binding.measureRef.kind === "ratio") {
        expect(binding.escalar, `${metricId}`).toBe(true);
      }
    }
  });

  it("leaf com recorte total é escalar; com qualquer outro recorte, série", () => {
    for (const [metricId, binding] of Object.entries(ENGINE_MAP)) {
      if (binding.measureRef.kind !== "leaf") continue;
      expect(binding.escalar, `${metricId}`).toBe(binding.recorte === "total");
    }
  });
});

describe("engine map — cobertura declarada", () => {
  it("cobre exatamente as métricas cujo cálculo o motor já faz em prod", () => {
    expect(Object.keys(ENGINE_MAP).sort()).toEqual(
      [
        "leads_criados",
        "negocios_por_etapa",
        "negocios_por_funil",
        "receita",
        "receita_por_origem",
        "reunioes_marcadas",
        "reunioes_realizadas",
        "taxa_conversao",
        "ticket_medio",
        "tempo_medio_etapa",
      ].sort(),
    );
  });

  it("a maioria do catálogo do Estúdio segue SEM motor — a UI precisa dizer isso", () => {
    const semMotor = STUDIO_METRICS.filter((m) => !bindingDe(m.id));
    expect(semMotor.length).toBe(STUDIO_METRICS.length - Object.keys(ENGINE_MAP).length);
    expect(semMotor.length).toBeGreaterThan(Object.keys(ENGINE_MAP).length);
  });
});
