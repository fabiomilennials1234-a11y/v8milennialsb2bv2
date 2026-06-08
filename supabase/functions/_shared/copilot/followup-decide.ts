/**
 * Decision orchestrator for Copilot Follow-up.
 *
 * Pure composition of the Situation Resolver, the Situation Catalog, and the
 * Cadence Stepper. Given a Lead's state and cadence progress, decides whether
 * to send the next touch and which one. No DB, no side effects — the worker
 * supplies the data and performs the I/O.
 *
 * Timing contract: the first touch is gated by the situation's initial delay
 * (resolver); once a cadence is running, the Stepper owns per-step timing while
 * the resolver keeps confirming the situation still structurally holds.
 */

import {
  resolveSituation,
  type EnabledSituation,
  type SituationId,
  type SituationLeadState,
} from "./followup-situations.ts";
import { getSituationDefault } from "./followup-catalog.ts";
import {
  getNextCadenceStep,
  type CadenceStep,
  type StepLogEntry,
} from "./followup-cadence.ts";

export type FollowupDecision =
  | { send: true; situationId: SituationId; step: CadenceStep }
  | { send: false; reason: string };

export function decideFollowup(params: {
  enabled: EnabledSituation[];
  lead: SituationLeadState;
  stepLog: StepLogEntry | null;
  now: Date;
}): FollowupDecision {
  const { enabled, lead, stepLog, now } = params;

  // A running cadence defers timing to the Stepper; the resolver only confirms
  // the situation still holds.
  const situation = resolveSituation({ enabled, lead, now, ignoreDelay: !!stepLog });
  if (!situation.eligible) {
    return { send: false, reason: situation.reason };
  }

  const def = getSituationDefault(situation.situationId);
  const next = getNextCadenceStep({ sequenceSteps: def.steps, stepLog, now });
  if (!next.shouldFire || !next.step) {
    return { send: false, reason: next.reason };
  }

  return { send: true, situationId: situation.situationId, step: next.step };
}
