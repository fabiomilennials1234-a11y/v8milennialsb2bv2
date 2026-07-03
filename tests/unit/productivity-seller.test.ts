import { describe, it, expect } from "vitest";
import {
  heldRate,
  heldTone,
  roleLabel,
  initials,
  sellerTotals,
  type ProductivitySellerRow,
} from "@/modules/analytics/lib/productivity-seller";

const row = (over: Partial<ProductivitySellerRow>): ProductivitySellerRow => ({
  seller_id: "s",
  seller_name: "Fulano",
  metric_type: null,
  novos_leads: 0,
  reunioes_marcadas: 0,
  reunioes_realizadas: 0,
  vendido: 0,
  ...over,
});

describe("heldRate", () => {
  it("compareceu / marcadas em %", () => {
    expect(heldRate({ reunioes_marcadas: 54, reunioes_realizadas: 16 })).toBeCloseTo(29.63, 1);
  });
  it("null quando não houve marcação (evita divisão por zero)", () => {
    expect(heldRate({ reunioes_marcadas: 0, reunioes_realizadas: 0 })).toBeNull();
  });
  it("100% quando todas compareceram", () => {
    expect(heldRate({ reunioes_marcadas: 5, reunioes_realizadas: 5 })).toBe(100);
  });
});

describe("heldTone", () => {
  it("≥40 = good", () => expect(heldTone(66.7)).toBe("good"));
  it("15–40 = warn", () => expect(heldTone(29.6)).toBe("warn"));
  it("<15 = bad", () => expect(heldTone(3.2)).toBe("bad"));
  it("null = none", () => expect(heldTone(null)).toBe("none"));
  it("fronteira 40 = good, 15 = warn", () => {
    expect(heldTone(40)).toBe("good");
    expect(heldTone(15)).toBe("warn");
    expect(heldTone(14.9)).toBe("bad");
  });
});

describe("roleLabel", () => {
  it("meetings → Pré-venda, sales → Closer", () => {
    expect(roleLabel("meetings")).toBe("Pré-venda");
    expect(roleLabel("sales")).toBe("Closer");
  });
  it("null/desconhecido → sem tag (não inventa papel)", () => {
    expect(roleLabel(null)).toBeNull();
    expect(roleLabel(undefined)).toBeNull();
    expect(roleLabel("admin")).toBeNull();
  });
});

describe("initials", () => {
  it("dois nomes → primeira+última", () => expect(initials("Leo Machado")).toBe("LM"));
  it("um nome → duas primeiras letras", () => expect(initials("Mikelli")).toBe("MI"));
  it("vazio → ?", () => expect(initials("   ")).toBe("?"));
});

describe("sellerTotals", () => {
  it("soma cada métrica (dados reais Milennials Junho)", () => {
    const rows = [
      row({ reunioes_marcadas: 54, reunioes_realizadas: 16, vendido: 0 }),
      row({ reunioes_marcadas: 93, reunioes_realizadas: 3, vendido: 0 }),
      row({ reunioes_marcadas: 27, reunioes_realizadas: 3, vendido: 10 }),
      row({ reunioes_marcadas: 20, reunioes_realizadas: 1, vendido: 0 }),
      row({ reunioes_marcadas: 9, reunioes_realizadas: 6, vendido: 0 }),
      row({ reunioes_marcadas: 1, reunioes_realizadas: 0, vendido: 3 }),
    ];
    const t = sellerTotals(rows);
    expect(t.reunioes_marcadas).toBe(204);
    expect(t.reunioes_realizadas).toBe(29);
    expect(t.vendido).toBe(13);
  });
  it("lista vazia → zeros", () => {
    expect(sellerTotals([])).toEqual({
      novos_leads: 0,
      reunioes_marcadas: 0,
      reunioes_realizadas: 0,
      vendido: 0,
    });
  });
});
