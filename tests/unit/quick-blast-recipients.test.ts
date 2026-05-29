// @vitest-environment node
/**
 * buildRecipients — Quick Blast recipient builder (Module B).
 *
 * Pure: turns selected leads + a message template into a normalized, deduped,
 * capped recipient list, reporting why anyone was dropped. Slice 1 keeps the
 * message a passthrough template (variables/spintax arrive in later slices).
 */

import { describe, it, expect } from "vitest";

const { buildRecipients } = await import(
  "../../supabase/functions/_shared/quick-blast/recipients.ts"
);

const lead = (id: string, phone: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Lead ${id}`,
  company: `Co ${id}`,
  phone,
  ...extra,
});

describe("buildRecipients — phone filtering", () => {
  it("excludes leads without a valid phone and counts them", () => {
    const out = buildRecipients(
      [lead("a", "11999990001"), lead("b", null), lead("c", "")],
      { template: "Oi", cap: 100 },
    );
    expect(out.recipients).toHaveLength(1);
    expect(out.recipients[0].leadId).toBe("a");
    expect(out.skipped.noPhone).toBe(2);
  });
});

describe("buildRecipients — dedup by normalized phone", () => {
  it("collapses leads sharing a normalized phone, keeping the first", () => {
    const out = buildRecipients(
      [
        lead("a", "11999990001"),
        lead("b", "5511999990001"), // same number, with country code
        lead("c", "11999990002"),
      ],
      { template: "Oi", cap: 100 },
    );
    expect(out.recipients.map((r) => r.leadId)).toEqual(["a", "c"]);
    expect(out.skipped.duplicates).toBe(1);
  });
});

describe("buildRecipients — cap enforcement", () => {
  it("truncates valid recipients to the cap and counts the overflow", () => {
    const leads = Array.from({ length: 5 }, (_, i) => lead(String(i), `1199999000${i}`));
    const out = buildRecipients(leads, { template: "Oi", cap: 3 });
    expect(out.recipients).toHaveLength(3);
    expect(out.recipients.map((r) => r.leadId)).toEqual(["0", "1", "2"]);
    expect(out.skipped.overCap).toBe(2);
  });

  it("counts overCap only against valid recipients, after phone/dedup filtering", () => {
    const out = buildRecipients(
      [
        lead("a", "11999990001"),
        lead("b", null), // dropped: no phone, not overCap
        lead("c", "5511999990001"), // dropped: duplicate, not overCap
        lead("d", "11999990002"),
        lead("e", "11999990003"),
      ],
      { template: "Oi", cap: 1 },
    );
    expect(out.recipients.map((r) => r.leadId)).toEqual(["a"]);
    expect(out.skipped.noPhone).toBe(1);
    expect(out.skipped.duplicates).toBe(1);
    expect(out.skipped.overCap).toBe(2); // d + e
  });
});

describe("buildRecipients — image attachment", () => {
  it("emits image recipients with resolved text as caption when imageUrl is set", () => {
    const out = buildRecipients(
      [{ id: "a", name: "Ana", company: "Co", phone: "11999990001" }],
      { template: "Oi {primeiro_nome}", cap: 10, imageUrl: "https://cdn/x.jpg" },
    );
    const r = out.recipients[0];
    expect(r.type).toBe("image");
    expect(r.file).toBe("https://cdn/x.jpg");
    expect(r.caption).toBe("Oi Ana");
  });

  it("emits plain text recipients (no type/file) when imageUrl is absent", () => {
    const out = buildRecipients(
      [{ id: "a", name: "Ana", company: "Co", phone: "11999990001" }],
      { template: "Oi {primeiro_nome}", cap: 10 },
    );
    const r = out.recipients[0];
    expect(r.text).toBe("Oi Ana");
    expect(r.type).toBeUndefined();
    expect(r.file).toBeUndefined();
  });
});

describe("buildRecipients — per-recipient variable resolution", () => {
  it("resolves lead + carteira variables into each recipient's text", () => {
    const out = buildRecipients(
      [
        {
          id: "a",
          name: "Pedro Silva",
          company: "SacoEcoMulti",
          phone: "11999990001",
          segment: "ouro",
          days_since_last_order: 30,
        },
      ],
      { template: "Oi {primeiro_nome} da {empresa}, {segmento}, {dias_sem_pedido} dias", cap: 10 },
    );
    expect(out.recipients[0].text).toBe("Oi Pedro da SacoEcoMulti, ouro, 30 dias");
  });

  it("renders carteira variables empty when the lead has no portfolio data", () => {
    const out = buildRecipients(
      [{ id: "a", name: "Ana", company: "Co", phone: "11999990001" }],
      { template: "{primeiro_nome} [{segmento}]", cap: 10 },
    );
    expect(out.recipients[0].text).toBe("Ana []");
  });
});
