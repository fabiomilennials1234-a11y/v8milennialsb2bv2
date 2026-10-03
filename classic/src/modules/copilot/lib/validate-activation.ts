/**
 * validate-activation.ts
 *
 * The finalize gate for the Copilot Builder. Hard checks block activation
 * (mirroring the Playground's existing save validation: name + prompt content);
 * soft checks only warn (behavior coverage, uncovered backbone topics).
 *
 * See PRD #544 / Slice #548.
 */

import type { PlaygroundData } from "@/modules/copilot/components/playground/types";
import { hasFullBehaviorCoverage } from "@/modules/copilot/components/BehaviorWindowsEditor";

/** The Builder's fixed interview backbone — every Copilot setup should cover these. */
export const BACKBONE_TOPICS = [
  "identity",
  "business",
  "icp",
  "objective",
  "flow",
  "tools",
  "guardrails",
  "funnel",
] as const;

export interface ActivationCheck {
  ok: boolean;
  missingHard: string[];
  missingSoft: string[];
}

export function validateForActivation(
  data: PlaygroundData,
  coveredTopics: readonly string[] = [],
): ActivationCheck {
  const missingHard: string[] = [];
  const missingSoft: string[] = [];

  if (!data.name.trim()) missingHard.push("name");

  const promptContent = Object.values(data.promptSections).join("").trim();
  if (promptContent.length < 10) missingHard.push("prompt");

  if (!hasFullBehaviorCoverage(data.behaviorWindows)) {
    missingSoft.push("behavior_windows");
  }

  for (const topic of BACKBONE_TOPICS) {
    if (!coveredTopics.includes(topic)) missingSoft.push(`topic:${topic}`);
  }

  return { ok: missingHard.length === 0, missingHard, missingSoft };
}
