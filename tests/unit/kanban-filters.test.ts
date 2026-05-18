import { describe, it, expect } from "vitest";
import {
  matchesResponsibleFilter,
  type KanbanFilterableItem,
} from "@/lib/kanban-filters";

const BRUNA = "d2883fad-8e72-4a23-be2b-510317d2f1c4";
const OTHER = "00000000-0000-0000-0000-000000000099";

function baseItem(): KanbanFilterableItem {
  return {
    responsible_id: null,
    sdr_id: null,
    pre_sale_responsible_id: null,
    sale_responsible_id: null,
    lead: {
      responsible_id: null,
      sdr_id: null,
      closer_id: null,
      pre_sale_responsible_id: null,
      sale_responsible_id: null,
    },
  };
}

describe("matchesResponsibleFilter — dual-only (Issue #214 / PRD #211)", () => {
  it("returns true when filterId is 'all'", () => {
    expect(matchesResponsibleFilter(baseItem(), "all")).toBe(true);
  });

  it("returns true when filterId is empty string / null / undefined (treated as 'no filter')", () => {
    expect(matchesResponsibleFilter(baseItem(), "")).toBe(true);
    expect(matchesResponsibleFilter(baseItem(), null)).toBe(true);
    expect(matchesResponsibleFilter(baseItem(), undefined)).toBe(true);
  });

  it("returns false when no field matches", () => {
    const item = baseItem();
    item.pre_sale_responsible_id = OTHER;
    item.lead!.pre_sale_responsible_id = OTHER;
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(false);
  });

  it("returns false when all fields are null and a real filter is applied", () => {
    expect(matchesResponsibleFilter(baseItem(), BRUNA)).toBe(false);
  });

  // ─── Dual-only matches (the 4 fields we still consult) ───

  it("matches when entry.pre_sale_responsible_id equals filterId", () => {
    const item = baseItem();
    item.pre_sale_responsible_id = BRUNA;
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(true);
  });

  it("matches when entry.sale_responsible_id equals filterId", () => {
    const item = baseItem();
    item.sale_responsible_id = BRUNA;
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(true);
  });

  it("matches when lead.pre_sale_responsible_id equals filterId", () => {
    const item = baseItem();
    item.lead!.pre_sale_responsible_id = BRUNA;
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(true);
  });

  it("matches when lead.sale_responsible_id equals filterId", () => {
    const item = baseItem();
    item.lead!.sale_responsible_id = BRUNA;
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(true);
  });

  // ─── Legacy fields MUST NOT match (Issue #214 acceptance) ───
  // Rationale: backfill from `e3ac4599` populated dual fields; any lead/entry
  // where the member is only present in a legacy column is contaminated state
  // that must not produce kanban hits under the per-member filter.

  it("does NOT match when only entry.responsible_id (legacy) is populated with filterId", () => {
    const item = baseItem();
    item.responsible_id = BRUNA;
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(false);
  });

  it("does NOT match when only entry.sdr_id (legacy) is populated with filterId", () => {
    const item = baseItem();
    item.sdr_id = BRUNA;
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(false);
  });

  it("does NOT match when only lead.responsible_id (legacy) is populated with filterId", () => {
    const item = baseItem();
    item.lead!.responsible_id = BRUNA;
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(false);
  });

  it("does NOT match when only lead.sdr_id (legacy) is populated with filterId", () => {
    const item = baseItem();
    item.lead!.sdr_id = BRUNA;
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(false);
  });

  it("does NOT match when only lead.closer_id (legacy) is populated with filterId", () => {
    const item = baseItem();
    item.lead!.closer_id = BRUNA;
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(false);
  });

  // Explicit PRD #214 acceptance scenario: lead with closer_id=X and both
  // pre/sale_responsible_id null. Filter X must NOT include this lead.
  it("does NOT match the legacy-only contaminated case (lead.closer_id=X, dual both null)", () => {
    const item: KanbanFilterableItem = {
      responsible_id: null,
      sdr_id: null,
      pre_sale_responsible_id: null,
      sale_responsible_id: null,
      lead: {
        responsible_id: null,
        sdr_id: null,
        closer_id: BRUNA,
        pre_sale_responsible_id: null,
        sale_responsible_id: null,
      },
    };
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(false);
  });

  // Mixed: legacy + dual populated for different members. Match follows dual only.
  it("matches the dual member even when legacy fields point at a different member", () => {
    const item: KanbanFilterableItem = {
      responsible_id: OTHER,
      sdr_id: OTHER,
      pre_sale_responsible_id: BRUNA,
      sale_responsible_id: null,
      lead: {
        responsible_id: OTHER,
        sdr_id: OTHER,
        closer_id: OTHER,
        pre_sale_responsible_id: null,
        sale_responsible_id: null,
      },
    };
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(true);
    expect(matchesResponsibleFilter(item, OTHER)).toBe(false);
  });

  // The Alessandra Pinheiro case (org Basic4u, prod, 2026-05-18) — preserved
  // verbatim from prior coverage: dual field on the entry is the source of
  // truth, and the lead row is empty.
  it("matches the Alessandra Pinheiro production case (entry.pre_sale_responsible_id only)", () => {
    const item: KanbanFilterableItem = {
      responsible_id: null,
      sdr_id: null,
      pre_sale_responsible_id: BRUNA,
      sale_responsible_id: null,
      lead: {
        responsible_id: null,
        sdr_id: null,
        closer_id: null,
        pre_sale_responsible_id: null,
        sale_responsible_id: null,
      },
    };
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(true);
  });

  // ─── Defensive shape handling ───

  it("does not throw when lead is null", () => {
    const item: KanbanFilterableItem = {
      pre_sale_responsible_id: BRUNA,
      lead: null,
    };
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(true);
  });

  it("does not throw when lead is undefined", () => {
    const item: KanbanFilterableItem = { pre_sale_responsible_id: BRUNA };
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(true);
  });

  it("does not throw when item itself is null/undefined", () => {
    expect(matchesResponsibleFilter(null, BRUNA)).toBe(false);
    expect(matchesResponsibleFilter(undefined, BRUNA)).toBe(false);
    // 'all' still wins even for null items (filter is a no-op).
    expect(matchesResponsibleFilter(null, "all")).toBe(true);
  });
});
