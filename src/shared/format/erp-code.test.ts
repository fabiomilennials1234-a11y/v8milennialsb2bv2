import { describe, it, expect } from "vitest";
import { withErpCode, erpLabel } from "./erp-code";

describe("withErpCode", () => {
  it("põe o código do ERP na frente do nome", () => {
    expect(withErpCode("João da Silva", "1234")).toBe("1234 - João da Silva");
  });

  it("cliente sem ERP fica só com o nome — nenhuma tela precisa saber da integração", () => {
    expect(withErpCode("João da Silva", null)).toBe("João da Silva");
    expect(withErpCode("João da Silva", undefined)).toBe("João da Silva");
    expect(withErpCode("João da Silva", "")).toBe("João da Silva");
  });

  it("código só com espaço não vira prefixo — o Toth preenche campo com \"  \"", () => {
    expect(withErpCode("João da Silva", "  ")).toBe("João da Silva");
  });

  it("nome ausente devolve o código sozinho, nunca \" - João\"", () => {
    expect(withErpCode(null, "1234")).toBe("1234");
    expect(withErpCode("", "1234")).toBe("1234");
    expect(withErpCode("   ", "1234")).toBe("1234");
  });

  it("não duplica o prefixo quando o nome já chega prefixado", () => {
    expect(withErpCode("1234 - João da Silva", "1234")).toBe("1234 - João da Silva");
    expect(withErpCode("1234", "1234")).toBe("1234");
  });

  it("prefixo parecido não conta como já-prefixado", () => {
    // "12" não prefixa "1234 - ..." — sem o separador, o startsWith casaria.
    expect(withErpCode("1234 - João", "12")).toBe("12 - 1234 - João");
  });

  it("nada de nada devolve string vazia", () => {
    expect(withErpCode(null, null)).toBe("");
  });
});

describe("erpLabel", () => {
  it("lead usa `erp_code`", () => {
    expect(erpLabel({ name: "João da Silva", erp_code: "1234" })).toBe("1234 - João da Silva");
  });

  it("cliente da carteira usa `external_id`", () => {
    expect(erpLabel({ name: "João da Silva", external_id: "1234" })).toBe("1234 - João da Silva");
  });

  it("`erp_code` ganha de `external_id` quando a linha tem os dois", () => {
    expect(erpLabel({ name: "João", erp_code: "1234", external_id: "9999" })).toBe("1234 - João");
  });

  it("linha sem ERP mostra só o nome — org sem integração não vê diferença", () => {
    expect(erpLabel({ name: "João da Silva" })).toBe("João da Silva");
    expect(erpLabel({ name: "João da Silva", erp_code: null, external_id: null })).toBe(
      "João da Silva",
    );
  });

  it("linha ausente não quebra a tela", () => {
    expect(erpLabel(null)).toBe("");
    expect(erpLabel(undefined)).toBe("");
  });
});
