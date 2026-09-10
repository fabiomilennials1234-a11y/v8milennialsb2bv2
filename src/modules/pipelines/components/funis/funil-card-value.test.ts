import { describe, expect, it } from "vitest";
import { projectSaleValue } from "./funil-card-value";

describe("projectSaleValue", () => {
  it("projeta o valor achatado da proposta no cartão compacto", () => {
    expect(projectSaleValue({ sale_value: "2450.75" })).toBe(2450.75);
  });

  it("usa o metadata enquanto a resposta ainda não estiver achatada", () => {
    expect(projectSaleValue({ metadata: { sale_value: 900 } })).toBe(900);
  });

  it("mantém a ausência de valor como nula", () => {
    expect(projectSaleValue({ metadata: {} })).toBeNull();
  });

  it("preserva venda sem cobrança informada como zero", () => {
    expect(projectSaleValue({ sale_value: 0 })).toBe(0);
  });
});
