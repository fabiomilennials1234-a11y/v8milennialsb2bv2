/**
 * model-selector — Copilot v2 per-archetype model (Slice 2, ADR #10).
 *
 * Modelo único em todos os arquétipos (decisão CTO 2026-08-12): openai/gpt-4.1-mini.
 * Antes o Vendedor apontava para anthropic/claude-sonnet-4-6 — valor que a
 * migration 20260720221647 já tinha removido do enum copilot_v2_model_id, então
 * o arquétipo teria falhado no insert do trace. Values são o enum fechado.
 */

import type { QualificationTier } from "./rubric-engine.ts";

export type Archetype = "qualificador" | "vendedor" | "carteira";
export type ModelId =
  | "google/gemini-2.5-flash"
  | "anthropic/claude-haiku-4-5"
  | "openai/gpt-4.1-mini";

const MODEL_BY_ARCHETYPE: Record<Archetype, ModelId> = {
  qualificador: "openai/gpt-4.1-mini",
  carteira: "openai/gpt-4.1-mini",
  vendedor: "openai/gpt-4.1-mini",
};

export function modelForArchetype(archetype: Archetype): ModelId {
  return MODEL_BY_ARCHETYPE[archetype];
}

// Re-export so callers have the tier type alongside archetype/model in one place.
export type { QualificationTier };
