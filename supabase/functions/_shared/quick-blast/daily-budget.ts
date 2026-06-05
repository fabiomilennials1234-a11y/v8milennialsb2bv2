/**
 * dailyBlastBudget — Organization-wide daily ceiling on Mass Send volume (ADR-0003).
 *
 * Supersedes the per-blast cap *framing* of ADR-0002. The guardrail is now an
 * Organization-wide ceiling on how many Leads may be messaged via Mass Send per
 * calendar day, **summed across every blast** — manual Quick Blasts today, Blast
 * Plan lots in #707. The per-blast `quick_blast_max_leads` stays as an optional
 * clamp that operates WITHIN the daily budget.
 *
 * Two halves, separated for testability:
 *   - PURE core (`resolveDailyBudget`, `computeDailyClamp`, `saoPauloUsageDate`)
 *     — no IO, carries the security-critical fail-closed logic.
 *   - IO seam (`BlastUsageSource`) — reads today's usage and atomically
 *     increments the per-org-per-day ledger. Injected so `runQuickBlast` is
 *     unit-testable without a live DB (mirrors the #704 activity source).
 *
 * Fail-closed invariants (the whole reason this control exists — protecting the
 * WhatsApp number outranks delivering one more blast):
 *   1. Missing/invalid `daily_blast_budget` → DEFAULT_DAILY_BUDGET, never unlimited.
 *   2. A ledger READ error must NOT open the gate. The IO source resolves a read
 *      failure to "budget fully consumed" (remaining 0) — the day is blocked, not
 *      flung open. A transient DB blip costs a deferred blast, never a ban.
 */

export const DEFAULT_DAILY_BUDGET = 200;

/**
 * America/Sao_Paulo is the business timezone used across the product
 * (getTimeBasedVariables, followupSchedule, workflow windows). The "calendar
 * day" the budget resets on is the Sao Paulo day, NOT UTC — a blast fired at
 * 23:00 BRT and another at 01:00 BRT count against different days, matching how
 * a salesperson reads "today".
 */
export const BLAST_BUDGET_TIMEZONE = "America/Sao_Paulo";

/**
 * Resolve the effective daily ceiling from a raw stored config value.
 * Returns the configured positive integer, or DEFAULT_DAILY_BUDGET for anything
 * missing/invalid (null, undefined, 0, negative, NaN, Infinity). Mirrors
 * resolveOrgCap — never resolves to "unlimited".
 */
export function resolveDailyBudget(raw: number | null | undefined): number {
  if (raw === null || raw === undefined) return DEFAULT_DAILY_BUDGET;
  if (!Number.isFinite(raw)) return DEFAULT_DAILY_BUDGET;
  const floored = Math.floor(raw);
  if (floored < 1) return DEFAULT_DAILY_BUDGET;
  return floored;
}

/**
 * The America/Sao_Paulo calendar date (YYYY-MM-DD) for an instant. This is the
 * ledger partition key — `blast_daily_usage.usage_date`. Computed server-side so
 * the day boundary is deterministic regardless of the server's own clock zone.
 */
export function saoPauloUsageDate(now: Date = new Date()): string {
  // en-CA yields ISO-style YYYY-MM-DD; timeZone shifts the instant to BRT first.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BLAST_BUDGET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export interface DailyClampInput {
  /** Resolved daily ceiling (already passed through resolveDailyBudget). */
  dailyBudget: number;
  /** Leads already messaged across all blasts today (the ledger value). */
  usedToday: number;
  /** Optional per-blast clamp WITHIN the daily budget. <= 0 → treated as unset. */
  perBlastMax?: number;
}

export interface DailyClampResult {
  /** Budget left for the day: max(0, dailyBudget - usedToday). */
  remaining: number;
  /** Hard cap for THIS blast: min(perBlastMax?, dailyBudget, remaining). */
  effectiveCap: number;
  /** True when nothing remains today — the blast must be rejected/empty. */
  overBudget: boolean;
}

