/**
 * TDD: Copilot Follow-up — decision orchestrator.
 *
 * Pure composition of Situation Resolver + Catalog + Cadence Stepper. The
 * worker's brain: given a Lead's state and cadence progress, decide whether to
 * send the next touch and which. No DB, no side effects.
 *
 * First touch is gated by the situation's initial delay; subsequent touches are
 * gated by the Stepper (per-step delay), while the resolver keeps confirming the
 * situation still structurally holds.
 *
 * Import target: supabase/functions/_shared/copilot/followup-decide.ts
 */

import { describe, it, expect } from "vitest";
import "../helpers/deno-mock";

import { decideFollowup } from "../../supabase/functions/_shared/copilot/followup-decide.ts";
import type { EnabledSituation, SituationLeadState } from "../../supabase/functions/_shared/copilot/followup-situations.ts";
import type { StepLogEntry } from "../../supabase/functions/_shared/copilot/followup-cadence.ts";

const NOW = new Date("2026-06-08T12:00:00Z");
const ENABLED: EnabledSituation[] = [
  { situationId: "proposal_no_reply", delayHours: 24, delayMinutes: 0 },
];

describe("decideFollowup — proposal_no_reply", () => {
  // RED→GREEN 1 (tracer): fresh eligible Lead, no cadence yet → send touch 1
  it("sends the first touch for a fresh eligible Lead", () => {
    const lead: SituationLeadState = {
      propostasStage: "enviada",
      lastOutboundAt: "2026-06-07T08:00:00Z", // 28h ago > 24h
      lastInboundAt: null,
    };

    const decision = decideFollowup({ enabled: ENABLED, lead, stepLog: null, now: NOW });

    expect(decision.send).toBe(true);
    if (decision.send) {
      expect(decision.situationId).toBe("proposal_no_reply");
      expect(decision.step.order).toBe(1);
    }
  });

  // RED→GREEN 2 — running cadence, next step's delay not yet elapsed
  it("does not send when the running cadence's next-step delay has not elapsed", () => {
    const lead: SituationLeadState = {
      propostasStage: "enviada",
      lastOutboundAt: "2026-06-08T11:00:00Z", // our touch 1 just went out
      lastInboundAt: null,
    };
    const stepLog: StepLogEntry = {
      rule_id: "r1",
      lead_id: "l1",
      current_step: 1,
      last_step_sent_at: "2026-06-08T11:00:00Z", // 1h ago; touch 2 delay is 48h
      completed: false,
    };

    const decision = decideFollowup({ enabled: ENABLED, lead, stepLog, now: NOW });

    expect(decision.send).toBe(false);
  });

  // RED→GREEN 3 — situation resolved mid-cadence: resolver gates even with a log
  it("does not send when the situation no longer holds mid-cadence", () => {
    const lead: SituationLeadState = {
      propostasStage: "vendido", // closed since touch 1
      lastOutboundAt: "2026-06-06T08:00:00Z",
      lastInboundAt: null,
    };
    const stepLog: StepLogEntry = {
      rule_id: "r1",
      lead_id: "l1",
      current_step: 1,
      last_step_sent_at: "2026-06-06T08:00:00Z", // touch 2 delay long elapsed
      completed: false,
    };

    const decision = decideFollowup({ enabled: ENABLED, lead, stepLog, now: NOW });

    expect(decision.send).toBe(false);
  });

  // RED→GREEN 4 — cadence already completed
  it("does not send when the cadence is completed", () => {
    const lead: SituationLeadState = {
      propostasStage: "enviada",
      lastOutboundAt: "2026-06-01T08:00:00Z",
      lastInboundAt: null,
    };
    const stepLog: StepLogEntry = {
      rule_id: "r1",
      lead_id: "l1",
      current_step: 3,
      last_step_sent_at: "2026-06-05T08:00:00Z",
      completed: true,
    };

    const decision = decideFollowup({ enabled: ENABLED, lead, stepLog, now: NOW });

    expect(decision.send).toBe(false);
  });
});
