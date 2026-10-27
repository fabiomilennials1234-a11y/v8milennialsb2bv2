import { describe, expect, it } from "vitest";
import { leadClassificacaoOptions, leadsPageTabOptions, LEAD_CLASSIFICACOES } from "./lead-classificacao";

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

describe("abas da página /leads (Clientes virou /carteira — CTO 2026-10-16)", () => {
  it.each([
    ["Lei da Relação", false, false, ["all", "lead", "perdido"]],
    ["Lei do ERP", true, false, ["all", "lead", "indefinido"]],
    ["piloto Café Jurerê", true, true, ["all", "lead", "perdido"]],
  ] as const)("%s: perde só `cliente`, o resto idêntico", (_lei, erp, cafe, esperado) => {
    expect(leadsPageTabOptions(erp, cafe).map((o) => o.value)).toEqual(esperado);
    expect(leadsPageTabOptions(erp, cafe)).toEqual(
      leadClassificacaoOptions(erp, cafe).filter((o) => o.value !== "cliente"),
    );
  });

  it("o seletor gravável do lead continua oferecendo Cliente", () => {
    expect(leadClassificacaoOptions(false).map((o) => o.value)).toContain("cliente");
  });
});

describe("aba Lista fria (ADR-0042)", () => {
  it("sem a flag, as abas são as de sempre", () => {
    expect(leadsPageTabOptions(false, false, false)).toEqual(leadsPageTabOptions(false, false));
  });
  it.each([
    ["Lei da Relação", false, false, ["all", "lead", "lista_fria", "perdido"]],
    ["Lei do ERP", true, false, ["all", "lead", "lista_fria", "indefinido"]],
  ] as const)("%s: entra depois de Leads", (_lei, erp, cafe, esperado) => {
    expect(leadsPageTabOptions(erp, cafe, true).map((o) => o.value)).toEqual(esperado);
    expect(leadsPageTabOptions(erp, cafe, true).find((o) => o.value === "lista_fria")?.label).toBe("Lista fria");
  });
  it("não é uma classificação gravável do lead", () => {
    expect(LEAD_CLASSIFICACOES as readonly string[]).not.toContain("lista_fria");
  });
});
