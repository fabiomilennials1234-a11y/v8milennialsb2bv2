/**
 * instance-budget — per-WhatsApp-number daily ceiling (ADR-0015, #901).
 *
 * The per-number twin of daily-budget.ts. ADR-0003 capped Mass Send volume by an
 * org-wide ceiling (blast_daily_usage); ADR-0015 adds a FINER ceiling per number
 * (the Number Daily Cap), so a multi-number Blast Plan can round-robin an audience
 * across several lines without burning any single line past its safe rate.
 *
 * Two halves, separated for testability:
 *   - PURE core (`resolveInstanceCap`) — fail-closed cap resolution, no IO.
 *   - IO seam (`InstanceUsageSource`) — reads/increments the per-number-per-day
 *     ledger (blast_instance_daily_usage) via the atomic UPSERT RPC. Injected so
 *     the orchestration stays unit-testable without a live DB.
 *
 * Fail-closed invariants (protecting the number outranks one more send):
 *   1. Missing/invalid daily_blast_cap → DEFAULT_INSTANCE_CAP, never unlimited.
 *   2. A ledger READ error resolves to "cap fully consumed" (returns the cap, so
 *      remaining computes to 0) — a transient blip defers, never floods.
 */

/** Torque-recommended safe per-number value (mirrors speed-safety CAP_RECOMMENDED). */
export const DEFAULT_INSTANCE_CAP = 80;

/**
 * Resolve the effective per-number daily cap from a raw stored value. Returns the
 * configured positive integer, or DEFAULT_INSTANCE_CAP for anything missing /
 * invalid (null, undefined, 0, negative, NaN, Infinity). Never "unlimited".
 */
export function resolveInstanceCap(raw: number | null | undefined): number {
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return DEFAULT_INSTANCE_CAP;
  const floored = Math.floor(raw);
  if (floored < 1) return DEFAULT_INSTANCE_CAP;
  return floored;
}

/**
 * IO seam — reads today's usage and atomically increments the per-number ledger.
 * Implementations MUST scope by instance and fail closed on a read error (return
 * the cap as already-used, i.e. remaining 0), never silently zero.
 */
export interface InstanceUsageSource {
  /** Leads already blasted from this number today. On read error → the cap
   *  itself (remaining 0 — fail closed, not open). */
  getUsedToday(instanceId: string, usageDate: string, cap: number): Promise<number>;
  /** Atomically add `count` to the number's ledger for the day. Called ONLY after
   *  a real dispatch (never on dry-run). */
  increment(instanceId: string, usageDate: string, count: number): Promise<void>;
}

/**
 * Production source over `blast_instance_daily_usage`, via service_role.
 *
 * Read: single-row lookup keyed (instance_id, usage_date). A read FAILURE fails
 * closed — returns `cap`, so the caller's headroom computes to 0 and dispatch is
 * blocked. Never fails open to unlimited.
 *
 * Increment: the atomic UPSERT-increment RPC `increment_instance_daily_usage`
 * (INSERT ... ON CONFLICT DO UPDATE leads_sent += excluded), so concurrent blasts
 * on the same number/day never lose an increment.
 */
export function instanceDailyUsageSource(
  supabaseAdmin: { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any },
): InstanceUsageSource {
  return {
    async getUsedToday(instanceId: string, usageDate: string, cap: number): Promise<number> {
      try {
        const { data, error } = await supabaseAdmin
          .from("blast_instance_daily_usage")
          .select("leads_sent")
          .eq("instance_id", instanceId)
          .eq("usage_date", usageDate)
          .maybeSingle();
        if (error) return cap; // fail closed
        const used = data?.leads_sent;
        if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return 0;
        return Math.floor(used);
      } catch {
        return cap; // read failure → treat the whole cap as consumed
      }
    },

    async increment(instanceId: string, usageDate: string, count: number): Promise<void> {
      if (count <= 0) return;
      await supabaseAdmin.rpc("increment_instance_daily_usage", {
        p_instance_id: instanceId,
        p_usage_date: usageDate,
        p_count: Math.floor(count),
      });
    },
  };
}
