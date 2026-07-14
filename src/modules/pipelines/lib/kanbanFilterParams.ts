/**
 * Pure mappers: board filter UI → generic server-filter params consumed by
 * `usePaginatedPipeline` (and ultimately the get_pipeline_page /
 * get_pipeline_stage_counts RPCs).
 *
 * These bands MUST mirror the legacy client-side predicates exactly so the
 * server-computed column count equals what the operator sees:
 *   - priority (rating): high `rating>=8`, medium `5..7`, low `<5`; default `rating||0`
 *   - calor:             hot `calor>=7`,  warm `4..6`,  cold `<4`;  default `calor??5`
 *
 * Bounds are inclusive; null means "no bound on that side". The RPC compares
 * COALESCE(rating,0) / COALESCE(calor,5), so the defaults are applied
 * server-side — the client only needs to pass the integer bounds.
 */

export type PriorityBand = "all" | "high" | "medium" | "low";
export type CalorBand = "all" | "hot" | "warm" | "cold";

export interface RatingBounds {
  ratingMin: number | null;
  ratingMax: number | null;
}

export interface CalorBounds {
  calorMin: number | null;
  calorMax: number | null;
}

export function priorityBandToRating(band: string): RatingBounds {
  switch (band) {
    case "high":
      return { ratingMin: 8, ratingMax: null };
    case "medium":
      return { ratingMin: 5, ratingMax: 7 };
    case "low":
      return { ratingMin: null, ratingMax: 4 };
    default:
      return { ratingMin: null, ratingMax: null };
  }
}

export function calorBandToBounds(band: string): CalorBounds {
  switch (band) {
    case "hot":
      return { calorMin: 7, calorMax: null };
    case "warm":
      return { calorMin: 4, calorMax: 6 };
    case "cold":
      return { calorMin: null, calorMax: 3 };
    default:
      return { calorMin: null, calorMax: null };
  }
}

/**
 * Propostas: closed stages whose period reference date is metrics_period_at
 * (fallback updated_at) instead of created_at. Mirrors
 * CLOSED_STATUSES_PROPOSTAS / isPropostaInPeriod in PipePropostas.
 */
export const PROPOSTAS_CLOSED_STATUS_KEYS = ["vendido", "perdido"] as const;

/**
 * Confirmação: stages excluded from the "overdue" bucket. Mirrors
 * isConfirmacaoOverdue (compareceu / perdido are never overdue).
 */
export const CONFIRMACAO_OVERDUE_EXCLUDE_STATUS_KEYS = ["compareceu", "perdido"] as const;

/**
 * Client-side qualification-tier membership predicate. Used by the boards NOT
 * resolved server-side — CustomPipeline and Negócios — so their cards AND their
 * column counts are filtered by the SAME rule (badge == cards). Kept byte-for-
 * byte equivalent to the server predicate in get_pipeline_page /
 * get_pipeline_stage_counts (`l.qualification_tier::text = ANY(p_*)`):
 *
 *   - empty selection  → no filter (NULL-collapse: "todos")
 *   - null/undefined tier → never matches a non-empty selection
 *   - otherwise         → string membership
 */
export function matchesTierFilter(
  tier: string | null | undefined,
  selected: string[] | null | undefined,
): boolean {
  if (!selected || selected.length === 0) return true;
  return tier != null && selected.includes(tier);
}

/**
 * Combined qualification + pre-qualification predicate for a lead-bearing row.
 * Both dimensions are ANDed, matching how the two server params compose.
 */
export function matchesQualificationFilters(
  lead:
    | { qualification_tier?: string | null; pre_qualification_tier?: string | null }
    | null
    | undefined,
  qualificationTier: string[] | null | undefined,
  preQualificationTier: string[] | null | undefined,
): boolean {
  return (
    matchesTierFilter(lead?.qualification_tier, qualificationTier) &&
    matchesTierFilter(lead?.pre_qualification_tier, preQualificationTier)
  );
}
