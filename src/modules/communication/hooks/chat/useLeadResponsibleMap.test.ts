import { describe, it, expect } from "vitest";
import { resolveLeadResponsible } from "./useLeadResponsibleMap";

describe("resolveLeadResponsible", () => {
  it("prefere pre_sale_responsible_id (SDR)", () => {
    expect(
      resolveLeadResponsible({
        pre_sale_responsible_id: "sdr-1",
        sale_responsible_id: "closer-1",
        responsible_id: "legacy-1",
      }),
    ).toBe("sdr-1");
  });

  it("cai pro sale_responsible_id quando não há pré-venda (bug fix: atribuição moderna)", () => {
    // Cenário real: ResponsibleSlot gravou só sale; responsible_id ficou null.
    expect(
      resolveLeadResponsible({
        pre_sale_responsible_id: null,
        sale_responsible_id: "closer-1",
        responsible_id: null,
      }),
    ).toBe("closer-1");
  });

  it("cai pro legado responsible_id quando canônicos ausentes", () => {
    expect(
      resolveLeadResponsible({ responsible_id: "legacy-1" }),
    ).toBe("legacy-1");
  });

  it("retorna null quando lead sem dono (unassigned)", () => {
    expect(
      resolveLeadResponsible({
        pre_sale_responsible_id: null,
        sale_responsible_id: null,
        responsible_id: null,
      }),
    ).toBeNull();
    expect(resolveLeadResponsible({})).toBeNull();
  });
});
