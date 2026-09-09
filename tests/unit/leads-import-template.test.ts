import { describe, it, expect } from "vitest";
import { LEADS_TEMPLATE_HEADERS } from "../../src/lib/leadsImportTemplate";
import { UPSELL_TEMPLATE_HEADERS } from "../../src/lib/upsellImportTemplate";

describe("LEADS_TEMPLATE_HEADERS", () => {
  it("has at least 15 columns", () => {
    expect(LEADS_TEMPLATE_HEADERS.length).toBeGreaterThanOrEqual(15);
  });

  it("first column is Nome", () => {
    expect(LEADS_TEMPLATE_HEADERS[0]).toBe("Nome");
  });

  it("includes essential columns", () => {
    const headers = [...LEADS_TEMPLATE_HEADERS];
    expect(headers).toContain("Nome");
    expect(headers).toContain("Empresa");
    expect(headers).toContain("Email");
    expect(headers).toContain("Telefone");
  });

  it("includes UTM columns", () => {
    const headers = [...LEADS_TEMPLATE_HEADERS];
    expect(headers).toContain("utm_campaign");
    expect(headers).toContain("utm_source");
    expect(headers).toContain("utm_medium");
  });

  it("includes pipeline-related columns", () => {
    const headers = [...LEADS_TEMPLATE_HEADERS];
    expect(headers).toContain("Etapa");
    expect(headers).toContain("Vendedor");
    expect(headers).toContain("Valor");
    expect(headers).toContain("Produto");
  });

  it("no duplicate headers", () => {
    const headers = [...LEADS_TEMPLATE_HEADERS];
    expect(new Set(headers).size).toBe(headers.length);
  });
});

describe("UPSELL_TEMPLATE_HEADERS", () => {
  it("has at least 8 columns", () => {
    expect(UPSELL_TEMPLATE_HEADERS.length).toBeGreaterThanOrEqual(8);
  });

  it("first column is Nome", () => {
    expect(UPSELL_TEMPLATE_HEADERS[0]).toBe("Nome");
  });

  it("includes upsell-specific columns", () => {
    const headers = [...UPSELL_TEMPLATE_HEADERS];
    expect(headers).toContain("Potencial");
    expect(headers).toContain("Data Primeira Venda");
  });

  it("no duplicate headers", () => {
    const headers = [...UPSELL_TEMPLATE_HEADERS];
    expect(new Set(headers).size).toBe(headers.length);
  });
});
