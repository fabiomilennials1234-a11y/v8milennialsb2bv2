/**
 * llm-cache — Copilot v2 (W13). A deterministic LlmClient factory for the
 * dataset CI gate: it replays committed model responses keyed by (case_id, model)
 * on top of the Slice 9 createFakeLlm, so the eval suite runs hermetically in CI
 * (no API key, no network, fully reproducible). A cache miss throws loudly — the
 * gate must FAIL on an incomplete fixture, never silently fall through to a live
 * model. Pure, zero-dep.
 */

import { createFakeLlm } from "./fake-llm.ts";
import type { LlmClient, LlmResponse } from "./cognition-loop.ts";
import type { ModelId } from "./model-selector.ts";
import type { EvalCase } from "./eval-runner.ts";

/** Committed responses: cache[case_id][model] = scripted LlmResponse sequence. */
export type CachedResponses = Record<string, Record<string, LlmResponse[]>>;

/**
 * Builds the `makeLlm` dependency for runEvalSuite from a committed response
 * cache. The returned factory matches EvalRunnerDeps.makeLlm exactly.
 */
export function makeCachedLlm(
  cache: CachedResponses,
): (model: ModelId, evalCase: EvalCase) => LlmClient {
  return (model, evalCase) => {
    const script = cache[evalCase.id]?.[model];
    if (!script || script.length === 0) {
      throw new Error(
        `llm cache miss for case "${evalCase.id}" model "${model}" — ` +
          `regenerate the eval golden fixture (no live LLM in CI)`,
      );
    }
    return createFakeLlm(script);
  };
}
