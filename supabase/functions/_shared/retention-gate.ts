/**
 * retention-gate — Pure function that decides whether a retention trigger
 * (recompra_atrasada) should fire based on the copilot agent's retention config.
 *
 * Extracted for testability. Called by calculate-portfolio-health before fireTrigger.
 */

export interface RetentionConfig {
  auto_approach?: boolean;
  strategic_alert_only?: boolean;
  max_frequency_days?: number;
}

export interface RetentionAgent {
  retention_config: RetentionConfig;
}

export interface RetentionGateParams {
  retentionAgent: RetentionAgent | null;
  alertSeverity: string;
  lastDispatchAt: Date | null;
  now?: Date;
}

export interface RetentionGateResult {
  fire: boolean;
  reason: string;
}

export function shouldFireRetentionTrigger(params: RetentionGateParams): RetentionGateResult {
  const { retentionAgent, alertSeverity, lastDispatchAt, now = new Date() } = params;

  // No retention agent → fallback to current behavior (always fire)
  if (!retentionAgent) {
    return { fire: true, reason: "no_retention_agent" };
  }

  const config = retentionAgent.retention_config;

  // auto_approach disabled → suppress all proactive triggers
  if (config.auto_approach === false) {
    return { fire: false, reason: "auto_approach_disabled" };
  }

  // strategic_alert_only → only fire on high/critical severity
  if (config.strategic_alert_only === true) {
    const allowedSeverities = ["high", "critical"];
    if (!allowedSeverities.includes(alertSeverity)) {
      return { fire: false, reason: "strategic_alert_only" };
    }
  }

  // max_frequency_days → throttle per-lead dispatch frequency
  if (config.max_frequency_days != null && config.max_frequency_days > 0 && lastDispatchAt) {
    const msSinceDispatch = now.getTime() - lastDispatchAt.getTime();
    const daysSinceDispatch = msSinceDispatch / (1000 * 60 * 60 * 24);
    if (daysSinceDispatch < config.max_frequency_days) {
      return { fire: false, reason: "frequency_limit" };
    }
  }

  return { fire: true, reason: "retention_checks_passed" };
}
