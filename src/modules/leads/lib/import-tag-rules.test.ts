import { describe, expect, it } from "vitest";
import { defaultTagColumn, distinctValues, foldValue, rowTagIds, savedMapFor } from "./import-tag-rules";

describe("foldValue", () => {
  it("acento, caixa e espaço não separam valores", () => {
    expect(foldValue("  Empório ")).toBe("emporio");
    expect(foldValue("EMPÓRIO")).toBe("emporio");
    expect(foldValue("Hotel   e  Pousada")).toBe("hotel e pousada");
    expect(foldValue(undefined)).toBe("");
  });
});

describe("defaultTagColumn", () => {
  it("sugere a coluna de segmento do modelo da planilha", () => {
    expect(defaultTagColumn(["Empresa", "Telefone", "Cidade", "Endereço", "Segmento", "Nome do contato"])).toBe("Segmento");
    expect(defaultTagColumn(["Empresa", "SETOR"])).toBe("SETOR");
    expect(defaultTagColumn(["Empresa", "Telefone"])).toBeNull();
  });
});

describe("distinctValues", () => {
  it("conta por valor dobrado, do mais frequente ao menos, sem vazio", () => {
    const rows = [
      { Segmento: "Cafeteria" },
      { Segmento: "Empório" },
      { Segmento: "cafeteria" },
      { Segmento: "emporio " },
      { Segmento: "Cafeteria" },
      { Segmento: "" },
      { Segmento: "Livraria" },
    ];
    expect(distinctValues(rows, "Segmento")).toEqual([
      { label: "Cafeteria", key: "cafeteria", count: 3 },
      { label: "Empório", key: "emporio", count: 2 },
      { label: "Livraria", key: "livraria", count: 1 },
    ]);
  });
});

describe("savedMapFor", () => {
  const rules = [
    { source_column: "segmento", source_value: "cafeteria", tag_id: "t-cafe" },
    { source_column: "segmento", source_value: "emporio", tag_id: "t-apagada" },
    { source_column: "cidade", source_value: "canela", tag_id: "t-canela" },
  ];

  it("traz só a coluna pedida e só etiqueta que ainda existe", () => {
    expect(savedMapFor(rules, "Segmento", new Set(["t-cafe", "t-canela"]))).toEqual({ cafeteria: "t-cafe" });
  });
});

describe("rowTagIds", () => {
  const rule = { column: "Segmento", byValue: { cafeteria: "t-cafe", "hotel e pousada": "t-hotel" } };

  it("a linha leva a etiqueta do seu valor; valor sem etiqueta não leva nada", () => {
    expect(rowTagIds(rule, { Segmento: "CAFETERIA" })).toEqual(["t-cafe"]);
    expect(rowTagIds(rule, { Segmento: "Hotel e Pousada" })).toEqual(["t-hotel"]);
    expect(rowTagIds(rule, { Segmento: "Livraria" })).toBeUndefined();
    expect(rowTagIds(undefined, { Segmento: "Cafeteria" })).toBeUndefined();
  });
});
