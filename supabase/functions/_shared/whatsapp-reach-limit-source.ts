/**
 * Production wiring for the reach-allowance gate (#1168).
 *
 * Split from `whatsapp-reach-limit.ts` on purpose: that module is pure policy
 * (how to read a verdict, how to cache) and is unit-tested without a provider
 * or a network. This one owns the provider dependency.
 */

import { getWhatsAppProvider } from "./whatsapp-client.ts";
import {
  cachedReachLimitSource,
  type ReachCacheEntry,
  type ReachLimit,
  type ReachLimitSource,
} from "./whatsapp-reach-limit.ts";

/**
 * Short on purpose. Long enough that a burst of blasts against one number does
 * not re-ask the provider each time; short enough that a number approaching its
 * ceiling is noticed within the same working session.
 */
const REACH_CACHE_TTL_MS = 30_000;

/**
 * Providers that cannot answer will never start answering mid-isolate, so the
 * negative is held far longer than a real reading. Without this, every blast on
 * an unsupported provider pays a thrown `NotSupportedError` (failures are not
 * cached by design).
 */
const UNSUPPORTED_TTL_MS = 60 * 60_000;

/**
 * The ONLY module-level state here, and deliberately so: a map of plain
 * readings. It outlives a request because that is the entire point of a cache —
 * a per-request cache would never hit. What it must never hold is a Supabase
 * client or an instance row; `_shared/CLAUDE.md` forbids both, and keeping the
 * per-request dependencies in the closure below is what keeps that true.
 */
const readings = new Map<string, ReachCacheEntry>();

/** Instance row fields the provider factory needs. */
interface ReachInstance {
  id: string;
  organization_id: string;
  provider?: string | null;
}

/** Structural check — the error class is not exported for `instanceof`. */
function isNotSupported(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === "NotSupportedError";
}

/**
 * Builds a reach source bound to one instance for the current request.
 *
 * Per-request dependencies live in this closure; only the readings are shared.
 */
export function providerReachLimitSource(
  supabaseAdmin: Parameters<typeof getWhatsAppProvider>[1],
  instance: ReachInstance,
): ReachLimitSource {
  return cachedReachLimitSource(
    async (): Promise<ReachLimit | null> => {
      const provider = await getWhatsAppProvider(
        instance as Parameters<typeof getWhatsAppProvider>[0],
        supabaseAdmin,
      );

      // Optional on the provider contract. Meta Cloud DEFINES the method and
      // throws NotSupportedError rather than omitting it, so both shapes have
      // to be handled — a `typeof` check alone would never fire there.
      if (typeof provider.getMessageLimits !== "function") {
        readings.set(instance.id, {
          value: null,
          expiresAt: Date.now() + UNSUPPORTED_TTL_MS,
        });
        return null;
      }

      try {
        return await provider.getMessageLimits();
      } catch (err) {
        if (isNotSupported(err)) {
          readings.set(instance.id, {
            value: null,
            expiresAt: Date.now() + UNSUPPORTED_TTL_MS,
          });
          return null;
        }
        // Transient: rethrow so the cache treats it as unknown-and-not-cached.
        throw err;
      }
    },
    { ttlMs: REACH_CACHE_TTL_MS, store: readings },
  );
}
