import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Erro lançado quando a org não tem a feature liberada. */
export class FeatureLockedError extends Error {
  constructor(public feature: string) {
    super(`feature_locked: ${feature}`);
    this.name = "FeatureLockedError";
  }
}

/**
 * Lança FeatureLockedError se a org não tiver a feature no plano.
 * Usa o client service_role para chamar a RPC org_has_feature.
 */
export async function assertOrgFeature(
  admin: SupabaseClient,
  organizationId: string,
  feature: string,
): Promise<void> {
  const { data, error } = await admin.rpc("org_has_feature", {
    p_org_id: organizationId,
    p_feature_key: feature,
  });
  if (error) throw error;
  if (data !== true) throw new FeatureLockedError(feature);
}
