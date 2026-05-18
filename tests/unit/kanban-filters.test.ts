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

describe("matchesResponsibleFilter", () => {
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
    item.responsible_id = OTHER;
    item.lead!.responsible_id = OTHER;
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(false);
  });

  it("returns false when all fields are null and a real filter is applied", () => {
    expect(matchesResponsibleFilter(baseItem(), BRUNA)).toBe(false);
  });

  // Entry-level fields (4)
  it("matches when entry.responsible_id equals filterId", () => {
    const item = baseItem();
    item.responsible_id = BRUNA;
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(true);
  });

  it("matches when entry.sdr_id equals filterId", () => {
    const item = baseItem();
    item.sdr_id = BRUNA;
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(true);
  });

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

  // Lead-level fields (5)
  it("matches when lead.responsible_id equals filterId", () => {
    const item = baseItem();
    item.lead!.responsible_id = BRUNA;
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(true);
  });

  it("matches when lead.sdr_id equals filterId", () => {
    const item = baseItem();
    item.lead!.sdr_id = BRUNA;
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(true);
  });

  it("matches when lead.closer_id equals filterId", () => {
    const item = baseItem();
    item.lead!.closer_id = BRUNA;
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

  // The Alessandra Pinheiro case (org Basic4u, prod, 2026-05-18)
  // pipe_whatsapp entry: stage_key=novo, metadata.pre_sale_responsible_id=Bruna,
  //   all other responsibility fields null.
  // lead row: every responsibility FK is null.
  // Filter = Bruna's team_member.id. Must match.
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

  // Defensive shape handling — flattenMetadata always populates the entry,
  // but a missing lead can occur for ghost rows (RLS blocked the join).
  it("does not throw when lead is null", () => {
    const item: KanbanFilterableItem = {
      responsible_id: BRUNA,
      lead: null,
    };
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(true);
  });

  it("does not throw when lead is undefined", () => {
    const item: KanbanFilterableItem = { responsible_id: BRUNA };
    expect(matchesResponsibleFilter(item, BRUNA)).toBe(true);
  });

  it("does not throw when item itself is null/undefined", () => {
    expect(matchesResponsibleFilter(null, BRUNA)).toBe(false);
    expect(matchesResponsibleFilter(undefined, BRUNA)).toBe(false);
    // 'all' still wins even for null items (filter is a no-op).
    expect(matchesResponsibleFilter(null, "all")).toBe(true);
  });
});
