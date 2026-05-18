/**
 * TDD: Copilot follow-up cadence engine + trigger matching.
 *
 * Pure functions — no DB, no mocks needed.
 * Import target: supabase/functions/_shared/copilot/followup-cadence.ts
 *                supabase/functions/_shared/copilot/followup-triggers.ts
 */

import { describe, it, expect } from "vitest";
import "../helpers/deno-mock";

import {
  getNextCadenceStep,
  type CadenceStep,
  type StepLogEntry,
} from "../../supabase/functions/_shared/copilot/followup-cadence.ts";

// ---------------------------------------------------------------------------
// getNextCadenceStep
// ---------------------------------------------------------------------------

const STEPS: CadenceStep[] = [
  { order: 1, delay_hours: 0, delay_minutes: 0, style: "gentle", message_template: "Oi {nome}!" },
  { order: 2, delay_hours: 24, delay_minutes: 0, style: "assertive", message_template: null },
  { order: 3, delay_hours: 48, delay_minutes: 30, style: "closing", message_template: "Ultima chance {nome}" },
];

const NOW = new Date("2026-05-18T12:00:00Z");

describe("getNextCadenceStep", () => {
  // RED→GREEN 1
  it("fires step 1 when no stepLog exists", () => {
    const result = getNextCadenceStep({
      sequenceSteps: STEPS,
      stepLog: null,
      now: NOW,
    });

    expect(result.shouldFire).toBe(true);
    expect(result.step).toEqual(STEPS[0]);
    expect(result.reason).toBe("first_step");
  });

  // RED→GREEN 2
  it("fires step 2 when delay elapsed since step 1", () => {
    const stepLog: StepLogEntry = {
      rule_id: "rule-1",
      lead_id: "lead-1",
      current_step: 1,
      last_step_sent_at: "2026-05-17T12:00:00Z", // 24h ago
      completed: false,
    };

    const result = getNextCadenceStep({
      sequenceSteps: STEPS,
      stepLog,
      now: NOW,
    });

    expect(result.shouldFire).toBe(true);
    expect(result.step).toEqual(STEPS[1]); // step 2
    expect(result.reason).toBe("delay_elapsed");
  });

  // RED→GREEN 3
  it("returns shouldFire:false when delay not elapsed", () => {
    const stepLog: StepLogEntry = {
      rule_id: "rule-1",
      lead_id: "lead-1",
      current_step: 1,
      last_step_sent_at: "2026-05-18T00:00:00Z", // only 12h ago, need 24h
      completed: false,
    };

    const result = getNextCadenceStep({
      sequenceSteps: STEPS,
      stepLog,
      now: NOW,
    });

    expect(result.shouldFire).toBe(false);
    expect(result.step).toBeNull();
    expect(result.reason).toBe("delay_pending");
  });

  // RED→GREEN 4
  it("returns cadence_complete when all steps done", () => {
    const stepLog: StepLogEntry = {
      rule_id: "rule-1",
      lead_id: "lead-1",
      current_step: 3, // last step in STEPS
      last_step_sent_at: "2026-05-17T00:00:00Z",
      completed: false,
    };

    const result = getNextCadenceStep({
      sequenceSteps: STEPS,
      stepLog,
      now: NOW,
    });

    expect(result.shouldFire).toBe(false);
    expect(result.step).toBeNull();
    expect(result.reason).toBe("cadence_complete");
  });

  // RED→GREEN 5
  it("returns shouldFire:false when stepLog.completed=true", () => {
    const stepLog: StepLogEntry = {
      rule_id: "rule-1",
      lead_id: "lead-1",
      current_step: 2,
      last_step_sent_at: "2026-05-16T12:00:00Z",
      completed: true,
    };

    const result = getNextCadenceStep({
      sequenceSteps: STEPS,
      stepLog,
      now: NOW,
    });

    expect(result.shouldFire).toBe(false);
    expect(result.step).toBeNull();
    expect(result.reason).toBe("already_completed");
  });

  // Edge: empty steps array
  it("returns no_steps when sequence is empty", () => {
    const result = getNextCadenceStep({
      sequenceSteps: [],
      stepLog: null,
      now: NOW,
    });

    expect(result.shouldFire).toBe(false);
    expect(result.reason).toBe("no_steps");
  });

  // Edge: delay_hours + delay_minutes combined
  it("fires step 3 when combined delay_hours + delay_minutes elapsed", () => {
    // Step 3 has delay_hours:48, delay_minutes:30 = 48.5h total
    const stepLog: StepLogEntry = {
      rule_id: "rule-1",
      lead_id: "lead-1",
      current_step: 2,
      last_step_sent_at: "2026-05-16T11:00:00Z", // 49h ago from NOW
      completed: false,
    };

    const result = getNextCadenceStep({
      sequenceSteps: STEPS,
      stepLog,
      now: NOW,
    });

    expect(result.shouldFire).toBe(true);
    expect(result.step!.order).toBe(3);
    expect(result.reason).toBe("delay_elapsed");
  });

  it("does NOT fire step 3 when combined delay not fully elapsed", () => {
    // Step 3 needs 48h30m. Only 48h elapsed.
    const stepLog: StepLogEntry = {
      rule_id: "rule-1",
      lead_id: "lead-1",
      current_step: 2,
      last_step_sent_at: "2026-05-16T12:00:00Z", // exactly 48h ago, need 48h30m
      completed: false,
    };

    const result = getNextCadenceStep({
      sequenceSteps: STEPS,
      stepLog,
      now: NOW,
    });

    expect(result.shouldFire).toBe(false);
    expect(result.reason).toBe("delay_pending");
  });
});

