// @vitest-environment node
/**
 * SpreadsheetUpserter — pure partition of an uploaded list (ADR-0014, #906).
 *
 * A spreadsheet blast source upserts Leads keyed by canonical phone: a match is
 * dispatched as-is (never overwritten), a non-match creates a Lead, a row with
 * no usable phone is invalid (reported, not sent), and duplicate phones within
 * the file collapse to a single send. This module is the pure, IO-free decision
 * — it partitions mapped rows against the existing Leads; persistence/dispatch
 * happen downstream. Phone keying reuses the canonical normalizer (no local copy).
 */

import { describe, it, expect } from "vitest";

const { partitionSpreadsheet } = await import(
  "../../supabase/functions/_shared/quick-blast/spreadsheet-upsert.ts"
);

describe("partitionSpreadsheet — new contacts", () => {
  it("routes a valid phone with no existing match to toCreate", () => {
    const result = partitionSpreadsheet(
      [{ phone: "11987654321", name: "João" }],
      [],
    );

    expect(result.toCreate).toHaveLength(1);
    expect(result.toCreate[0].normalizedPhone).toBe("11987654321");
    expect(result.toCreate[0].row.name).toBe("João");
    expect(result.matched).toEqual([]);
    expect(result.invalid).toEqual([]);
    expect(result.duplicates).toEqual([]);
  });
});

describe("partitionSpreadsheet — existing contacts", () => {
  it("routes a phone matching an existing Lead to matched, carrying the lead id", () => {
    const result = partitionSpreadsheet(
      [{ phone: "11987654321", name: "João da Planilha" }],
      [{ id: "lead-1", normalizedPhone: "11987654321" }],
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].leadId).toBe("lead-1");
    expect(result.toCreate).toEqual([]);
  });

  it("matches across formatting variants of the same number", () => {
    const result = partitionSpreadsheet(
      [{ phone: "+55 (11) 98765-4321" }], // same number, different rendering
      [{ id: "lead-1", normalizedPhone: "11987654321" }],
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].leadId).toBe("lead-1");
    expect(result.toCreate).toEqual([]);
  });
});

describe("partitionSpreadsheet — invalid and duplicate rows", () => {
  it("routes a row with no usable phone to invalid (not sent)", () => {
    const result = partitionSpreadsheet(
      [
        { phone: "", name: "Sem telefone" },
        { phone: "abc", name: "Lixo" },
      ],
      [],
    );

    expect(result.invalid).toHaveLength(2);
    expect(result.toCreate).toEqual([]);
    expect(result.matched).toEqual([]);
  });

  it("collapses an in-file duplicate phone to a single send (extras → duplicates)", () => {
    const result = partitionSpreadsheet(
      [
        { phone: "11987654321", name: "Primeira" },
        { phone: "+55 11 98765-4321", name: "Mesma, outro formato" },
        { phone: "11987654321", name: "Terceira" },
      ],
      [],
    );

    expect(result.toCreate).toHaveLength(1);
    expect(result.toCreate[0].row.name).toBe("Primeira"); // first wins
    expect(result.duplicates).toHaveLength(2);
  });
});
