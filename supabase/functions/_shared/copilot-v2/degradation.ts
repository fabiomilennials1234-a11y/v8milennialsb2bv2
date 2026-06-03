/**
 * degradation — Copilot v2 graceful degradation knobs (W10, pure).
 *
 * Maps a cost degrade-level (from decideCostGate) to runtime overrides the
 * worker applies this turn, WITHOUT editing the fingerprinted model-selector:
 *   L1 → swap to a cheaper model (sonnet/haiku → flash; flash stays).
 *   L2 → + shrink retrieval (fewer RAG chunks).
 *   L3 → + holding pattern (re-queue the turn so it lands in a cheaper window).
 *
 * The model fallback chain lives HERE (not in modelForArchetype), so applying a
 * degraded model is a runtime decision and the eval fingerprint (W13 =
 * base-prompts + modelForArchetype + tool-registry) never flips.
 */

import type { ModelId } from "./model-selector.ts";

export interface DegradationInput {
  /** 0 = none, 1 = model, 2 = +retrieval, 3 = +holding. */
  degradeLevel: 0 | 1 | 2 | 3;
  /** The model the archetype would normally use this turn (from modelForArchetype). */
  baseModel: ModelId;
}

export interface DegradationDecision {
  /** Cheaper model to use instead, or null if the base is already cheapest. */
  modelOverride: ModelId | null;
  /** Shrink RAG retrieval (fewer chunks) this turn. */
  ragShrink: boolean;
  /** Defer this turn to a cheaper window (re-queue, do not answer now). */
  holdingPattern: boolean;
}

const CHEAPEST: ModelId = "google/gemini-2.5-flash";

/** Cheaper fallback for a model, or null if it's already the cheapest. */
function cheaperThan(model: ModelId): ModelId | null {
  return model === CHEAPEST ? null : CHEAPEST;
}

export function decideDegradation(input: DegradationInput): DegradationDecision {
  const level = input.degradeLevel;
  if (level <= 0) {
    return { modelOverride: null, ragShrink: false, holdingPattern: false };
  }
  return {
    modelOverride: cheaperThan(input.baseModel),
    ragShrink: level >= 2,
    holdingPattern: level >= 3,
  };
}
