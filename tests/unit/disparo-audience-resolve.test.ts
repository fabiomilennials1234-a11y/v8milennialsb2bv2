/**
 * audience-resolve — pure audience-selection core for the Disparos wizard (#902).
 *
 * Covers the resolver routing (none/stage/filtered/custom), the readiness gate,
 * the active-conditions predicate, and the provenance descriptor written onto
 * the Blast Plan.
 */
import { describe, it, expect } from "vitest";
import {
  conditionsActive,
  resolverFor,
  selectionReady,
  buildAudienceSource,
  createDefaultSelection,
  EMPTY_AUDIENCE_CONDITIONS,
  type AudienceSelection,
} from "@/modules/campaigns/components/disparo-wizard/audience-resolve";

function sel(over: Partial<AudienceSelection> = {}): AudienceSelection {
  return { ...createDefaultSelection(), ...over };
}

describe("createDefaultSelection", () => {
  it("starts on the WhatsApp system funnel with no stage or conditions", () => {
    const d = createDefaultSelection();
    expect(d.funnelKind).toBe("system");
    expect(d.pipelineType).toBe("whatsapp");
    expect(d.pipelineId).toBeNull();
    expect(d.stageKey).toBe("");
    expect(conditionsActive(d.conditions)).toBe(false);
  });

  it("returns an independent conditions object (no shared mutation)", () => {
    const a = createDefaultSelection();
    a.conditions.tagIds.push("x");
    expect(createDefaultSelection().conditions.tagIds).toEqual([]);
    expect(EMPTY_AUDIENCE_CONDITIONS.tagIds).toEqual([]);
  });
});

describe("conditionsActive", () => {
  it("is false when every list is empty", () => {
    expect(conditionsActive(EMPTY_AUDIENCE_CONDITIONS)).toBe(false);
  });
  it("is true when any narrowing list has an entry", () => {
    expect(conditionsActive({ ...EMPTY_AUDIENCE_CONDITIONS, tagIds: ["t1"] })).toBe(true);
    expect(conditionsActive({ ...EMPTY_AUDIENCE_CONDITIONS, origin: ["site"] })).toBe(true);
    expect(conditionsActive({ ...EMPTY_AUDIENCE_CONDITIONS, qualificationTier: ["ouro"] })).toBe(true);
    expect(conditionsActive({ ...EMPTY_AUDIENCE_CONDITIONS, preQualificationTier: ["ouro"] })).toBe(true);
  });
});

describe("resolverFor", () => {
  it("is none until a target is chosen", () => {
    expect(resolverFor(sel())).toBe("none");
    expect(resolverFor(sel({ funnelKind: "custom", pipelineId: "p1", stageKey: "" }))).toBe("none");
    expect(resolverFor(sel({ funnelKind: "custom", pipelineId: null, stageKey: "s1" }))).toBe("none");
  });

  it("routes a system stage with no conditions to the plain stage resolver", () => {
    expect(resolverFor(sel({ stageKey: "novo_lead" }))).toBe("stage");
  });

  it("routes a narrowed system stage to the filtered resolver", () => {
    expect(
      resolverFor(sel({ stageKey: "novo_lead", conditions: { ...EMPTY_AUDIENCE_CONDITIONS, tagIds: ["t1"] } })),
    ).toBe("filtered");
  });

  it("routes a custom pipeline stage to the custom resolver", () => {
    expect(resolverFor(sel({ funnelKind: "custom", pipelineId: "p1", stageKey: "uuid-1" }))).toBe("custom");
  });
});

describe("selectionReady", () => {
  it("mirrors resolverFor !== none", () => {
    expect(selectionReady(sel())).toBe(false);
    expect(selectionReady(sel({ stageKey: "novo_lead" }))).toBe(true);
    expect(selectionReady(sel({ funnelKind: "custom", pipelineId: "p1", stageKey: "uuid" }))).toBe(true);
  });
});

describe("buildAudienceSource", () => {
  it("records the system funnel + stage provenance", () => {
    const src = buildAudienceSource(sel({ pipelineType: "propostas", stageKey: "enviada" }));
    expect(src).toMatchObject({
      context: "disparo",
      source: "estagio",
      funnelKind: "system",
      pipelineType: "propostas",
      stageKey: "enviada",
    });
    expect(src.conditions).toBeUndefined();
  });

  it("records the custom pipeline id and active conditions", () => {
    const conditions = { ...EMPTY_AUDIENCE_CONDITIONS, origin: ["site"] };
    const src = buildAudienceSource(
      sel({ funnelKind: "custom", pipelineId: "p1", stageKey: "uuid", conditions }),
    );
    expect(src).toMatchObject({ funnelKind: "custom", pipelineId: "p1", stageKey: "uuid" });
    expect(src.conditions).toEqual(conditions);
    expect(src.pipelineType).toBeUndefined();
  });
});
