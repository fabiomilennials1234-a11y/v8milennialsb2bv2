import { describe, it, expect, vi } from "vitest";

// The board hook pulls in the supabase client + org context + realtime at
// import time. We only exercise the pure `sharedRpcParams` mapper, so stub the
// side-effecting deps to keep the import graph inert (same pattern as
// hooks-sprint2-pipeline-stages.test.ts).
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({
  useRealtimeSubscription: vi.fn(),
}));
vi.mock("@/modules/pipelines/hooks/model/usePipelineEntries", () => ({
  usePipelineId: vi.fn(),
  flattenMetadata: (x: unknown) => x,
}));

import {
  matchesTierFilter,
  matchesQualificationFilters,
} from "@/modules/pipelines/lib/kanbanFilterParams";
import { sharedRpcParams } from "@/modules/pipelines/hooks/model/usePaginatedPipeline";

// ─────────────────────────────────────────────────────────────────────────────
// Client-side predicate (bespoke boards: CustomPipeline + Negócios).
// Must stay byte-for-byte equivalent to the server predicate
// `l.qualification_tier::text = ANY(p_qualification_tier)` so badge == cards.
// ─────────────────────────────────────────────────────────────────────────────
describe("matchesTierFilter — parity with the server ANY(...) predicate", () => {
  it("empty selection = no filter (NULL-collapse → todos)", () => {
    expect(matchesTierFilter("ouro", [])).toBe(true);
    expect(matchesTierFilter(null, [])).toBe(true);
    expect(matchesTierFilter(undefined, [])).toBe(true);
    expect(matchesTierFilter("ouro", null)).toBe(true);
    expect(matchesTierFilter("ouro", undefined)).toBe(true);
  });

  it("string membership when a selection is active", () => {
    expect(matchesTierFilter("ouro", ["ouro", "diamante"])).toBe(true);
    expect(matchesTierFilter("diamante", ["ouro", "diamante"])).toBe(true);
    expect(matchesTierFilter("prata", ["ouro", "diamante"])).toBe(false);
    expect(matchesTierFilter("bronze", ["ouro"])).toBe(false);
  });

  it("null/undefined tier never matches a non-empty selection (like SQL NULL)", () => {
    expect(matchesTierFilter(null, ["ouro"])).toBe(false);
    expect(matchesTierFilter(undefined, ["desqualificado"])).toBe(false);
  });
});

describe("matchesQualificationFilters — qualification AND pre-qualification", () => {
  const lead = { qualification_tier: "ouro", pre_qualification_tier: "prata" };

  it("both empty → passes", () => {
    expect(matchesQualificationFilters(lead, [], [])).toBe(true);
  });

  it("qualification only", () => {
    expect(matchesQualificationFilters(lead, ["ouro"], [])).toBe(true);
    expect(matchesQualificationFilters(lead, ["diamante"], [])).toBe(false);
  });

  it("pre-qualification only", () => {
    expect(matchesQualificationFilters(lead, [], ["prata"])).toBe(true);
    expect(matchesQualificationFilters(lead, [], ["ouro"])).toBe(false);
  });

  it("both active → ANDed (both must match)", () => {
    expect(matchesQualificationFilters(lead, ["ouro"], ["prata"])).toBe(true);
    expect(matchesQualificationFilters(lead, ["ouro"], ["bronze"])).toBe(false);
    expect(matchesQualificationFilters(lead, ["prata"], ["prata"])).toBe(false);
  });

  it("null/undefined lead is excluded whenever any selection is active", () => {
    expect(matchesQualificationFilters(null, ["ouro"], [])).toBe(false);
    expect(matchesQualificationFilters(undefined, [], ["ouro"])).toBe(false);
    // …but a null lead still passes when no filter is active.
    expect(matchesQualificationFilters(null, [], [])).toBe(true);
  });

  it("lead with a null tier is excluded by a non-empty selection on that dimension", () => {
    const partial = { qualification_tier: "ouro", pre_qualification_tier: null };
    expect(matchesQualificationFilters(partial, ["ouro"], [])).toBe(true);
    expect(matchesQualificationFilters(partial, ["ouro"], ["prata"])).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Server param mapping (canonical boards). `sharedRpcParams` is the SINGLE
// source consumed by BOTH get_pipeline_stage_counts (badge) and
// get_pipeline_page (cards), so the tier predicate can't reach only one.
// ─────────────────────────────────────────────────────────────────────────────
describe("sharedRpcParams — qualification tier mapping (badge == cards)", () => {
  const base = (overrides = {}) =>
    sharedRpcParams("whatsapp" as never, "org-1", "", overrides);

  it("empty / undefined tiers collapse to null (filter disabled server-side)", () => {
    const p = base({ qualificationTier: [], preQualificationTier: [] });
    expect(p.p_qualification_tier).toBeNull();
    expect(p.p_pre_qualification_tier).toBeNull();

    const p2 = base({});
    expect(p2.p_qualification_tier).toBeNull();
    expect(p2.p_pre_qualification_tier).toBeNull();
  });

  it("non-empty tier arrays pass through verbatim", () => {
    const p = base({
      qualificationTier: ["ouro", "diamante"],
      preQualificationTier: ["prata"],
    });
    expect(p.p_qualification_tier).toEqual(["ouro", "diamante"]);
    expect(p.p_pre_qualification_tier).toEqual(["prata"]);
  });

  it("the two dimensions map independently", () => {
    const p = base({ qualificationTier: ["bronze"] });
    expect(p.p_qualification_tier).toEqual(["bronze"]);
    expect(p.p_pre_qualification_tier).toBeNull();
  });
});
