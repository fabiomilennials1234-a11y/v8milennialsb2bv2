import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

/**
 * Lê a coluna `organizations.feature_flags` (jsonb) da org corrente e expõe
 * o flag de chave `key` como boolean. Convenção: keys em `snake_case`,
 * valores **estritamente `true`** ativam — qualquer outro tipo (string,
 * truthy, undefined) trata como desabilitado para evitar surpresa.
 *
 * Fail-closed em loading: enquanto a org não carrega ou a query está em
 * voo, retorna `enabled=false, isLoading=true`. UI deve mostrar fallback
 * (versão antiga / skeleton) — nunca o caminho da feature flag durante
 * loading, senão o user vê piscar.
 *
 * Sem UI admin nesta slice (PRD #284 Fase 4) — toggle por DB direto:
 *
 *   UPDATE organizations
 *      SET feature_flags = feature_flags || '{"new_lead_modal_v2": true}'::jsonb
 *      WHERE id = '<org>';
 */

export interface FeatureFlagResult {
  enabled: boolean;
  isLoading: boolean;
}

export function useFeatureFlag(key: string): FeatureFlagResult {
  const { organizationId, isLoading: orgLoading } = useOrganization();

  const query = useQuery({
    queryKey: ["organization_feature_flags", organizationId],
    enabled: !!organizationId,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, unknown>> => {
      if (!organizationId) return {};
      const { data, error } = await supabase
        .from("organizations")
        .select("feature_flags")
        .eq("id", organizationId)
        .maybeSingle();
      if (error) throw error;
      const flags = (data as { feature_flags?: Record<string, unknown> } | null)?.feature_flags;
      return flags && typeof flags === "object" ? flags : {};
    },
  });

  if (orgLoading || !organizationId || query.isLoading) {
    return { enabled: false, isLoading: true };
  }

  return { enabled: query.data?.[key] === true, isLoading: false };
}
