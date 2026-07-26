import { describe, it, expect } from "vitest";
import {
  buildProvenanceVariants,
  fullProvenanceText,
  formatPeriodLabel,
  anchorCarriesPeriod,
  ANCHOR_GLYPH,
} from "./tv-provenance";

describe("tv-provenance (spec §4)", () => {
  it("âncora de fluxo leva período; a de retrato (hoje) não", () => {
    expect(anchorCarriesPeriod("entradas")).toBe(true);
    expect(anchorCarriesPeriod("fechamentos")).toBe(true);
    expect(anchorCarriesPeriod("hoje")).toBe(false);
  });

  it("`hoje` nunca ganha fragmento de período — seria contradição com a âncora", () => {
    const [full] = buildProvenanceVariants({
      anchor: "hoje",
      periodLabel: "08/2027",
      recorte: "etapa",
      recorteLabel: "Etapa",
    });
    expect(full).toBe(`${ANCHOR_GLYPH} base: hoje · por etapa`);
    expect(full).not.toContain("ago");
  });

  it("monta os 4 fragmentos na ordem da spec", () => {
    const [full] = buildProvenanceVariants({
      anchor: "fechamentos",
      periodLabel: "08/2027",
      recorte: "closer",
      recorteLabel: "Closer",
      emptyReason: "no_rows",
    });
    expect(full).toBe(`${ANCHOR_GLYPH} base: fechamentos · ago/2027 · por closer · sem registros`);
  });

  it("degrada na ordem 4 → 3 → abrevia 2 → colapsa 1, e a ÂNCORA NUNCA SOME", () => {
    const variants = buildProvenanceVariants({
      anchor: "fechamentos",
      periodLabel: "08/2027",
      recorte: "closer",
      recorteLabel: "Closer",
      emptyReason: "no_rows",
    });

    expect(variants[1]).not.toContain("sem registros");        // -4
    expect(variants[2]).not.toContain("por closer");            // -3
    expect(variants[3]).toContain("ago/27");                    // 2 abreviado
    expect(variants[4]).not.toContain("base:");                 // 1 colapsado
    // Piso: só a âncora. Nunca some.
    expect(variants[variants.length - 1]).toBe(`${ANCHOR_GLYPH} fechamentos`);
    variants.forEach((v) => expect(v).toContain("fechamentos"));
  });

  it("recorte `total` não vira fragmento (não informa nada)", () => {
    const [full] = buildProvenanceVariants({ anchor: "entradas", periodLabel: "08/2027", recorte: "total" });
    expect(full).toBe(`${ANCHOR_GLYPH} base: entradas · ago/2027`);
  });

  it("stream ganha do recorte — é mais específico", () => {
    const [full] = buildProvenanceVariants({
      anchor: "fechamentos",
      periodLabel: "08/2027",
      recorte: "closer",
      recorteLabel: "Closer",
      stream: "carteira",
    });
    expect(full).toContain("carteira");
    expect(full).not.toContain("por closer");
  });

  it("sem âncora a faixa some em vez de mentir (medida sem âncora é erro do motor)", () => {
    expect(buildProvenanceVariants({ anchor: null })).toEqual([]);
    expect(fullProvenanceText({ anchor: undefined })).toBe("");
  });

  it("formata MM/YYYY para mês pt-BR; formato desconhecido passa direto", () => {
    expect(formatPeriodLabel("08/2027")).toBe("ago/2027");
    expect(formatPeriodLabel("08/2027", true)).toBe("ago/27");
    expect(formatPeriodLabel("1–22 jul")).toBe("1–22 jul");
    expect(formatPeriodLabel(null)).toBeNull();
  });
});
