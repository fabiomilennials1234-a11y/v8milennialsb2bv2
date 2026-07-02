/**
 * audience-resolve — pure audience-selection core for the Disparos wizard (#902).
 *
 * The "Pra quem" step freezes a set of lead ids drawn from a funnel stage —
 * a system pipe (`whatsapp/confirmacao/propostas`, stage_key slug) or a custom
 * pipeline (stage_id uuid) — optionally narrowed by conditions (tags /
 * qualification / pre-qualification / origin). The IO (the get_*_lead_ids RPCs)
 * lives in `useAudienceResolve`; everything here is pure so the source routing
 * and provenance descriptor are unit-tested without React or a live DB.
 */
import type { SystemPipelineType, AudienceConditions } from "@/modules/pipelines";

export type FunnelKind = "system" | "custom";

export interface AudienceSelection {
  funnelKind: FunnelKind;
  /** Active system pipe when funnelKind === "system". */
  pipelineType: SystemPipelineType;
  /** Active custom pipeline id when funnelKind === "custom" (else null). */
  pipelineId: string | null;
  /** system: stage_key slug; custom: stage_id uuid. "" = nothing chosen yet. */
  stageKey: string;
  conditions: AudienceConditions;
}

/** Canonical system funnels offered by the standalone wizard. */
export const SYSTEM_FUNNELS: { value: SystemPipelineType; label: string }[] = [
  { value: "whatsapp", label: "Oportunidades" },
  { value: "confirmacao", label: "Agendamentos" },
  { value: "propostas", label: "Orçamentos" },
];

/** Empty conditions literal — read-only reference; never mutate (use `emptyConditions`). */
export const EMPTY_AUDIENCE_CONDITIONS: AudienceConditions = {
  tagIds: [],
  qualificationTier: [],
  preQualificationTier: [],
  origin: [],
};

/** Fresh empty conditions — every array is a new instance (no shared-array aliasing). */
export function emptyConditions(): AudienceConditions {
  return { tagIds: [], qualificationTier: [], preQualificationTier: [], origin: [] };
}

export function createDefaultSelection(): AudienceSelection {
  return {
    funnelKind: "system",
    pipelineType: "whatsapp",
    pipelineId: null,
    stageKey: "",
    conditions: emptyConditions(),
  };
}

/** Any narrowing condition active? Empty everywhere = "todos" (no narrowing). */
export function conditionsActive(c: AudienceConditions): boolean {
  return (
    c.tagIds.length > 0 ||
    c.qualificationTier.length > 0 ||
    c.preQualificationTier.length > 0 ||
    c.origin.length > 0
  );
}

/**
 * Which resolver the selection routes to, given pure inputs:
 *   - "none"     : nothing chosen yet (no stage / no custom pipeline) → empty
 *   - "stage"    : system stage, no conditions → get_stage_lead_ids
 *   - "filtered" : system stage + conditions   → get_filtered_lead_ids
 *   - "custom"   : custom pipeline stage (± conditions) → get_custom_filtered_lead_ids
 */
export type ResolverKind = "none" | "stage" | "filtered" | "custom";

export function resolverFor(sel: AudienceSelection): ResolverKind {
  if (sel.funnelKind === "custom") {
    return sel.pipelineId && sel.stageKey ? "custom" : "none";
  }
  if (!sel.stageKey) return "none";
  return conditionsActive(sel.conditions) ? "filtered" : "stage";
}

/** The selection points at a resolvable target (gates the live count + Continuar). */
export function selectionReady(sel: AudienceSelection): boolean {
  return resolverFor(sel) !== "none";
}

/**
 * Audience provenance recorded on the Blast Plan (drives its panel label). Pure;
 * mirrors the descriptor the legacy board-mounted wizard records.
 */
export function buildAudienceSource(sel: AudienceSelection): Record<string, unknown> {
  const base: Record<string, unknown> = {
    context: "disparo",
    source: "estagio",
    funnelKind: sel.funnelKind,
    stageKey: sel.stageKey,
  };
  if (sel.funnelKind === "system") base.pipelineType = sel.pipelineType;
  else base.pipelineId = sel.pipelineId;
  if (conditionsActive(sel.conditions)) base.conditions = sel.conditions;
  return base;
}
