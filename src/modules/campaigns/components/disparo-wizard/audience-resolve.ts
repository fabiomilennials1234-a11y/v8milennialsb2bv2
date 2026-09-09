/**
 * audience-resolve — pure audience-selection core for the Disparos wizard (#902).
 *
 * Fatia B (épico Funil é Funil, D1/D4): a seleção aponta pra UM funil qualquer
 * da org por `pipelineId` — o eixo system/custom morreu junto com o
 * `SystemPipelineType`. O "Pra quem" congela um conjunto de lead ids tirado de
 * (funil, etapa) — etapa por `pipeline_stages.id` (uuid, canônico) —
 * opcionalmente estreitado por condições (tags / qualificação /
 * pré-qualificação / origem). O IO (a RPC única `get_pipeline_lead_ids` +
 * `get_all_funnels_lead_ids`) vive em `useAudienceResolve`; tudo aqui é puro.
 *
 * Two INDEPENDENT axes (both widened to an "all" option):
 *   - Funil: one specific funnel (`pipelineId`)  |  "Todos os funis"
 *     (`funnelScope === "all"`)
 *   - Etapa: one specific stage (`stageId`)      |  "Todas as etapas"
 *     (`stageScope === "all"`)
 *
 * "Todos os funis" is the DEDUPLICATED union of funnel MEMBERSHIP — every
 * funnel of the org — never the whole `leads` table. A lead that never entered
 * any funnel is not in the audience. See the RPC migration 20270814000000 for
 * the rationale and the tenancy predicate.
 */
import type { AudienceConditions } from "@/modules/pipelines";

/** Funnel axis: a single chosen funnel, or every funnel of the org. */
export type FunnelScope = "one" | "all";

/** Stage axis: a single chosen stage, or the whole funnel. */
export type StageScope = "one" | "all";

export interface AudienceSelection {
  /** "one" = the chosen pipelineId; "all" = every funnel (no stage axis). */
  funnelScope: FunnelScope;
  /** The chosen funnel (`pipelines.id`) when funnelScope === "one"; null = not chosen. */
  pipelineId: string | null;
  /** The chosen stage (`pipeline_stages.id`). Only meaningful when
   *  stageScope === "one"; "" = nothing chosen yet. */
  stageId: string;
  /** "one" = the chosen stageId; "all" = every stage of the funnel. */
  stageScope: StageScope;
  conditions: AudienceConditions;
}

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

/**
 * Default: no funnel chosen yet. O wizard antigo nascia apontando pro pipe
 * whatsapp porque o trio era especial; com funil-é-funil o primeiro funil real
 * da org é escolha da TELA (AudienceByStage semeia com o primeiro da lista),
 * não do core puro — o core não conhece a org.
 */
export function createDefaultSelection(): AudienceSelection {
  return {
    funnelScope: "one",
    pipelineId: null,
    stageId: "",
    stageScope: "one",
    conditions: emptyConditions(),
  };
}

/**
 * INVARIANT: `funnelScope === "all"` ⇒ `stageScope === "all"`.
 *
 * A união cross-funil não tem eixo de etapa: cada funil tem o próprio conjunto
 * de etapas, então "todos os funis" só fecha ignorando etapa. Enforced by
 * {@link applySelection} (the only setter the UI uses) and relied on by
 * {@link resolverFor}. Exported so the invariant is directly assertable.
 */
export function selectionInvariantHolds(sel: AudienceSelection): boolean {
  return sel.funnelScope !== "all" || sel.stageScope === "all";
}

/**
 * The single selection setter — merges a patch and re-establishes the invariant.
 * Choosing "Todos os funis" forces the stage axis to "all" and clears the
 * now-meaningless single-funnel fields, so no stale stageId/pipelineId can
 * leak into the resolver or the provenance descriptor.
 */
export function applySelection(
  sel: AudienceSelection,
  patch: Partial<AudienceSelection>,
): AudienceSelection {
  const next: AudienceSelection = { ...sel, ...patch };
  if (next.funnelScope === "all") {
    return { ...next, stageScope: "all", stageId: "", pipelineId: null };
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
  return sel.funnelScope === "all" && !conditionsActive(sel.conditions);
}

/**
 * Which resolver the selection routes to, given pure inputs:
 *   - "none"        : nothing chosen yet (no funnel / no stage) → empty
 *   - "pipeline"    : ONE funnel (any type), one stage or whole (± conditions)
 *                     → get_pipeline_lead_ids (motor único da 20270908003000)
 *   - "all-funnels" : every funnel, deduplicated (± conditions)
 *                     → get_all_funnels_lead_ids
 */
export type ResolverKind = "none" | "pipeline" | "all-funnels";

export function resolverFor(sel: AudienceSelection): ResolverKind {
  // "Todos os funis" is always resolvable and has no stage axis — the invariant
  // (funnelScope "all" ⇒ stageScope "all") makes stageScope/stageId irrelevant
  // here, so this branch deliberately ignores them rather than trusting them.
  if (sel.funnelScope === "all") return "all-funnels";
  if (!sel.pipelineId) return "none";
  // get_pipeline_lead_ids reads p_stage_id NULL as "funil inteiro", so the
  // whole-funnel scope needs no stageId.
  return sel.stageScope === "all" || sel.stageId ? "pipeline" : "none";
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
 * `stageId` means nothing was chosen yet (the UI shows "Escolha uma etapa"), so
 * `""` is right; a filled `stageId` with an empty `stageName` means the target
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
    sel.funnelScope === "all"
      ? `${ALL_FUNNELS_LABEL} · ${ALL_STAGES_LABEL}`
      : sel.stageScope === "all"
        ? `${funnelLabel} · ${ALL_STAGES_LABEL}`
        : !sel.stageId
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
 * Audience provenance recorded on the Blast Plan (drives its panel label and o
 * backfill/leitura de `blast_plans.pipeline_id`). Pure.
 *
 * Shape canônico da Fatia B: `pipelineId` + `stageId` (uuids). Descriptors
 * LEGADOS persistidos (`funnelKind`/`pipelineType`/`stageKey`) continuam
 * aceitos na leitura pra sempre pelos leitores (edge fns + painel); este
 * builder só escreve o formato novo. `funnelScope`/`stageScope` mantêm nome e
 * significado das escritas anteriores.
 */
export function buildAudienceSource(sel: AudienceSelection): Record<string, unknown> {
  const base: Record<string, unknown> = {
    context: "disparo",
    source: "estagio",
    /** "one" = a single funnel; "all" = the deduplicated cross-funnel union. */
    funnelScope: sel.funnelScope,
    /** "one" = the recorded stageId; "all" = every stage of the scope. */
    stageScope: sel.stageScope,
  };
  if (sel.funnelScope === "one" && sel.pipelineId) base.pipelineId = sel.pipelineId;
  if (sel.stageScope === "one" && sel.stageId) base.stageId = sel.stageId;
  // funnelScope "all": sem pipelineId — a união não tem identidade de funil.
  if (conditionsActive(sel.conditions)) base.conditions = sel.conditions;
  return base;
}
