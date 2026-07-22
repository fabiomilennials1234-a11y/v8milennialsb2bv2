/**
 * Production wiring for the reach-allowance gate (#1168).
 *
 * Split from `whatsapp-reach-limit.ts` on purpose: that module is pure policy
 * (how to read a verdict, how to cache) and is unit-tested without a provider
 * or a network. This one owns the provider dependency and the process-wide
 * cache, so importing the policy costs nothing.
 */

import { getWhatsAppProvider } from "./whatsapp-client.ts";
import {
  cachedReachLimitSource,
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
 * Module-level so the cache survives across requests inside a warm isolate —
 * a per-request cache would never hit, which is the whole reason the cache
 * exists. Keyed by instance id, so one tenant's reading is never served to
 * another.
 *
 * The fetcher closes over nothing: it receives everything it needs through the
 * context map below. That keeps a single shared cache instead of one per
 * caller, which is what makes the TTL meaningful.
 */
const contexts = new Map<string, { supabaseAdmin: unknown; instance: unknown }>();

const sharedSource = cachedReachLimitSource(
  async (instanceId: string): Promise<ReachLimit | null> => {
    const ctx = contexts.get(instanceId);
    if (!ctx) return null;

    const provider = await getWhatsAppProvider(
      ctx.instance as never,
      ctx.supabaseAdmin as never,
    );

    // Optional on the provider contract — Meta Cloud does not expose it and
    // throws NotSupportedError. "This provider has no opinion" is unknown, not
    // a failure, and unknown never blocks.
    if (typeof provider.getMessageLimits !== "function") return null;

    return await provider.getMessageLimits();
  },
  { ttlMs: REACH_CACHE_TTL_MS },
);

/**
 * Binds an instance to the shared cached source.
 *
 * Registering the context on every call is intentional: the Supabase client and
 * the instance row are per-request values, while the cached READING is not. The
 * reading is what we want to reuse; the plumbing to fetch it is cheap.
 */
export function providerReachLimitSource(
  supabaseAdmin: unknown,
  instance: { id: string; organization_id: string; provider?: string },
): ReachLimitSource {
  contexts.set(instance.id, { supabaseAdmin, instance });
  return sharedSource;
}
