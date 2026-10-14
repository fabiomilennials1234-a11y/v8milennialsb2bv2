import { describe, it, expect } from "vitest";
import { disparoDoImport, type AutomacaoDeEtiqueta } from "./import-tags";

function automacao(id: string, triggerConfig: unknown): AutomacaoDeEtiqueta {
  return { id, name: `Automação ${id}`, trigger_config: triggerConfig };
}

describe("disparoDoImport — espelha matches_workflow_trigger_config('tag_added')", () => {
  it("nada escolhido, nada dispara", () => {
    expect(disparoDoImport([automacao("1", {})], [])).toEqual({ automacoes: [], execucoesPorLead: 0 });
  });

  it("gatilho com etiqueta casa por nome, sem caixa", () => {
    const r = disparoDoImport(
      [automacao("vip", { tag_name: "VIP" }), automacao("frio", { tag_name: "Frio" })],
      ["vip"],
    );

    expect(r.automacoes.map((a) => a.id)).toEqual(["vip"]);
    expect(r.execucoesPorLead).toBe(1);
  });

  it.each([
    ["config vazia", {}],
    ["tag_name vazio", { tag_name: "" }],
    ["config nula", null],
  ])("gatilho sem etiqueta (%s) roda uma vez por etiqueta escolhida", (_caso, config) => {
    const r = disparoDoImport([automacao("qualquer", config)], ["VIP", "Feira"]);

    expect(r.automacoes).toHaveLength(1);
    expect(r.execucoesPorLead).toBe(2);
  });

  it("soma as execuções de todas as automações que casam", () => {
    const r = disparoDoImport(
      [automacao("qualquer", {}), automacao("vip", { tag_name: "vip" }), automacao("outra", { tag_name: "x" })],
      ["VIP", "Feira"],
    );

    expect(r.automacoes.map((a) => a.id)).toEqual(["qualquer", "vip"]);
    expect(r.execucoesPorLead).toBe(3);
  });
});
