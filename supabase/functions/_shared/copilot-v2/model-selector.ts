/**
 * model-selector — Copilot v2 per-archetype model (Slice 2, ADR #10).
 *
 * Fast tool-calling model for high-volume archetypes; stronger model for
 * Vendedor's closing nuance. Values are the closed copilot_v2_model_id enum.
 */

import type { QualificationTier } from "./rubric-engine.ts";

export type Archetype = "qualificador" | "vendedor" | "carteira";
export type ModelId =
  | "google/gemini-2.5-flash"
  | "anthropic/claude-haiku-4-5"
  | "anthropic/claude-sonnet-4-6";

const MODEL_BY_ARCHETYPE: Record<Archetype, ModelId> = {
  qualificador: "google/gemini-2.5-flash",
  carteira: "google/gemini-2.5-flash",
  vendedor: "anthropic/claude-sonnet-4-6",
};

export function modelForArchetype(archetype: Archetype): ModelId {
  return MODEL_BY_ARCHETYPE[archetype];
}

// Re-export so callers have the tier type alongside archetype/model in one place.
export type { QualificationTier };
