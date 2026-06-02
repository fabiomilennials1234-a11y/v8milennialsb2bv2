/**
 * activation-gate — Copilot v2 (Slice 8). Kills v1 audit #29.
 *
 * A real, server-side check that an agent is operable before it goes live. An
 * agent activates ONLY when its mandatory identity slots are filled, at least one
 * capability is ON (an agent that can do nothing must not activate — consistent
 * with the fail-CLOSED capability gate from Slice 1-H), and the archetype's own
 * requirement holds (the Qualificador needs a rubric to register the signals it
 * extracts). Soft gaps warn but don't block. Pure decision; the caller flips
 * is_active via the SECURITY DEFINER RPC only after this returns ok.
 */

import type { Archetype } from "./model-selector.ts";
import type { CopilotV2Config } from "./config-schema.ts";

export interface ActivationDecision {
  ok: boolean;
  missingHard: string[];
  missingSoft: string[];
}

function hasText(v: string | undefined | null): boolean {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * Decides whether an agent of `archetype` with `config` may be activated.
 * `rubricPresent` is whether a non-empty rubric row exists for the agent (only
 * the Qualificador requires it).
 */
export function decideActivation(
  archetype: Archetype,
  config: CopilotV2Config,
  rubricPresent: boolean,
): ActivationDecision {
  const missingHard: string[] = [];
  const missingSoft: string[] = [];

  if (!hasText(config.company?.name)) missingHard.push("company.name");
  if (!hasText(config.icp)) missingHard.push("icp");

  const anyCapability = Object.values(config.capabilities ?? {}).some((v) => v === true);
  if (!anyCapability) missingHard.push("capabilities");

  if (archetype === "qualificador" && !rubricPresent) missingHard.push("rubric");

  if (!hasText(config.tone)) missingSoft.push("tone");
  if (!hasText(config.businessHours)) missingSoft.push("businessHours");
  if (!config.products || config.products.length === 0) missingSoft.push("products");
  if (!config.socialProof || config.socialProof.length === 0) missingSoft.push("socialProof");

  return { ok: missingHard.length === 0, missingHard, missingSoft };
}
