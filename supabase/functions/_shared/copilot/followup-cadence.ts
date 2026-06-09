/**
 * Cadence engine for multi-step copilot follow-ups.
 *
 * Pure logic — no DB, no side effects. Consumed by process-copilot-followups.
 */

export interface CadenceStep {
  order: number;
  delay_hours: number;
  delay_minutes: number;
  style: string;
  message_template: string | null;
}

export interface StepLogEntry {
  /** Legacy per-rule cadence owner. Mutually exclusive with situation_config_id. */
  rule_id?: string | null;
  /** Situation-based cadence owner (ADR-0006). Mutually exclusive with rule_id. */
  situation_config_id?: string | null;
  lead_id: string;
  current_step: number;
  last_step_sent_at: string | null;
  completed: boolean;
}

export interface CadenceResult {
  shouldFire: boolean;
  step: CadenceStep | null;
  reason: string;
}

/**
 * Determine which cadence step (if any) should fire next.
 *
 * - No stepLog → fire step 1
 * - stepLog.completed → don't fire
 * - stepLog exists, not completed → check delay since last_step_sent_at
 * - All steps done → cadence_complete
 */
export function getNextCadenceStep(params: {
  sequenceSteps: CadenceStep[];
  stepLog: StepLogEntry | null;
  now: Date;
}): CadenceResult {
  const { sequenceSteps, stepLog, now } = params;
  const sorted = [...sequenceSteps].sort((a, b) => a.order - b.order);

  if (!sorted.length) {
    return { shouldFire: false, step: null, reason: "no_steps" };
  }

  // No log → first step
  if (!stepLog) {
    return { shouldFire: true, step: sorted[0], reason: "first_step" };
  }

  // Already completed
  if (stepLog.completed) {
    return { shouldFire: false, step: null, reason: "already_completed" };
  }

  // Find next step after current
  const nextStepOrder = stepLog.current_step + 1;
  const nextStep = sorted.find((s) => s.order === nextStepOrder);

  if (!nextStep) {
    return { shouldFire: false, step: null, reason: "cadence_complete" };
  }

  // Check delay
  if (!stepLog.last_step_sent_at) {
    return { shouldFire: true, step: nextStep, reason: "next_step" };
  }

  const lastSentAt = new Date(stepLog.last_step_sent_at);
  const delayMs =
    (nextStep.delay_hours * 60 + nextStep.delay_minutes) * 60 * 1000;
  const elapsed = now.getTime() - lastSentAt.getTime();

  if (elapsed >= delayMs) {
    return { shouldFire: true, step: nextStep, reason: "delay_elapsed" };
  }

  return { shouldFire: false, step: null, reason: "delay_pending" };
}
