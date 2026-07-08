// @vitest-environment node
/**
 * Stage Role write-back payload — pure seam of the classifier edge function
 * (U4, #991, ADR-0017 §1). The edge function reads ungoverned stages from BOTH
 * `pipeline_stages` and `custom_pipeline_stages` and writes the plan back to the
 * SAME table the row came from. The payload is table-AGNOSTIC (U1 mirrored the
 * suggestion columns onto custom_pipeline_stages), so a single builder serves
 * both. This test pins the money invariant on the WRITE side: won/lost never
 * touch `stage_role` — only `suggested_stage_role` (human confirmation pending).
 */

import { describe, it, expect } from "vitest";

const { buildStageRoleUpdate, STAGE_SOURCE_TABLES } = await import(
  "../../supabase/functions/_shared/metrics/stage-role-writeback.ts"
);

const NOW = "2026-07-08T00:00:00.000Z";

describe("STAGE_SOURCE_TABLES", () => {
  it("lists both stage tables the classifier governs", () => {
    expect(STAGE_SOURCE_TABLES).toEqual([
      "pipeline_stages",
      "custom_pipeline_stages",
    ]);
  });
});

describe("buildStageRoleUpdate — table-agnostic write-back (ADR-0017 §1)", () => {
  it("meeting_booked auto_apply → sets stage_role, never suggested_stage_role", () => {
    const u = buildStageRoleUpdate(
      { id: "x", role: "meeting_booked", action: "auto_apply", source: "deterministic" },
      NOW,
    );
    expect(u).toEqual({
      stage_role: "meeting_booked",
      stage_role_suggested_at: NOW,
      stage_role_suggestion_source: "deterministic",
    });
    expect(u).not.toHaveProperty("suggested_stage_role");
  });

  it("meeting_held auto_apply → sets stage_role", () => {
    const u = buildStageRoleUpdate(
      { id: "x", role: "meeting_held", action: "auto_apply", source: "ai" },
      NOW,
    );
    expect(u.stage_role).toBe("meeting_held");
    expect(u).not.toHaveProperty("suggested_stage_role");
  });

  it("won queue_review → sets suggested_stage_role, NEVER stage_role (money invariant)", () => {
    const u = buildStageRoleUpdate(
      { id: "x", role: "won", action: "queue_review", source: "deterministic" },
      NOW,
    );
    expect(u).toEqual({
      suggested_stage_role: "won",
      stage_role_suggested_at: NOW,
      stage_role_suggestion_source: "deterministic",
    });
    expect(u).not.toHaveProperty("stage_role");
  });

  it("lost queue_review → suggested_stage_role only, never applies stage_role", () => {
    const u = buildStageRoleUpdate(
      { id: "x", role: "lost", action: "queue_review", source: "flag" },
      NOW,
    );
    expect(u.suggested_stage_role).toBe("lost");
    expect(u).not.toHaveProperty("stage_role");
  });
});
