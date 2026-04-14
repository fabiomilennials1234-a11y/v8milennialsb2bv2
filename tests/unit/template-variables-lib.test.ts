import { describe, it, expect } from "vitest";
import {
  resolveVariables,
  TEMPLATE_VARIABLES,
  PREVIEW_LEAD,
  PREVIEW_ATTENDANT,
  type LeadContext,
  type AttendantContext,
} from "../../src/lib/template-variables";

describe("TEMPLATE_VARIABLES", () => {
  it("has at least 8 variables", () => {
    expect(TEMPLATE_VARIABLES.length).toBeGreaterThanOrEqual(8);
  });

  it("every variable has name and description", () => {
    TEMPLATE_VARIABLES.forEach((v) => {
      expect(v.name).toMatch(/^\{.+\}$/);
      expect(v.description).toBeTruthy();
    });
  });

  it("includes {nome}, {empresa}, {atendente}", () => {
    const names = TEMPLATE_VARIABLES.map((v) => v.name);
    expect(names).toContain("{nome}");
    expect(names).toContain("{empresa}");
    expect(names).toContain("{atendente}");
  });
});

describe("resolveVariables", () => {
  const lead: LeadContext = {
    name: "Maria",
    company: "Acme",
    email: "maria@acme.com",
    phone: "11999998888",
    source: "meta_ads",
    interest: "CRM",
    segment: "Tech",
    campaign_name: "Campanha Q1",
  };
  const attendant: AttendantContext = { name: "João" };

  it("replaces {nome} with lead name", () => {
    expect(resolveVariables("Olá {nome}", lead, attendant)).toBe("Olá Maria");
  });

  it("replaces {empresa}", () => {
    expect(resolveVariables("{empresa}", lead, attendant)).toBe("Acme");
  });

  it("replaces {atendente}", () => {
    expect(resolveVariables("Sou {atendente}", lead, attendant)).toBe("Sou João");
  });

  it("replaces multiple variables in one string", () => {
    const result = resolveVariables(
      "Olá {nome} da {empresa}, aqui é o {atendente}",
      lead,
      attendant
    );
    expect(result).toBe("Olá Maria da Acme, aqui é o João");
  });

  it("replaces all variables", () => {
    const template =
      "{nome} {empresa} {email} {telefone} {origem} {interesse} {segmento} {campanha} {atendente}";
    const result = resolveVariables(template, lead, attendant);
    expect(result).not.toContain("{");
    expect(result).toContain("Maria");
    expect(result).toContain("Acme");
    expect(result).toContain("João");
  });

  it("replaces missing values with empty string", () => {
    const emptyLead: LeadContext = {};
    const result = resolveVariables("Olá {nome} da {empresa}", emptyLead, { name: null });
    expect(result).toBe("Olá  da");
  });

  it("resolves custom fields {campo:slug}", () => {
    const leadWithCustom: LeadContext = {
      name: "Test",
      custom_fields: { cnpj: "12.345.678/0001-00" },
    };
    const result = resolveVariables("CNPJ: {campo:cnpj}", leadWithCustom, attendant);
    expect(result).toBe("CNPJ: 12.345.678/0001-00");
  });

  it("removes unresolved custom fields", () => {
    const result = resolveVariables("Valor: {campo:inexistente}", lead, attendant);
    expect(result).toBe("Valor:");
  });

  it("trims result", () => {
    const result = resolveVariables("  Olá {nome}  ", lead, attendant);
    expect(result).toBe("Olá Maria");
  });
});

describe("PREVIEW_LEAD and PREVIEW_ATTENDANT", () => {
  it("preview lead has all fields", () => {
    expect(PREVIEW_LEAD.name).toBeTruthy();
    expect(PREVIEW_LEAD.company).toBeTruthy();
    expect(PREVIEW_LEAD.email).toBeTruthy();
    expect(PREVIEW_LEAD.phone).toBeTruthy();
  });

  it("preview attendant has name", () => {
    expect(PREVIEW_ATTENDANT.name).toBeTruthy();
  });

  it("preview resolves without empty strings", () => {
    const template = "Olá {nome} da {empresa}, aqui é {atendente}";
    const result = resolveVariables(template, PREVIEW_LEAD, PREVIEW_ATTENDANT);
    expect(result).not.toContain("{}");
    expect(result).toContain("João Silva");
  });
});
