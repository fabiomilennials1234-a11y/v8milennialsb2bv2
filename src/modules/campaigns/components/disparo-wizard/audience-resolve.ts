/**
 * audience-resolve — pure audience-selection core for the Disparos wizard (#902).
 *
 * The "Pra quem" step freezes a set of lead ids drawn from a funnel stage —
 * a system pipe (`whatsapp/confirmacao/propostas`, stage_key slug) or a custom
 * pipeline (stage_id uuid) — optionally narrowed by conditions (tags /
 * qualification / pre-qualification / origin). The IO (the get_*_lead_ids RPCs)
 * lives in `useAudienceResolve`; everything here is pure so the source routing
 * and provenance descriptor are unit-tested without React or a live DB.
 *
 * Two INDEPENDENT axes (both widened to an "all" option):
 *   - Funnel: one specific funnel  |  "Todos os funis" (`funnelKind === "all"`)
 *   - Stage:  one specific stage   |  "Todas as etapas" (`stageScope === "all"`)
 *
 * "Todos os funis" is the DEDUPLICATED union of funnel MEMBERSHIP — the 3 system
 * pipes plus every custom pipeline — never the whole `leads` table. A lead that
 * never entered any funnel is not in the audience. See the RPC migration
 * 20270814000000 for the rationale and the tenancy predicate.
 */
import type { SystemPipelineType, AudienceConditions } from "@/modules/pipelines";

/**
 * Which funnel the audience is drawn from.
 *
 * `"all"` spans every funnel at once and therefore has NO per-stage axis: the
 * system model keys stages by `stage_key` slug and the custom model by
 * `stage_id` uuid, so the two share no stage vocabulary and the union can only
 * close by ignoring stage entirely. Hence the invariant below.
 */
export type FunnelKind = "system" | "custom" | "all";

/** Stage axis: a single chosen stage, or the whole funnel. */
export type StageScope = "one" | "all";

export interface AudienceSelection {
  funnelKind: FunnelKind;
  /** Active system pipe when funnelKind === "system". */
  pipelineType: SystemPipelineType;
  /** Active custom pipeline id when funnelKind === "custom" (else null). */
  pipelineId: string | null;
  /** system: stage_key slug; custom: stage_id uuid. Only meaningful when
   *  stageScope === "one"; "" = nothing chosen yet. */
  stageKey: string;
  /** "one" = the chosen stageKey; "all" = every stage of the funnel. */
  stageScope: StageScope;
  conditions: AudienceConditions;
}

/** Canonical system funnels offered by the standalone wizard. */
export const SYSTEM_FUNNELS: { value: SystemPipelineType; label: string }[] = [
  { value: "whatsapp", label: "Oportunidades" },
  { value: "confirmacao", label: "Agendamentos" },
  { value: "propostas", label: "Orçamentos" },
];

/** Display label for the cross-funnel option (Select + audience label). */
export const ALL_FUNNELS_LABEL = "Todos os funis";
/** Display label for the whole-funnel stage option. */
export const ALL_STAGES_LABEL = "Todas as etapas";

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
    stageScope: "one",
    conditions: emptyConditions(),
  };
}

/**
 * INVARIANT: `funnelKind === "all"` ⇒ `stageScope === "all"`.
 *
 * Enforced by {@link applySelection} (the only setter the UI uses) and relied on
 * by {@link resolverFor}. Exported so the invariant is directly assertable.
 */
export function selectionInvariantHolds(sel: AudienceSelection): boolean {
  return sel.funnelKind !== "all" || sel.stageScope === "all";
}

/**
 * The single selection setter — merges a patch and re-establishes the invariant.
 * Choosing "Todos os funis" forces the stage axis to "all" and clears the
 * now-meaningless single-funnel fields, so no stale stageKey/pipelineId can
 * leak into the resolver or the provenance descriptor.
 */
export function applySelection(
  sel: AudienceSelection,
  patch: Partial<AudienceSelection>,
): AudienceSelection {
  const next: AudienceSelection = { ...sel, ...patch };
  if (next.funnelKind === "all") {
    return { ...next, stageScope: "all", stageKey: "", pipelineId: null };
  }
  return next;
}

/**
 * How many narrowing conditions are active — the same sum the Condições header
 * shows (`AudienceConditionsControls`), so the audience label and that badge can
 * never disagree.
 */
export function conditionsCount(c: AudienceConditions): number {
  return (
    c.tagIds.length +
    c.qualificationTier.length +
    c.preQualificationTier.length +
    c.origin.length
  );
}

/** Any narrowing condition active? Empty everywhere = "todos" (no narrowing). */
export function conditionsActive(c: AudienceConditions): boolean {
  return conditionsCount(c) > 0;
}

/**
 * The broadest reachable target: every funnel, every stage, zero narrowing.
 * Allowed on purpose (CTO), but the UI warns with the resolved volume instead
 * of silently letting a mis-click become a real WhatsApp blast. Does NOT block
 * "Continuar".
 */
export function isBroadestSelection(sel: AudienceSelection): boolean {
  return sel.funnelKind === "all" && !conditionsActive(sel.conditions);
}

