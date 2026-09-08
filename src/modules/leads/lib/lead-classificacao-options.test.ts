import { describe, expect, it } from "vitest";
import { leadClassificacaoOptions, LEAD_CLASSIFICACOES } from "./lead-classificacao";

describe("seletor de classificação", () => {
  it("oferece Perdido na Lei da Relação", () => {
    expect(leadClassificacaoOptions(false)).toEqual([
      { value: "all", label: "Todos" },
      { value: "lead", label: "Lead" },
      { value: "cliente", label: "Cliente" },
      { value: "perdido", label: "Perdido" },
    ]);
  });
  it("preserva Indefinido e os valores graváveis da Lei do ERP", () => {
    expect(leadClassificacaoOptions(true).map((option) => option.value)).toEqual([
      "all", "lead", "cliente", "indefinido",
    ]);
    expect(LEAD_CLASSIFICACOES).not.toContain("perdido");
  });
});
