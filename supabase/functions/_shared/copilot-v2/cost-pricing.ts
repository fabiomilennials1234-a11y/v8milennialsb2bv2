/**
 * cost-pricing — Copilot v2 deterministic token→USD pricing (W10).
 *
 * The single source of cost truth. We do NOT trust OpenRouter's response "cost"
 * field (it varies and is absent on some routes); instead we count tokens and
 * multiply by a closed price table keyed by the model enum. This keeps cost
 * accounting deterministic so the simulator/eval-runner stay hermetic (a fake
 * LLM returns fixed usage → fixed cost). Prices are in USD per MILLION tokens
 * and are tunable constants — the cost CAP itself is org-configurable
 * (copilot_v2_org_settings), but the per-model rate is a platform fact.
 *
 * An unknown model THROWS: the caller (worker accounting) must fail-closed —
 * an un-priced turn must never be silently recorded as zero spend, which would
 * let an org bypass its cap by routing to an unpriced model.
 */

import type { ModelId } from "./model-selector.ts";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ModelPrice {
  /** USD per 1,000,000 prompt (input) tokens. */
  inputPerMtok: number;
  /** USD per 1,000,000 completion (output) tokens. */
  outputPerMtok: number;
}

/**
 * Public OpenRouter list prices (USD / Mtok), approximate — tune as vendor
 * pricing moves. Every model in the closed copilot_v2 ModelId enum is priced.
 */
export const MODEL_PRICING: Record<ModelId, ModelPrice> = {
  "google/gemini-2.5-flash": { inputPerMtok: 0.3, outputPerMtok: 2.5 },
  "anthropic/claude-haiku-4-5": { inputPerMtok: 1.0, outputPerMtok: 5.0 },
  "anthropic/claude-sonnet-4-6": { inputPerMtok: 3.0, outputPerMtok: 15.0 },
};

/**
 * Compute the USD cost of one model call's token usage. `pricing` is injectable
 * for hermetic tests; defaults to the platform MODEL_PRICING. Throws on an
 * unpriced model so the caller fail-closes.
 */
export function computeCostUsd(
  usage: TokenUsage,
  model: ModelId,
  pricing: Record<ModelId, ModelPrice> = MODEL_PRICING,
): number {
  const price = pricing[model];
  if (!price) {
    throw new Error(`cost-pricing: no price entry for model "${model}"`);
  }
  return (usage.promptTokens / 1_000_000) * price.inputPerMtok
    + (usage.completionTokens / 1_000_000) * price.outputPerMtok;
}