/**
 * Pure clamp computation. `remaining` is the shared daily budget left; the blast
 * is clamped to the tightest of perBlastMax (if positive), the daily budget, and
 * the remaining. When `remaining` is 0 the blast is over budget (reject/empty).
 */
export function computeDailyClamp(input: DailyClampInput): DailyClampResult {
  const { dailyBudget, usedToday, perBlastMax } = input;
  const remaining = Math.max(0, dailyBudget - Math.max(0, usedToday));

  let effectiveCap = Math.min(dailyBudget, remaining);
  if (typeof perBlastMax === "number" && perBlastMax > 0) {
    effectiveCap = Math.min(effectiveCap, Math.floor(perBlastMax));
  }

  return { remaining, effectiveCap, overBudget: remaining <= 0 };
}

/**
 * IO seam — reads today's usage and atomically increments the ledger. Injected
 * so the core is testable without a live DB. Implementations MUST scope by org
 * and fail closed on a read error (return the full budget as already-used, i.e.
 * remaining 0), never silently zero.
 */
export interface BlastUsageSource {
  /** Leads already messaged today for this org. On read error → the daily
   *  budget itself (so remaining computes to 0 — fail closed, not open). */
  getUsedToday(orgId: string, usageDate: string, dailyBudget: number): Promise<number>;
  /** Atomically add `count` to the org's ledger for the day. Called ONLY after a
   *  real dispatch (never on dry-run). Best-effort — a failure here is logged by
   *  the caller, the blast already fired. */
  increment(orgId: string, usageDate: string, count: number): Promise<void>;
}

/**
 * Production usage source over `blast_daily_usage`, via service_role.
 *
 * Read: a single-row lookup keyed (organization_id, usage_date). A read FAILURE
 * fails closed — it returns `dailyBudget`, so computeDailyClamp yields remaining
 * 0 and the blast is blocked. We never fail open to unlimited.
 *
 * Increment: the atomic UPSERT-increment RPC `increment_blast_daily_usage`
 * (INSERT ... ON CONFLICT DO UPDATE SET leads_sent = leads_sent + excluded),
 * so concurrent blasts on the same day never lose an increment.
 */
export function blastDailyUsageSource(
  supabaseAdmin: { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any },
): BlastUsageSource {
  return {
    async getUsedToday(orgId: string, usageDate: string, dailyBudget: number): Promise<number> {
      try {
        const { data, error } = await supabaseAdmin
          .from("blast_daily_usage")
          .select("leads_sent")
          .eq("organization_id", orgId)
          .eq("usage_date", usageDate)
          .maybeSingle();
        // A query-level error must not look like "0 used". Fail closed.
        if (error) return dailyBudget;
        const used = data?.leads_sent;
        if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return 0;
        return Math.floor(used);
      } catch {
        // Read failure → treat the whole budget as consumed (remaining 0).
        return dailyBudget;
      }
    },

    async increment(orgId: string, usageDate: string, count: number): Promise<void> {
      if (count <= 0) return;
      await supabaseAdmin.rpc("increment_blast_daily_usage", {
        p_org_id: orgId,
        p_usage_date: usageDate,
        p_count: Math.floor(count),
      });
    },
  };
}

/**
 * Read the org's configured daily budget, fail-closed. Thin DB read; the pure
 * resolveDailyBudget carries the logic (and is unit-tested).
 */
export async function getDailyBlastBudget(
  supabaseAdmin: { from: (t: string) => any },
  orgId: string,
): Promise<number> {
  try {
    const { data } = await supabaseAdmin
      .from("organizations")
      .select("daily_blast_budget")
      .eq("id", orgId)
      .maybeSingle();
    return resolveDailyBudget(data?.daily_blast_budget ?? null);
  } catch {
    return DEFAULT_DAILY_BUDGET;
  }
}
