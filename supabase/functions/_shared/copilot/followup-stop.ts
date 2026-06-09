/**
 * Stop Evaluator for Copilot Follow-up (ADR-0006).
 *
 * Pure logic — given a domain event on a Lead with an active cadence, decide
 * whether the cadence stops and why. The reason maps to
 * copilot_followup_step_log.completed_reason. The edge ingestion path supplies
 * the events; this module owns the rules.
 */

export type StopReason =
  | "lead_responded"
  | "human_replied"
  | "manual_stop"
  | "situation_resolved"
  | "owner_changed";

export type StopEvent =
  | { type: "lead_reply" }
  | { type: "human_reply" }
  | { type: "opt_out" }
  | { type: "owner_change" }
  // The Lead changed stage; stillInTriggerSet says whether the new stage is
  // still one of the Situation's trigger stages.
  | { type: "stage_change"; stillInTriggerSet: boolean };

export interface StopDecision {
  stop: boolean;
  reason: StopReason | null;
}

export function evaluateStop(event: StopEvent): StopDecision {
  switch (event.type) {
    case "lead_reply":
      return { stop: true, reason: "lead_responded" };
    case "human_reply":
      return { stop: true, reason: "human_replied" };
    case "opt_out":
      return { stop: true, reason: "manual_stop" };
    case "owner_change":
      return { stop: true, reason: "owner_changed" };
    case "stage_change":
      return event.stillInTriggerSet
        ? { stop: false, reason: null }
        : { stop: true, reason: "situation_resolved" };
  }
}
