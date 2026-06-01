/**
 * validate-activation.test.ts
 *
 * TDD for PRD #544 / Slice #548 — the finalize gate. Hard checks block
 * activation (mirroring the Playground's existing save validation); soft
 * checks (behavior coverage, uncovered backbone topics) only warn.
 */

import { describe, it, expect } from "vitest";
import { createDefaultPlaygroundData } from "@/modules/copilot/components/playground/types";
import {
  validateForActivation,
  BACKBONE_TOPICS,
} from "@/modules/copilot/lib/validate-activation";

describe("validateForActivation", () => {
  it("blocks activation when the name is empty", () => {
    const result = validateForActivation(createDefaultPlaygroundData());

    expect(result.missingHard).toContain("name");
    expect(result.ok).toBe(false);
  });

  it("blocks activation when prompt content is too short", () => {
    const data = createDefaultPlaygroundData();
    data.name = "Bruno";

    const result = validateForActivation(data);

    expect(result.missingHard).toContain("prompt");
    expect(result.ok).toBe(false);
  });

  it("passes hard checks when name and a real prompt section are set", () => {
    const data = createDefaultPlaygroundData();
    data.name = "Bruno";
    data.promptSections.objective = "Qualificar leads B2B de embalagens plásticas.";

    const result = validateForActivation(data);

    expect(result.missingHard).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("warns (soft) on incomplete behavior coverage without blocking", () => {
    const data = createDefaultPlaygroundData();
    data.name = "Bruno";
    data.promptSections.objective = "Qualificar leads B2B de embalagens plásticas.";
    data.behaviorWindows = []; // no time coverage at all

    const result = validateForActivation(data);

    expect(result.missingSoft).toContain("behavior_windows");
    expect(result.ok).toBe(true); // soft never blocks
  });

  it("lists uncovered backbone topics as soft", () => {
    const data = createDefaultPlaygroundData();
    data.name = "Bruno";
    data.promptSections.objective = "Qualificar leads B2B de embalagens plásticas.";

    const covered = ["identity", "business", "icp", "objective"];
    const result = validateForActivation(data, covered);

    expect(result.missingSoft).toContain("topic:flow");
    expect(result.missingSoft).toContain("topic:guardrails");
    expect(result.missingSoft).not.toContain("topic:objective");
    expect(result.ok).toBe(true);
  });

  it("reports no uncovered topics when all backbone topics are covered", () => {
    const data = createDefaultPlaygroundData();
    data.name = "Bruno";
    data.promptSections.objective = "Qualificar leads B2B de embalagens plásticas.";

    const result = validateForActivation(data, [...BACKBONE_TOPICS]);

    expect(result.missingSoft.filter((m) => m.startsWith("topic:"))).toEqual([]);
  });
});