// ---------------------------------------------------------------------------
// isLeadEligibleForTrigger
// ---------------------------------------------------------------------------

import {
  isLeadEligibleForTrigger,
} from "../../supabase/functions/_shared/copilot/followup-triggers.ts";

describe("isLeadEligibleForTrigger", () => {
  // RED→GREEN 6
  it("no_response: eligible when last_message_at older than delay", () => {
    const result = isLeadEligibleForTrigger({
      triggerType: "no_response",
      lead: {
        last_message_at: "2026-05-17T00:00:00Z", // 36h ago
      },
      triggerDelayHours: 24,
      triggerDelayMinutes: 0,
      now: NOW,
    });

    expect(result.eligible).toBe(true);
    expect(result.reason).toBe("no_response_delay_elapsed");
  });

  it("no_response: NOT eligible when within delay window", () => {
    const result = isLeadEligibleForTrigger({
      triggerType: "no_response",
      lead: {
        last_message_at: "2026-05-18T06:00:00Z", // 6h ago, need 24h
      },
      triggerDelayHours: 24,
      triggerDelayMinutes: 0,
      now: NOW,
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("delay_not_elapsed");
  });

  it("no_response: NOT eligible when no last_message_at", () => {
    const result = isLeadEligibleForTrigger({
      triggerType: "no_response",
      lead: {},
      triggerDelayHours: 24,
      triggerDelayMinutes: 0,
      now: NOW,
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("no_message_timestamp");
  });

  // RED→GREEN 7
  it("after_qualification: eligible when score>0 and delay elapsed", () => {
    const result = isLeadEligibleForTrigger({
      triggerType: "after_qualification",
      lead: {
        qualification_score: 72,
        qualified_at: "2026-05-17T00:00:00Z",
        pipe_stages: {},
      },
      triggerDelayHours: 24,
      triggerDelayMinutes: 0,
      now: NOW,
    });

    expect(result.eligible).toBe(true);
    expect(result.reason).toBe("qualified_delay_elapsed");
  });

  it("after_qualification: NOT eligible when score is 0", () => {
    const result = isLeadEligibleForTrigger({
      triggerType: "after_qualification",
      lead: {
        qualification_score: 0,
        qualified_at: "2026-05-17T00:00:00Z",
        pipe_stages: {},
      },
      triggerDelayHours: 24,
      triggerDelayMinutes: 0,
      now: NOW,
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("not_qualified");
  });

  it("after_qualification: NOT eligible when meeting already scheduled", () => {
    const result = isLeadEligibleForTrigger({
      triggerType: "after_qualification",
      lead: {
        qualification_score: 85,
        qualified_at: "2026-05-17T00:00:00Z",
        pipe_stages: { confirmacao: "marcada" },
      },
      triggerDelayHours: 24,
      triggerDelayMinutes: 0,
      now: NOW,
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("meeting_already_scheduled");
  });

  // RED→GREEN 8
  it("proposal_no_response: eligible when in enviada stage and delay elapsed", () => {
    const result = isLeadEligibleForTrigger({
      triggerType: "proposal_no_response",
      lead: {
        pipe_stages: { propostas: "enviada" },
        last_message_at: "2026-05-16T00:00:00Z", // 60h ago
      },
      triggerDelayHours: 48,
      triggerDelayMinutes: 0,
      now: NOW,
    });

    expect(result.eligible).toBe(true);
    expect(result.reason).toBe("proposal_no_response_delay_elapsed");
  });

  it("proposal_no_response: NOT eligible when not in enviada stage", () => {
    const result = isLeadEligibleForTrigger({
      triggerType: "proposal_no_response",
      lead: {
        pipe_stages: { propostas: "negociacao" },
        last_message_at: "2026-05-16T00:00:00Z",
      },
      triggerDelayHours: 48,
      triggerDelayMinutes: 0,
      now: NOW,
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("not_in_enviada_stage");
  });

  it("proposal_no_response: NOT eligible when delay not elapsed", () => {
    const result = isLeadEligibleForTrigger({
      triggerType: "proposal_no_response",
      lead: {
        pipe_stages: { propostas: "enviada" },
        last_message_at: "2026-05-18T00:00:00Z", // 12h ago, need 48h
      },
      triggerDelayHours: 48,
      triggerDelayMinutes: 0,
      now: NOW,
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("delay_not_elapsed");
  });

  // Additional triggers
  it("after_meeting_scheduled: eligible when in confirmacao and delay elapsed", () => {
    const result = isLeadEligibleForTrigger({
      triggerType: "after_meeting_scheduled",
      lead: {
        pipe_stages: { confirmacao: "marcada" },
        stage_changed_at: "2026-05-17T00:00:00Z",
      },
      triggerDelayHours: 24,
      triggerDelayMinutes: 0,
      now: NOW,
    });

    expect(result.eligible).toBe(true);
    expect(result.reason).toBe("meeting_scheduled_delay_elapsed");
  });

  it("after_meeting_scheduled: NOT eligible when not in confirmacao", () => {
    const result = isLeadEligibleForTrigger({
      triggerType: "after_meeting_scheduled",
      lead: {
        pipe_stages: {},
        stage_changed_at: "2026-05-17T00:00:00Z",
      },
      triggerDelayHours: 24,
      triggerDelayMinutes: 0,
      now: NOW,
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("not_in_confirmacao");
  });

  it("post_sale: eligible when vendido and delay elapsed", () => {
    const result = isLeadEligibleForTrigger({
      triggerType: "post_sale",
      lead: {
        pipe_stages: { propostas: "vendido" },
        stage_changed_at: "2026-05-16T00:00:00Z",
      },
      triggerDelayHours: 48,
      triggerDelayMinutes: 0,
      now: NOW,
    });

    expect(result.eligible).toBe(true);
    expect(result.reason).toBe("post_sale_delay_elapsed");
  });

  it("post_sale: NOT eligible when not vendido", () => {
    const result = isLeadEligibleForTrigger({
      triggerType: "post_sale",
      lead: {
        pipe_stages: { propostas: "enviada" },
        stage_changed_at: "2026-05-16T00:00:00Z",
      },
      triggerDelayHours: 48,
      triggerDelayMinutes: 0,
      now: NOW,
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("not_vendido");
  });

  it("unknown trigger type returns not eligible", () => {
    const result = isLeadEligibleForTrigger({
      triggerType: "unknown_type",
      lead: {},
      triggerDelayHours: 24,
      triggerDelayMinutes: 0,
      now: NOW,
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("unknown_trigger_type");
  });
});
