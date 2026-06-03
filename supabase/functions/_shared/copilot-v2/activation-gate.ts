/**
 * activation-gate — Copilot v2 (Slice 8). Kills v1 audit #29.
 *
 * Real, server-side check that an agent is operable before it goes live, per the
 * approved Slice 8 design spec. Hard requirements block activation; soft gaps
 * warn. An agent that can do nothing (no capability ON) never activates —
 * consistent with the fail-CLOSED capability gate from Slice 1-H. Pure decision;
 * the caller flips is_active via the SECURITY DEFINER RPC only after this is ok.
 *
 * Required-set:
 *   common      — company.name, icp, products, tone, businessHours, ≥1 capability
 *   qualificador — + rubric present (else it cannot register extracted signals)
 *   vendedor     — + objective, commercialPolicy
 *   carteira     — + objective, commercialPolicy, handoffTarget
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

export function decideActivation(
  archetype: Archetype,
  config: CopilotV2Config,
  rubricPresent: boolean,
): ActivationDecision {
  const missingHard: string[] = [];
  const missingSoft: string[] = [];

  // common
  if (!hasText(config.company?.name)) missingHard.push("company.name");
  if (!hasText(config.icp)) missingHard.push("icp");
  if (!config.products || config.products.length === 0) missingHard.push("products");
  if (!hasText(config.tone)) missingHard.push("tone");
  if (!hasText(config.businessHours)) missingHard.push("businessHours");
  if (!Object.values(config.capabilities ?? {}).some((v) => v === true)) missingHard.push("capabilities");

  // Section 4 + archetype-specific
  if (archetype === "qualificador") {
    if (!rubricPresent) missingHard.push("rubric");
  } else {
    if (!hasText(config.objective)) missingHard.push("objective");
    if (!hasText(config.commercialPolicy)) missingHard.push("commercialPolicy");
    if (archetype === "carteira" && !hasText(config.handoffTarget)) missingHard.push("handoffTarget");
  }

  // soft
  if (!config.objections || config.objections.length === 0) missingSoft.push("objections");
  if (!config.socialProof || config.socialProof.length === 0) missingSoft.push("socialProof");

  return { ok: missingHard.length === 0, missingHard, missingSoft };
}
