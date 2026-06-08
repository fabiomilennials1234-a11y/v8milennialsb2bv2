/**
 * TDD: Copilot Follow-up — Situation Catalog.
 *
 * The Torque-curated defaults (owning Archetype + default cadence + base copy)
 * for each canonical Follow-up Situation. An enabled Situation must always
 * resolve to a usable cadence, else the worker would have nothing to send.
 *
 * Slice 1 ships only proposal_no_reply; the other five Situations arrive with
 * slices 4/5/6. Final copy is curated under #743 (HITL) — these tests guard
 * the structural invariant, not the wording.
 *
 * Import target: supabase/functions/_shared/copilot/followup-catalog.ts
 */

import { describe, it, expect } from "vitest";
import "../helpers/deno-mock";

import { getSituationDefault } from "../../supabase/functions/_shared/copilot/followup-catalog.ts";

describe("getSituationDefault — proposal_no_reply", () => {
  // RED→GREEN 1 (tracer): the Situation resolves to a usable, owned cadence
  it("returns a Vendedor-owned cadence with at least one touch that has copy", () => {
    const def = getSituationDefault("proposal_no_reply");

    expect(def.archetype).toBe("vendedor");
    expect(def.steps.length).toBeGreaterThanOrEqual(1);
    for (const step of def.steps) {
      expect(step.message_template).toBeTruthy();
    }
  });
});
