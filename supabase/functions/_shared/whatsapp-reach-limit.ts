/**
 * WhatsApp reach allowance as a send gate (issue #1168).
 *
 * The provider exposes what WhatsApp itself reports about an account's reach
 * ceiling — how many new contacts it has already reached and how many it may.
 * Until now nothing in the backend read it: we enforced volume with our own
 * ledgers (ADR-0003 org budget, ADR-0015 per-number cap) and guessed the safe
 * numbers, while the platform's own answer sat one call away.
 *
 * This module turns that reading into a decision.
 *
 * ## Why this one fails OPEN
 *
 * Every other blast guard in `_shared/quick-blast/` is fail-closed: a read
 * error blocks the send. That is right for those, because they read OUR
 * ledgers — failing to read our own accounting means we lost track of it, and
 * proceeding blind risks blowing a cap we promised to hold.
 *
 * This gate is the opposite by design. It reads the PROVIDER's opinion, over
 * the network, about an account we do not control. Not knowing that opinion is
 * the normal state (unsupported provider, timeout, malformed body), and it must
 * never become a reason to refuse a send the user is entitled to make. A gate
 * that blocks whenever the provider is slow is worse than no gate at all.
 *
 * The asymmetry is deliberate. Do not "fix" it for consistency.
 *
 * ## Why `reachout_timelock` is carried but never judged
 *
 * The field comes back from the provider and its unit is undocumented
 * everywhere in this codebase — epoch, seconds remaining, and "0 means no lock"
 * are all consistent with what we can observe. It is passed through so it can
 * be logged and calibrated against real accounts, and it is deliberately not
 * part of any verdict. Blocking a customer's send on a field whose unit we
 * inferred is how false positives reach production.
 */

/** What the provider reports about an account's reach allowance. */
export interface ReachLimit {
  /** New contacts already reached in the current window. */
  current: number;
  /** Ceiling for that window. */
  limit: number;
  /** Undocumented unit — carried for calibration, never judged. See above. */
  reachout_timelock?: number;
}

/**
 * Resolves the reading for an instance. Returns `null` for "unknown" — which
 * includes provider-not-supported, network failure, and malformed responses.
 * Implementations must not throw.
 */
export interface ReachLimitSource {
  get(instanceId: string): Promise<ReachLimit | null>;
}

export interface ReachVerdict {
  /** True only when the provider clearly says the ceiling is reached. */
  exhausted: boolean;
  /** Remaining allowance, or `null` when unknown. Never negative. */
  headroom: number | null;
  /** Raw reading, preserved for logging and later calibration. */
  limit: ReachLimit | null;
}

const UNKNOWN: ReachVerdict = { exhausted: false, headroom: null, limit: null };

function isUsableCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Turns a reading into a verdict.
 *
 * Anything short of a clear, well-formed "you are at the ceiling" resolves to
 * unknown, and unknown never blocks.
 */
export function assessReach(reading: ReachLimit | null | undefined): ReachVerdict {
  if (!reading) return UNKNOWN;

  const { current, limit } = reading;
  if (!isUsableCount(current) || !isUsableCount(limit)) return UNKNOWN;

  // A non-positive ceiling is ambiguous: "no allowance left" and "this field
  // does not apply to your account" look identical from here. Refusing on an
  // ambiguous zero would block accounts that are perfectly fine.
  if (limit <= 0) return UNKNOWN;

  const headroom = Math.max(0, limit - current);
  return { exhausted: headroom <= 0, headroom, limit: reading };
}

/** A cached reading. Plain data — never holds a client or a request context. */
export interface ReachCacheEntry {
  value: ReachLimit | null;
  expiresAt: number;
}

/**
 * Wraps a fetcher with a short per-instance TTL cache.
 *
 * The `store` is INJECTED rather than owned. Production passes a module-level
 * Map so readings survive across requests inside a warm isolate — a cache the
 * source owned would be rebuilt per request and never hit, which defeats the
 * point. Tests pass a fresh Map and get full isolation.
 *
 * Injecting the store is also what keeps the module-level state honest: what
 * outlives a request is a map of plain readings, not a Supabase client or an
 * instance row. `_shared/CLAUDE.md` forbids exactly the latter.
 *
 * The fetcher closes over whatever it needs. It receives the instance id only
 * so the cache key and the fetch argument cannot drift apart.
 *
 * Failures return `null` and are NOT cached: caching a blip would extend one
 * bad read into a whole blind window. A caller that knows a negative is
 * durable (an unsupported provider) can seed the store itself.
 */
export function cachedReachLimitSource(
  fetchLimits: (instanceId: string) => Promise<ReachLimit | null>,
  opts: {
    ttlMs: number;
    store?: Map<string, ReachCacheEntry>;
    now?: () => number;
  },
): ReachLimitSource {
  const { ttlMs } = opts;
  const now = opts.now ?? (() => Date.now());
  const cache = opts.store ?? new Map<string, ReachCacheEntry>();

  return {
    async get(instanceId: string): Promise<ReachLimit | null> {
      const hit = cache.get(instanceId);
      if (hit && hit.expiresAt > now()) return hit.value;

      try {
        const value = await fetchLimits(instanceId);
        cache.set(instanceId, { value, expiresAt: now() + ttlMs });
        return value;
      } catch {
        // Unknown, not blocked. Intentionally not cached.
        return null;
      }
    },
  };
}
