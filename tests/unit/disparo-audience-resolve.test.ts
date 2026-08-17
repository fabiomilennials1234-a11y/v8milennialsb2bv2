/**
 * audience-resolve — pure audience-selection core for the Disparos wizard (#902).
 *
 * Covers the resolver routing (none/stage/filtered/custom/all-funnels), the
 * readiness gate, the active-conditions predicate, the two independent scope
 * axes (funnel / stage) with their invariant, the breadth warning predicate,
 * the audience label, and the provenance descriptor written onto the Blast Plan.
 */
import { describe, it, expect } from "vitest";
import {
  ALL_FUNNELS_LABEL,
  ALL_STAGES_LABEL,
  applySelection,
  buildAudienceLabel,
  buildAudienceSource,
  conditionsActive,
  createDefaultSelection,
  emptyConditions,
  isBroadestSelection,
  resolverFor,
  selectionInvariantHolds,
  selectionReady,
  EMPTY_AUDIENCE_CONDITIONS,
  type AudienceSelection,
} from "@/modules/campaigns/components/disparo-wizard/audience-resolve";

function sel(over: Partial<AudienceSelection> = {}): AudienceSelection {
  return { ...createDefaultSelection(), ...over };
}

const withTag = { ...EMPTY_AUDIENCE_CONDITIONS, tagIds: ["t1"] };

