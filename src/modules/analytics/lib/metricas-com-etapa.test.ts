import { describe, it, expect } from "vitest";
import { exigeEtapas, faltamEtapas, MEDIDAS_COM_ETAPA } from "./metricas-com-etapa";
import type { MetricTreeNode } from "./metric-tree";

/**
 * SCRUM-388 — a trava que impede uma métrica salva de nascer quebrada.
 *
 * As medidas de coorte exigem `from_stage_key`/`to_stage_key`. Salvar sem elas
 * produz uma definição que levanta 22023 TODA vez que alguém abrir — erro que o
 * cliente vê e não sabe consertar, porque a métrica é dele.
 */

const folha = (id: string, filters?: Record<string, string>): MetricTreeNode =>
  ({ type: "measure", id, ...(filters ? { filters } : {}) }) as MetricTreeNode;

const COMPLETO = {
  pipeline_id: "11111111-1111-4111-8111-111111111111",
  from_stage_key: "novo",
  to_stage_key: "vendido",
};

describe("exigeEtapas", () => {
  it.each(MEDIDAS_COM_ETAPA.map((m) => m.id))("%s exige etapas", (id) => {
    expect(exigeEtapas(id)).toBe(true);
  });

  it("medida comum não exige", () => {
    expect(exigeEtapas("receita")).toBe(false);
    expect(exigeEtapas("leads_criados")).toBe(false);
  });
});

describe("faltamEtapas", () => {
  it("folha comum nunca falta", () => {
    expect(faltamEtapas(folha("receita"))).toBe(false);
  });

  it("coorte SEM filtro nenhum falta", () => {
    expect(faltamEtapas(folha("negocios_coorte_origem"))).toBe(true);
  });

  it.each([
    ["só funil", { pipeline_id: COMPLETO.pipeline_id }],
    ["funil + origem", { pipeline_id: COMPLETO.pipeline_id, from_stage_key: "novo" }],
    ["funil + destino", { pipeline_id: COMPLETO.pipeline_id, to_stage_key: "vendido" }],
    ["as duas etapas SEM funil", { from_stage_key: "novo", to_stage_key: "vendido" }],
  ])("coorte com %s ainda falta", (_nome, filters) => {
    // O funil é obrigatório junto das etapas: `stage_key` é slug POR FUNIL, e
    // sem escopo a mesma chave existe em vários com significados diferentes.
    expect(faltamEtapas(folha("negocios_coorte_origem", filters))).toBe(true);
  });

  it("coorte completa não falta", () => {
    expect(faltamEtapas(folha("negocios_coorte_origem", COMPLETO))).toBe(false);
  });

  it("acha a folha incompleta NO FUNDO da árvore", () => {
    // A trava tem que caminhar: o compositor permite profundidade 3, e a folha
    // capenga costuma ser a que o usuário acabou de trocar lá embaixo.
    const arvore: MetricTreeNode = {
      type: "op",
      op: "div",
      left: folha("negocios_coorte_convertidos", COMPLETO),
      right: {
        type: "op",
        op: "add",
        left: folha("receita"),
        right: folha("negocios_coorte_origem", { pipeline_id: COMPLETO.pipeline_id }),
      },
    };
    expect(faltamEtapas(arvore)).toBe(true);
  });

  it("árvore inteira completa não falta", () => {
    const arvore: MetricTreeNode = {
      type: "op",
      op: "div",
      left: folha("negocios_coorte_convertidos", COMPLETO),
      right: folha("negocios_coorte_origem", COMPLETO),
    };
    expect(faltamEtapas(arvore)).toBe(false);
  });

  it("literal não falta", () => {
    expect(faltamEtapas({ type: "literal", value: 100 })).toBe(false);
  });
});
