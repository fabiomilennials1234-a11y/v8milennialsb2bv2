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
  // PostgrestError é um objeto plano, NÃO uma instância de Error. Repassá-lo com
  // `throw error` faz todo `err instanceof Error ? err.message : "Erro interno"`
  // rio abaixo cair no literal genérico — foi o que escondeu por 9 dias que a RPC
  // org_has_feature não existia em prod (PGRST202). Normalizar aqui preserva a
  // mensagem real no runtime_logs e no toast do usuário.
  if (error) {
    throw new Error(
      `org_has_feature falhou (${error.code ?? "sem code"}): ${error.message}`,
    );
  }
  if (data !== true) throw new FeatureLockedError(feature);
}
