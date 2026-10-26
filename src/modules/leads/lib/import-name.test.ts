import { describe, it, expect } from "vitest";
import { withNameFallback } from "./import-name";

describe("withNameFallback", () => {
  it("🔑 sem nome e com empresa: a empresa vira o nome", () => {
    expect(withNameFallback({ name: "", company: "ACME LTDA" }).name).toBe("ACME LTDA");
    expect(withNameFallback({ company: "ACME LTDA" }).name).toBe("ACME LTDA");
    expect(withNameFallback({ name: "   ", company: " ACME LTDA " }).name).toBe("ACME LTDA");
  });

  it("nome informado nunca é trocado pela empresa", () => {
    expect(withNameFallback({ name: "Maria", company: "ACME" }).name).toBe("Maria");
  });

  it("sem nome e sem empresa continua vazio, para a validação rejeitar", () => {
    expect(withNameFallback({ name: "", company: "" }).name).toBe("");
    expect(withNameFallback({}).name).toBe("");
  });

  it("preserva os demais campos", () => {
    const out = withNameFallback({ company: "ACME", phone: "11999998888", segment: "Café" });
    expect(out).toMatchObject({ phone: "11999998888", segment: "Café", company: "ACME" });
  });
});
