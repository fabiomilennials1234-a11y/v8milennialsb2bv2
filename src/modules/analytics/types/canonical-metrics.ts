/**
 * Hand-written TypeScript contracts for the CANONICAL ledger RPCs of the
 * metrics refoundation (PRD #986, SP-3): get_sales_metrics (#995),
 * get_ranking (#997) and get_funnel_flow (#996). See ADR-0017.
 *
 * WHY HAND-WRITTEN: these RPCs live only in migrations that are NOT yet applied
 * to the projects the frontend types are generated from, so they are absent from
 * `src/integrations/supabase/types.ts` and it cannot be regenerated for them.
 * Consumers therefore call `supabase.rpc('get_sales_metrics' as any, args)` (the
 * name is cast to bypass the missing generated overload) and cast the jsonb
 * result to the interfaces below. Delete this file and switch to the generated
 * types once the ledger migrations are applied and types.ts is regenerated.
 *
 * OWNERSHIP: issue #998 (sales/ranking/funnel). Commission-ledger contracts below
 * added by #1000 (metas/comissões consumer). #999 (TV) uses a separate
 * canonical-tv.ts — no overlap. Do not edit the #998 sections from #999.
 */

/** Revenue stream is decided by the CLIENT at sale time (ADR-0017 §2). */
export type RevenueStream = "novo_negocio" | "carteira";

/**
 * Named period echoed back by every canonical RPC. `start`/`end` are ISO
 * timestamptz strings already resolved in the org timezone by the DB — the
 * frontend never computes these bounds (ADR-0017 §5).
 */
export interface CanonicalPeriod {
  name: string;
  start: string;
  end: string;
}

/** Revenue + count for one stream or one member bucket. */
export interface RevenueBucket {
  revenue: number;
  sale_count: number;
}

/** One closer's slice of the WON set, keyed by the single canonical attribution. */
export interface SalesByCloser {
  member_id: string;
  revenue: number;
  sale_count: number;
}

/** get_sales_metrics(p_org_id, p_period, p_ref, p_start, p_end, p_pipeline_id, p_filter_member_id). */
export interface SalesMetricsResult {
  period: CanonicalPeriod;
  pipeline_id: string | null;
  filter_member_id: string | null;
  /** Net-of-reversal revenue for the period. Invariant: == sum of streams. */
  revenue_total: number;
  revenue_by_stream: Record<RevenueStream, RevenueBucket>;
  won_count: number;
  lost_count: number;
  /** NULL when won_count === 0 (never divides by zero, never fabricates a 0 ticket). */
  ticket_medio: number | null;
  by_closer: SalesByCloser[];
  /** Sales with no canonical responsible. Invariant: Σ(by_closer) + unattributed == total. */
  unattributed: RevenueBucket;
}

/** One ranked member in get_ranking. `rank` counts only attributed members. */
export interface RankingEntry {
  member_id: string;
  revenue: number;
  sale_count: number;
  rank: number;
  /** revenue / revenue_total * 100 ∈ [0,100]. */
  revenue_share: number;
}

/** get_ranking(p_org_id, p_period, p_ref, p_start, p_end, p_pipeline_id). Sales only (#997). */
export interface RankingResult {
  period: CanonicalPeriod;
  pipeline_id: string | null;
  revenue_total: number;
  sale_count_total: number;
  ranking: RankingEntry[];
  unattributed: RevenueBucket;
}

/** Canonical funnel roles, in monotonic order (ADR-0017 §1). */
export type FunnelFlowRole = "open" | "meeting_booked" | "meeting_held" | "won";

/** One monotonic funnel step. `conversion_from_prev` is NULL on the first step. */
export interface FunnelFlowStep {
  role: FunnelFlowRole;
  reached_count: number;
  conversion_from_top: number | null;
  conversion_from_prev: number | null;
}

/** Terminal negative bucket, outside the monotonic chain. */
export interface FunnelFlowLost {
  role: "lost";
  lost_count: number;
  conversion_from_top: number | null;
}

/** get_funnel_flow(p_org_id, p_pipeline_id, p_period, p_ref, p_start, p_end). p_pipeline_id REQUIRED. */
export interface FunnelFlowResult {
  period: CanonicalPeriod;
  pipeline_id: string;
  cohort_size: number;
  lost_count: number;
  /** true when the lower bound predates the 2026-12-01 backfill cutover (§7). */
  pre_cutover_caveat: boolean;
  steps: FunnelFlowStep[];
  lost: FunnelFlowLost;
}

/**
 * Maps a legacy month/year selection to the canonical NAMED-period argument set.
 * The dashboard's period UX is month-based; a month maps to `p_period:'month'`
 * with `p_ref` on the first of that month (the DB resolves the bounds in the org
 * timezone). A custom range would map to `p_period:'range'` with `p_start`/`p_end`.
 * The frontend NAMES the period and passes dates — it never converts timezones
 * or computes UTC bounds (ADR-0017 §5).
 */
export interface CanonicalPeriodArgs {
  p_period: "day" | "week" | "month" | "range";
  p_ref: string | null;
  p_start: string | null;
  p_end: string | null;
}

/** Build the named-period args for a calendar month (dashboard default UX). */
export function monthPeriodArgs(month: number, year: number): CanonicalPeriodArgs {
  const p_ref = `${year}-${String(month).padStart(2, "0")}-01`;
  return { p_period: "month", p_ref, p_start: null, p_end: null };
}

/** Build the named-period args for an explicit custom date range. */
export function rangePeriodArgs(start: Date, end: Date): CanonicalPeriodArgs {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { p_period: "range", p_ref: null, p_start: iso(start), p_end: iso(end) };
}

// ────────────────────────────────────────────────────────────────────────────
// get_commission_ledger (#997 / ADR-0017 §6,§8) — commission as a READ of the
// sale_events projection (commissions.source='sale_event_projection', #994):
// rate/amount snapshotted, net-of-reversal via anti-join on the sale, anchored
// on sold_at <@ metric_period_bounds. Invariant (proven in #997): a member's
// base_revenue == get_ranking.revenue for the same member, and member-on-podium
// ⟺ member-has-ledger-line. Consumed by #1000 (Comissões / OTE) so the number a
// member sees equals the podium — the R5/#3/#11-killer. Owner: #1000.
// ────────────────────────────────────────────────────────────────────────────

/** Commission slice for one product type (mrr | projeto). rate_percent is NULL
 *  when the snapshotted rate is not uniform across the type's sales (honest). */
export interface CommissionByType {
  commission: number;
  base_revenue: number;
  sale_count: number;
  rate_percent: number | null;
}

/** One member's commission ledger row. `base_revenue` == that member's canonical
 *  podium revenue (get_ranking.revenue) for the same period — one number. */
export interface CommissionLedgerMember {
  member_id: string;
  commission: number;
  base_revenue: number;
  sale_count: number;
  by_type: {
    mrr: CommissionByType;
    projeto: CommissionByType;
  };
}

/** get_commission_ledger(p_org_id, p_period, p_ref, p_start, p_end, p_filter_member_id). */
export interface CommissionLedgerResult {
  period: CanonicalPeriod;
  filter_member_id: string | null;
  commission_total: number;
  base_revenue_total: number;
  sale_count_total: number;
  by_member: CommissionLedgerMember[];
}
