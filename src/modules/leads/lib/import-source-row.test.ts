import { describe, expect, it } from "vitest";
import { isBlankRow, markSourceRow, sourceRowOf } from "./import-source-row";

describe("import-source-row", () => {
  it("devolve a linha marcada e undefined para linha não marcada", () => {
    const a = markSourceRow({ Empresa: "A" }, 9);
    expect(sourceRowOf(a)).toBe(9);
    expect(sourceRowOf({ Empresa: "B" })).toBeUndefined();
  });

  it("a marca não vira chave da linha (não aparece como coluna)", () => {
    const a = markSourceRow({ Empresa: "A", Telefone: "1" }, 2);
    expect(Object.keys(a)).toEqual(["Empresa", "Telefone"]);
    expect(JSON.stringify(a)).toBe('{"Empresa":"A","Telefone":"1"}');
  });

  it("isBlankRow: só vazio/espaço é em branco", () => {
    expect(isBlankRow({ A: "", B: "  " })).toBe(true);
    expect(isBlankRow({ A: "", B: "x" })).toBe(false);
  });
});
