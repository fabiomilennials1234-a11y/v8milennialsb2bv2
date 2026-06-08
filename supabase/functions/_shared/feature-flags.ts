// Leitura de feature flag por org dentro de edge functions (Deno).
// Cascata: override em organization_features (com expiry) → default global em feature_flags.
// Fail-closed (erro → false). Cache em memória por (org, flag), TTL 30s.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const flagCache = new Map<string, { enabled: boolean; expiresAt: number }>();
const FLAG_CACHE_TTL_MS = 30_000;

export async function isFeatureFlagEnabled(
  client: SupabaseClient,
  organizationId: string,
  featureKey: string,
): Promise<boolean> {
  const now = Date.now();
  const cacheKey = `${organizationId}:${featureKey}`;
  const cached = flagCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.enabled;

  let enabled = false;
  try {
    const { data: orgFeature } = await client
      .from("organization_features")
      .select("enabled, expires_at")
      .eq("organization_id", organizationId)
      .eq("feature_key", featureKey)
      .maybeSingle();

    const overrideValid =
      orgFeature &&
      typeof orgFeature.enabled === "boolean" &&
      (!orgFeature.expires_at || new Date(orgFeature.expires_at).getTime() > now);

    if (overrideValid) {
      enabled = Boolean(orgFeature.enabled);
    } else {
      const { data: flag } = await client
        .from("feature_flags")
        .select("default_enabled")
        .eq("key", featureKey)
        .maybeSingle();
      enabled = flag?.default_enabled === true;
    }
  } catch (err) {
    console.warn(`[feature-flags] lookup error for ${featureKey}:`, (err as Error)?.message);
    enabled = false;
  }

  flagCache.set(cacheKey, { enabled, expiresAt: now + FLAG_CACHE_TTL_MS });
  return enabled;
}