/**
 * Which resolver the selection routes to, given pure inputs:
 *   - "none"        : nothing chosen yet (no stage / no custom pipeline) → empty
 *   - "stage"       : ONE system stage, no conditions → get_stage_lead_ids
 *   - "filtered"    : system + conditions, or the whole system funnel
 *                     → get_filtered_lead_ids
 *   - "custom"      : custom pipeline, one stage or whole (± conditions)
 *                     → get_custom_filtered_lead_ids
 *   - "all-funnels" : every funnel, deduplicated (± conditions)
 *                     → get_all_funnels_lead_ids
 */
export type ResolverKind = "none" | "stage" | "filtered" | "custom" | "all-funnels";

export function resolverFor(sel: AudienceSelection): ResolverKind {
  // "Todos os funis" is always resolvable and has no stage axis — the invariant
  // (funnelKind "all" ⇒ stageScope "all") makes stageScope/stageKey irrelevant
  // here, so this branch deliberately ignores them rather than trusting them.
  if (sel.funnelKind === "all") return "all-funnels";

  const wholeFunnel = sel.stageScope === "all";

  if (sel.funnelKind === "custom") {
    if (!sel.pipelineId) return "none";
    // get_custom_filtered_lead_ids accepts p_stage_id = NULL ("whole pipeline"),
    // so the whole-funnel scope needs no stageKey.
    return wholeFunnel || sel.stageKey ? "custom" : "none";
  }

  // System. The whole-funnel scope ALWAYS routes to "filtered", with or without
  // conditions: get_stage_lead_ids has no NULL guard on p_stage_key (it is a
  // bare `WHERE pe.stage_key = p_stage_key`, migration 20261228000000:64), so it
  // cannot express "every stage". Only get_filtered_lead_ids has the
  // `p_stage_key IS NULL OR …` escape. Routing a whole-funnel selection to
  // "stage" would silently resolve to ZERO leads.
  if (wholeFunnel) return "filtered";
  if (!sel.stageKey) return "none";
  return conditionsActive(sel.conditions) ? "filtered" : "stage";
}

/** The selection points at a resolvable target (gates the live count + Continuar). */
export function selectionReady(sel: AudienceSelection): boolean {
  return resolverFor(sel) !== "none";
}

/**
 * Human label for the frozen audience, shown in Review/Monitor. Pure so the
 * branch table is testable; `funnelLabel`/`stageName` come from
 * `useFunnelStageOptions`.
 *
 * The label PERSISTS on the draft and travels to Revisão and the Blast Plan
 * panel, so it has to stand alone with no access to the selection:
 *
 *   funil específico + etapa   → `Oportunidades · Novo lead`
 *   funil específico + todas   → `Oportunidades · Todas as etapas`
 *   todos os funis  + todas    → `Todos os funis · Todas as etapas`
 *   funil específico + nada    → `""` (nothing to name yet)
 *   etapa escolhida, nome ainda carregando → `Oportunidades` (funil sozinho)
 *
 * The last two rows are DIFFERENT cases and must not collapse: an empty
 * `stageKey` means nothing was chosen yet (the UI shows "Escolha uma etapa"), so
 * `""` is right; a filled `stageKey` with an empty `stageName` means the target
 * IS chosen and only `useFunnelStageOptions` has not resolved the stage name
 * yet, so the label falls back to the funnel alone — otherwise it would blink
 * blank while the stages load, on a mass-send screen.
 *
 * `Todos os funis` alone would break the `funil · etapa` symmetry and drop the
 * fact that no stage narrowed the target. Active conditions append a suffix
 * (`· 2 condições`) because in Revisão that suffix is the difference between
 * 12.480 and 300.
 */
export function buildAudienceLabel(
  sel: AudienceSelection,
  funnelLabel: string,
  stageName: string,
): string {
  const scope =
    sel.funnelKind === "all"
      ? `${ALL_FUNNELS_LABEL} · ${ALL_STAGES_LABEL}`
      : sel.stageScope === "all"
        ? `${funnelLabel} · ${ALL_STAGES_LABEL}`
        : !sel.stageKey
          ? "" // nothing chosen yet — nothing to name
          : stageName
            ? `${funnelLabel} · ${stageName}`
            : funnelLabel; // target chosen, stage name still loading
  if (!scope) return "";

  const n = conditionsCount(sel.conditions);
  if (n === 0) return scope;
  return `${scope} · ${n} ${n === 1 ? "condição" : "condições"}`;
}

/**
 * Audience provenance recorded on the Blast Plan (drives its panel label). Pure;
 * mirrors the descriptor the legacy board-mounted wizard records.
 *
 * ADDITIVE only: `funnelScope` + `stageScope` are new keys; every pre-existing
 * key keeps its name and meaning, so descriptors written before this change stay
 * parseable and readers never see a renamed field.
 */
export function buildAudienceSource(sel: AudienceSelection): Record<string, unknown> {
  const base: Record<string, unknown> = {
    context: "disparo",
    source: "estagio",
    funnelKind: sel.funnelKind,
    stageKey: sel.stageKey,
    /** "one" = a single funnel; "all" = the deduplicated cross-funnel union. */
    funnelScope: sel.funnelKind === "all" ? "all" : "one",
    /** "one" = the recorded stageKey; "all" = every stage of the scope. */
    stageScope: sel.stageScope,
  };
  if (sel.funnelKind === "system") base.pipelineType = sel.pipelineType;
  else if (sel.funnelKind === "custom") base.pipelineId = sel.pipelineId;
  // funnelKind "all": neither key — the union has no single funnel identity.
  if (conditionsActive(sel.conditions)) base.conditions = sel.conditions;
  return base;
}
