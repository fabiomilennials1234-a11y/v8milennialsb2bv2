/**
 * TDD: Copilot Follow-up — Stop Evaluator.
 *
 * Pure logic. Given a domain event on a Lead with an active cadence, decide
 * whether the cadence stops and why (the completed_reason). The reasons map to
 * copilot_followup_step_log.completed_reason. The edge ingestion path feeds the
 * events; this module owns the rules (ADR-0006).
 *
 * Import target: supabase/functions/_shared/copilot/followup-stop.ts
 */

import { describe, it, expect } from "vitest";
import "../helpers/deno-mock";

import { evaluateStop } from "../../supabase/functions/_shared/copilot/followup-stop.ts";

describe("evaluateStop", () => {
  // RED→GREEN 1 (tracer): a Lead reply stops the cadence
  it("stops on a lead reply", () => {
    const r = evaluateStop({ type: "lead_reply" });
    expect(r.stop).toBe(true);
    expect(r.reason).toBe("lead_responded");
  });

  // RED→GREEN 2 — a human teammate reply CANCELS (not just pauses)
  it("stops (cancels) when the owning human replies", () => {
    const r = evaluateStop({ type: "human_reply" });
    expect(r.stop).toBe(true);
    expect(r.reason).toBe("human_replied");
  });

  // RED→GREEN 3 — opt-out
  it("stops on opt-out", () => {
    expect(evaluateStop({ type: "opt_out" })).toEqual({ stop: true, reason: "manual_stop" });
  });

  // RED→GREEN 4 — owner/archetype handoff kills the old cadence
  it("stops when the Lead's owner changes", () => {
    expect(evaluateStop({ type: "owner_change" })).toEqual({ stop: true, reason: "owner_changed" });
  });

  // RED→GREEN 5 — stage change OUT of the trigger set resolves the situation
  it("stops when the Lead leaves the trigger stage set", () => {
    expect(evaluateStop({ type: "stage_change", stillInTriggerSet: false }))
      .toEqual({ stop: true, reason: "situation_resolved" });
  });

  // RED→GREEN 6 — stage change still inside the trigger set: keep going
  it("continues when a stage change stays within the trigger set", () => {
    expect(evaluateStop({ type: "stage_change", stillInTriggerSet: true }))
      .toEqual({ stop: false, reason: null });
  });
});
