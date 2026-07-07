/**
 * canonical-tv.ts — Hand-typed interfaces for the SP-3 canonical metric RPCs,
 * SCOPED to the TV Dashboard (issue #999).
 *
 * Why hand-typed: the ledger RPCs (get_sales_metrics #995, get_funnel_flow #996,
 * get_ranking #997) ship as UNAPPLIED migrations, so `supabase gen types` cannot
 * see them and `src/integrations/supabase/types.ts` (auto-generated) must not be
 * edited. Callers cast `supabase.rpc('get_sales_metrics' as any, args)` and cast
 * the JSONB result to these shapes. Mirrors the jsonb_build_object of each
 * migration header 1:1.
 *
 * NOTE: this is the TV-local copy. The Comando dashboard (#998) keeps its own
 * `canonical-metrics.ts`. Deliberately NOT shared to keep the two SP-3 consumer
 * slices on disjoint files until the migrations land and types regen.
 */

// ── Period ─────────────────────────────────────────────────
// The frontend NAMES the period and passes plain calendar dates; the DB resolves
// the boundaries in the ORG timezone (metric_period_bounds, ADR-0017 §5). The
// frontend NEVER converts timezones nor truncates entries.

export type CanonicalPeriodName = "day" | "week" | "month" | "range";

export interface CanonicalPeriodArgs {
  p_period: CanonicalPeriodName;
  p_ref?: string | null;   // YYYY-MM-DD (day|week|month anchor)
  p_start?: string | null; // YYYY-MM-DD (range)
  p_end?: string | null;   // YYYY-MM-DD (range)
}

export interface CanonicalPeriodEcho {
  name: string;
  start: string; // tstz lower bound
  end: string;   // tstz upper bound (exclusive)
}

// ── get_sales_metrics (#995) ───────────────────────────────

export interface SalesStreamBucket {
  revenue: number;
  sale_count: number;
}

export interface SalesByCloser {
  member_id: string | null;
  revenue: number;
  sale_count: number;
}

export interface SalesMetricsResult {
  period: CanonicalPeriodEcho;
  pipeline_id: string | null;
  filter_member_id: string | null;
  revenue_total: number;
  revenue_by_stream: {
    novo_negocio: SalesStreamBucket;
    carteira: SalesStreamBucket;
  };
  won_count: number;
  lost_count: number;
  ticket_medio: number | null; // NULL when won_count = 0 (never fabricated 0)
  by_closer: SalesByCloser[];
  unattributed: SalesStreamBucket;
}

// ── get_funnel_flow (#996) ─────────────────────────────────

export interface FunnelFlowStep {
  role: "open" | "meeting_booked" | "meeting_held" | "won";
  reached_count: number;
  conversion_from_top: number | null;
  conversion_from_prev: number | null;
}

export interface FunnelFlowResult {
  period: CanonicalPeriodEcho;
  pipeline_id: string;
  cohort_size: number;
  lost_count: number;
  pre_cutover_caveat: boolean;
  steps: FunnelFlowStep[];
  lost: {
    role: "lost";
    lost_count: number;
    conversion_from_top: number | null;
  };
}

// ── get_ranking (#997) ─────────────────────────────────────
// Typed for completeness; TV podium wiring stays on the legacy useRankingData
// (which lives in the forbidden useDashboardMetrics.ts / #998 file). See report.

export interface RankingRow {
  member_id: string | null;
  revenue: number;
  sale_count: number;
  rank: number;
  revenue_share: number;
}

export interface RankingResult {
  period: CanonicalPeriodEcho;
  pipeline_id: string | null;
  revenue_total: number;
  sale_count_total: number;
  ranking: RankingRow[];
  unattributed: SalesStreamBucket;
}

// ── Helpers ────────────────────────────────────────────────

/** Local calendar date as YYYY-MM-DD (org-tz resolution happens in the DB). */
export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Supabase RPC may return a JSONB scalar or a single-row array — unwrap it. */
export function unwrapRpcJsonb<T>(data: unknown): T | null {
  if (data == null) return null;
  if (Array.isArray(data)) return (data.length > 0 ? data[0] : null) as T | null;
  return data as T;
}

/** Ticket médio NULL-safe over two server-provided aggregates (revenue / count).
 *  NOT a client re-aggregation of entries — a trivial derive of RPC totals. */
export function streamTicket(bucket: SalesStreamBucket | undefined): number {
  if (!bucket || !bucket.sale_count) return 0;
  return bucket.revenue / bucket.sale_count;
}
