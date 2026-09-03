/**
 * audience-resolve — pure audience-selection core for the Disparos wizard (#902).
 *
 * Fatia B (Funil é Funil): o eixo system/custom morreu — a seleção aponta pra
 * UM funil qualquer por `pipelineId` e a etapa é `pipeline_stages.id`. Covers
 * the resolver routing (none/pipeline/all-funnels), the readiness gate, the
 * active-conditions predicate, the two independent scope axes (funnel / stage)
 * with their invariant, the breadth warning predicate, the audience label, and
 * the provenance descriptor written onto the Blast Plan.
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

const P1 = "0f0e0d0c-0b0a-4a4b-8c8d-9e9f00010203";
const S1 = "11111111-2222-4333-8444-555566667777";

function sel(over: Partial<AudienceSelection> = {}): AudienceSelection {
  return { ...createDefaultSelection(), ...over };
}

const withTag = { ...EMPTY_AUDIENCE_CONDITIONS, tagIds: ["t1"] };

describe("createDefaultSelection", () => {
  it("starts with no funnel, stage or conditions chosen (the screen seeds the org's first funnel)", () => {
    const d = createDefaultSelection();
    expect(d.funnelScope).toBe("one");
    expect(d.pipelineId).toBeNull();
    expect(d.stageId).toBe("");
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

describe("selection invariant — funnelScope 'all' implies stageScope 'all'", () => {
  it("holds for every selection applySelection can produce", () => {
    const next = applySelection(createDefaultSelection(), { funnelScope: "all" });
    expect(selectionInvariantHolds(next)).toBe(true);
    expect(next.stageScope).toBe("all");
  });

  it("clears the now-meaningless single-funnel fields", () => {
    const stale = sel({ pipelineId: P1, stageId: S1, stageScope: "one" });
    const next = applySelection(stale, { funnelScope: "all" });
    expect(next.pipelineId).toBeNull();
    expect(next.stageId).toBe("");
    expect(next.stageScope).toBe("all");
  });

  it("cannot be defeated by patching stageScope back to 'one'", () => {
    const next = applySelection(sel({ funnelScope: "all", stageScope: "all" }), {
      stageScope: "one",
    });
    expect(next.stageScope).toBe("all");
    expect(selectionInvariantHolds(next)).toBe(true);
  });

  it("leaves single-funnel selections untouched", () => {
    const next = applySelection(sel({ pipelineId: P1 }), { stageId: S1 });
    expect(next).toMatchObject({ funnelScope: "one", pipelineId: P1, stageId: S1, stageScope: "one" });
    expect(selectionInvariantHolds(next)).toBe(true);
  });

  it("flags a hand-built selection that breaks the invariant", () => {
    expect(selectionInvariantHolds(sel({ funnelScope: "all", stageScope: "one" }))).toBe(false);
  });
});

describe("resolverFor", () => {
  it("is none until a target is chosen", () => {
    expect(resolverFor(sel())).toBe("none");
    expect(resolverFor(sel({ pipelineId: P1, stageId: "" }))).toBe("none");
    expect(resolverFor(sel({ pipelineId: null, stageId: S1 }))).toBe("none");
  });

  it("routes a chosen funnel + stage to the single pipeline resolver — any funnel type", () => {
    expect(resolverFor(sel({ pipelineId: P1, stageId: S1 }))).toBe("pipeline");
  });

  it("routes a narrowed stage to the SAME resolver — conditions ride along", () => {
    expect(resolverFor(sel({ pipelineId: P1, stageId: S1, conditions: withTag }))).toBe("pipeline");
  });

  // ── Stage axis = "all" ────────────────────────────────────────────────────
  it("resolves a whole funnel without any stageId (p_stage_id NULL = every stage)", () => {
    expect(resolverFor(sel({ pipelineId: P1, stageScope: "all" }))).toBe("pipeline");
    expect(resolverFor(sel({ pipelineId: P1, stageScope: "all", conditions: withTag }))).toBe("pipeline");
    expect(selectionReady(sel({ pipelineId: P1, stageScope: "all", stageId: "" }))).toBe(true);
  });

  it("still needs a pipeline id even with all stages", () => {
    expect(resolverFor(sel({ pipelineId: null, stageScope: "all" }))).toBe("none");
  });

  // ── Funnel axis = "all" ───────────────────────────────────────────────────
  it("routes every funnel to the all-funnels resolver, with or without conditions", () => {
    const allSel = applySelection(createDefaultSelection(), { funnelScope: "all" });
    expect(resolverFor(allSel)).toBe("all-funnels");
    expect(resolverFor({ ...allSel, conditions: withTag })).toBe("all-funnels");
  });

  it("is always resolvable for every funnel — no stage or pipeline needed", () => {
    expect(selectionReady(applySelection(createDefaultSelection(), { funnelScope: "all" }))).toBe(true);
  });

  it("ignores a stale stageScope on a hand-built all-funnels selection", () => {
    // Defensive: applySelection normalizes, but resolverFor must not trust it.
    expect(resolverFor(sel({ funnelScope: "all", stageScope: "one", stageId: S1 }))).toBe(
      "all-funnels",
    );
  });
});

describe("selectionReady", () => {
  it("mirrors resolverFor !== none", () => {
    expect(selectionReady(sel())).toBe(false);
    expect(selectionReady(sel({ pipelineId: P1, stageId: S1 }))).toBe(true);
    expect(selectionReady(sel({ pipelineId: null }))).toBe(false);
  });
});

describe("isBroadestSelection", () => {
  it("is true only for every funnel with zero narrowing", () => {
    const allSel = applySelection(createDefaultSelection(), { funnelScope: "all" });
    expect(isBroadestSelection(allSel)).toBe(true);
  });

  it("is false once any condition narrows the union", () => {
    const allSel = applySelection(createDefaultSelection(), {
      funnelScope: "all",
      conditions: withTag,
    });
    expect(isBroadestSelection(allSel)).toBe(false);
  });

  it("is false for a single whole funnel — that is not the broadest target", () => {
    expect(isBroadestSelection(sel({ pipelineId: P1, stageScope: "all" }))).toBe(false);
  });
});

describe("buildAudienceLabel", () => {
  it("names the union as funnel · stage for every funnel, ignoring the passed labels", () => {
    // Keeps the `funil · etapa` symmetry the operator already read on screen and
    // states that no stage narrowed the target — the label persists on the draft
    // and travels to Revisão / Blast Plan without access to the selection.
    const allSel = applySelection(createDefaultSelection(), { funnelScope: "all" });
    expect(buildAudienceLabel(allSel, "Oportunidades", "Novo lead")).toBe(
      `${ALL_FUNNELS_LABEL} · ${ALL_STAGES_LABEL}`,
    );
  });

  it("names the whole funnel when the stage axis is all", () => {
    expect(buildAudienceLabel(sel({ pipelineId: P1, stageScope: "all" }), "Oportunidades", "")).toBe(
      `Oportunidades · ${ALL_STAGES_LABEL}`,
    );
  });

  it("names funnel · stage for a single stage", () => {
    expect(buildAudienceLabel(sel({ pipelineId: P1, stageId: S1 }), "Oportunidades", "Novo lead")).toBe(
      "Oportunidades · Novo lead",
    );
  });

  it("falls back to the funnel alone when the stage name has not loaded", () => {
    expect(buildAudienceLabel(sel({ pipelineId: P1, stageId: S1 }), "Oportunidades", "")).toBe(
      "Oportunidades",
    );
  });

  it("appends the active-conditions suffix", () => {
    expect(
      buildAudienceLabel(
        sel({ pipelineId: P1, stageId: S1, conditions: withTag }),
        "Oportunidades",
        "Novo lead",
      ),
    ).toBe("Oportunidades · Novo lead · 1 condição");
  });
});

describe("buildAudienceSource", () => {
  it("records the funnel + stage provenance by canonical ids", () => {
    const src = buildAudienceSource(sel({ pipelineId: P1, stageId: S1 }));
    expect(src).toMatchObject({
      context: "disparo",
      source: "estagio",
      pipelineId: P1,
      stageId: S1,
      funnelScope: "one",
      stageScope: "one",
    });
    expect(src.conditions).toBeUndefined();
  });

  it("records active conditions", () => {
    const conditions = { ...EMPTY_AUDIENCE_CONDITIONS, origin: ["site"] };
    const src = buildAudienceSource(sel({ pipelineId: P1, stageId: S1, conditions }));
    expect(src.conditions).toEqual(conditions);
  });

  it("records the whole-funnel stage scope without a stageId", () => {
    const src = buildAudienceSource(sel({ pipelineId: P1, stageScope: "all" }));
    expect(src).toMatchObject({
      pipelineId: P1,
      funnelScope: "one",
      stageScope: "all",
    });
    expect(src.stageId).toBeUndefined();
  });

  it("records the cross-funnel union with no pipelineId — the union has no funnel identity", () => {
    const allSel = applySelection(createDefaultSelection(), {
      funnelScope: "all",
      conditions: { ...emptyConditions(), tagIds: ["t1"] },
    });
    const src = buildAudienceSource(allSel);
    expect(src).toMatchObject({
      context: "disparo",
      source: "estagio",
      funnelScope: "all",
      stageScope: "all",
    });
    expect(src.pipelineId).toBeUndefined();
    expect(src.stageId).toBeUndefined();
    expect(src.conditions).toEqual({ ...EMPTY_AUDIENCE_CONDITIONS, tagIds: ["t1"] });
  });

  it("keeps the stable keys readers rely on — context/source/scopes never rename", () => {
    // Planos antigos gravaram funnelKind/pipelineType/stageKey; esses ficam
    // ACEITOS NA LEITURA pelos leitores. As chaves que o writer novo emite têm
    // de permanecer estáveis daqui pra frente.
    const src = buildAudienceSource(sel({ pipelineId: P1, stageId: S1 }));
    for (const key of ["context", "source", "funnelScope", "stageScope", "pipelineId", "stageId"]) {
      expect(Object.keys(src)).toContain(key);
    }
  });
});