describe("createDefaultSelection", () => {
  it("starts on the WhatsApp system funnel with no stage or conditions", () => {
    const d = createDefaultSelection();
    expect(d.funnelKind).toBe("system");
    expect(d.pipelineType).toBe("whatsapp");
    expect(d.pipelineId).toBeNull();
    expect(d.stageKey).toBe("");
    expect(d.stageScope).toBe("one");
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

describe("selection invariant — funnelKind 'all' implies stageScope 'all'", () => {
  it("holds for every selection applySelection can produce", () => {
    const fromSystem = applySelection(createDefaultSelection(), { funnelKind: "all" });
    expect(selectionInvariantHolds(fromSystem)).toBe(true);
    expect(fromSystem.stageScope).toBe("all");
  });

  it("clears the now-meaningless single-funnel fields", () => {
    const stale = sel({
      funnelKind: "custom",
      pipelineId: "p1",
      stageKey: "uuid-1",
      stageScope: "one",
    });
    const next = applySelection(stale, { funnelKind: "all" });
    expect(next.pipelineId).toBeNull();
    expect(next.stageKey).toBe("");
    expect(next.stageScope).toBe("all");
  });

  it("cannot be defeated by patching stageScope back to 'one'", () => {
    const next = applySelection(sel({ funnelKind: "all", stageScope: "all" }), {
      stageScope: "one",
    });
    expect(next.stageScope).toBe("all");
    expect(selectionInvariantHolds(next)).toBe(true);
  });

  it("leaves single-funnel selections untouched", () => {
    const next = applySelection(sel(), { stageKey: "novo_lead" });
    expect(next).toMatchObject({ funnelKind: "system", stageKey: "novo_lead", stageScope: "one" });
    expect(selectionInvariantHolds(next)).toBe(true);
  });

  it("flags a hand-built selection that breaks the invariant", () => {
    expect(selectionInvariantHolds(sel({ funnelKind: "all", stageScope: "one" }))).toBe(false);
  });
});

describe("resolverFor", () => {
  it("is none until a target is chosen", () => {
    expect(resolverFor(sel())).toBe("none");
    expect(resolverFor(sel({ funnelKind: "custom", pipelineId: "p1", stageKey: "" }))).toBe("none");
    expect(resolverFor(sel({ funnelKind: "custom", pipelineId: null, stageKey: "s1" }))).toBe("none");
  });

  it("routes a single system stage with no conditions to the plain stage resolver", () => {
    expect(resolverFor(sel({ stageKey: "novo_lead" }))).toBe("stage");
  });

  it("routes a narrowed system stage to the filtered resolver", () => {
    expect(resolverFor(sel({ stageKey: "novo_lead", conditions: withTag }))).toBe("filtered");
  });

  it("routes a custom pipeline stage to the custom resolver", () => {
    expect(resolverFor(sel({ funnelKind: "custom", pipelineId: "p1", stageKey: "uuid-1" }))).toBe("custom");
  });

  // ── Stage axis = "all" ────────────────────────────────────────────────────
  it("ALWAYS routes system + all stages to 'filtered', even with zero conditions", () => {
    // get_stage_lead_ids has no NULL guard on p_stage_key (bare
    // `WHERE pe.stage_key = p_stage_key`), so it cannot express "every stage".
    // Routing here to "stage" would silently resolve to ZERO leads.
    expect(resolverFor(sel({ stageScope: "all" }))).toBe("filtered");
    expect(resolverFor(sel({ stageScope: "all", stageKey: "" }))).toBe("filtered");
    expect(resolverFor(sel({ stageScope: "all", conditions: withTag }))).toBe("filtered");
    expect(resolverFor(sel({ stageScope: "all" }))).not.toBe("stage");
  });

  it("resolves a whole system funnel without any stageKey", () => {
    expect(selectionReady(sel({ stageScope: "all", stageKey: "" }))).toBe(true);
  });

  it("resolves a whole custom funnel without any stageKey", () => {
    expect(
      resolverFor(sel({ funnelKind: "custom", pipelineId: "p1", stageKey: "", stageScope: "all" })),
    ).toBe("custom");
  });

  it("still needs a custom pipeline id even with all stages", () => {
    expect(
      resolverFor(sel({ funnelKind: "custom", pipelineId: null, stageScope: "all" })),
    ).toBe("none");
  });

  // ── Funnel axis = "all" ───────────────────────────────────────────────────
  it("routes every funnel to the all-funnels resolver, with or without conditions", () => {
    const allSel = applySelection(createDefaultSelection(), { funnelKind: "all" });
    expect(resolverFor(allSel)).toBe("all-funnels");
    expect(resolverFor({ ...allSel, conditions: withTag })).toBe("all-funnels");
  });

  it("is always resolvable for every funnel — no stage or pipeline needed", () => {
    expect(selectionReady(applySelection(createDefaultSelection(), { funnelKind: "all" }))).toBe(true);
  });

  it("ignores a stale stageScope on a hand-built all-funnels selection", () => {
    // Defensive: applySelection normalizes, but resolverFor must not trust it.
    expect(resolverFor(sel({ funnelKind: "all", stageScope: "one", stageKey: "novo_lead" }))).toBe(
      "all-funnels",
    );
  });
});

describe("selectionReady", () => {
  it("mirrors resolverFor !== none", () => {
    expect(selectionReady(sel())).toBe(false);
    expect(selectionReady(sel({ stageKey: "novo_lead" }))).toBe(true);
    expect(selectionReady(sel({ funnelKind: "custom", pipelineId: "p1", stageKey: "uuid" }))).toBe(true);
    expect(selectionReady(sel({ funnelKind: "custom", pipelineId: null }))).toBe(false);
  });
});

describe("isBroadestSelection", () => {
  it("is true only for every funnel with zero narrowing", () => {
    const allSel = applySelection(createDefaultSelection(), { funnelKind: "all" });
    expect(isBroadestSelection(allSel)).toBe(true);
  });

  it("is false once any condition narrows the union", () => {
    const allSel = applySelection(createDefaultSelection(), {
      funnelKind: "all",
      conditions: withTag,
    });
    expect(isBroadestSelection(allSel)).toBe(false);
  });

  it("is false for a single whole funnel — that is not the broadest target", () => {
    expect(isBroadestSelection(sel({ stageScope: "all" }))).toBe(false);
    expect(
      isBroadestSelection(sel({ funnelKind: "custom", pipelineId: "p1", stageScope: "all" })),
    ).toBe(false);
  });
});

describe("buildAudienceLabel", () => {
  it("names the union as funnel · stage for every funnel, ignoring the passed labels", () => {
    // Keeps the `funil · etapa` symmetry the operator already read on screen and
    // states that no stage narrowed the target — the label persists on the draft
    // and travels to Revisão / Blast Plan without access to the selection.
    const allSel = applySelection(createDefaultSelection(), { funnelKind: "all" });
    expect(buildAudienceLabel(allSel, "Oportunidades", "Novo lead")).toBe(
      `${ALL_FUNNELS_LABEL} · ${ALL_STAGES_LABEL}`,
    );
  });

  it("names the whole funnel when the stage axis is all", () => {
    expect(buildAudienceLabel(sel({ stageScope: "all" }), "Oportunidades", "")).toBe(
      `Oportunidades · ${ALL_STAGES_LABEL}`,
    );
  });

  it("names funnel · stage for a single stage", () => {
    expect(buildAudienceLabel(sel({ stageKey: "novo_lead" }), "Oportunidades", "Novo lead")).toBe(
      "Oportunidades · Novo lead",
    );
  });

  it("falls back to the funnel alone when the stage name has not loaded", () => {
    expect(buildAudienceLabel(sel({ stageKey: "novo_lead" }), "Oportunidades", "")).toBe(
      "Oportunidades",
    );
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
      funnelScope: "one",
      stageScope: "one",
    });
    expect(src.conditions).toBeUndefined();
  });

  it("records the custom pipeline id and active conditions", () => {
    const conditions = { ...EMPTY_AUDIENCE_CONDITIONS, origin: ["site"] };
    const src = buildAudienceSource(
      sel({ funnelKind: "custom", pipelineId: "p1", stageKey: "uuid", conditions }),
    );
    expect(src).toMatchObject({
      funnelKind: "custom",
      pipelineId: "p1",
      stageKey: "uuid",
      funnelScope: "one",
      stageScope: "one",
    });
    expect(src.conditions).toEqual(conditions);
    expect(src.pipelineType).toBeUndefined();
  });

  it("records the whole-funnel stage scope", () => {
    const src = buildAudienceSource(sel({ pipelineType: "whatsapp", stageScope: "all" }));
    expect(src).toMatchObject({
      funnelKind: "system",
      pipelineType: "whatsapp",
      funnelScope: "one",
      stageScope: "all",
      stageKey: "",
    });
  });

  it("records the cross-funnel union with neither pipelineType nor pipelineId", () => {
    const allSel = applySelection(createDefaultSelection(), {
      funnelKind: "all",
      conditions: { ...emptyConditions(), tagIds: ["t1"] },
    });
    const src = buildAudienceSource(allSel);
    expect(src).toMatchObject({
      context: "disparo",
      source: "estagio",
      funnelKind: "all",
      funnelScope: "all",
      stageScope: "all",
      stageKey: "",
    });
    expect(src.pipelineType).toBeUndefined();
    expect(src.pipelineId).toBeUndefined();
    expect(src.conditions).toEqual({ ...EMPTY_AUDIENCE_CONDITIONS, tagIds: ["t1"] });
  });

  it("is purely ADDITIVE — every pre-existing key keeps its name", () => {
    // Descriptors written before the two scope axes existed must stay parseable:
    // this guards against a rename/removal, not against new keys.
    const src = buildAudienceSource(sel({ pipelineType: "propostas", stageKey: "enviada" }));
    for (const key of ["context", "source", "funnelKind", "stageKey", "pipelineType"]) {
      expect(Object.keys(src)).toContain(key);
    }
  });
});
