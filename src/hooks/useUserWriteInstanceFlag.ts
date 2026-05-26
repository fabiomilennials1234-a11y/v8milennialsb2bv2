/**
 * useUserWriteInstanceFlag — leitura da feature flag
 * `user_write_instance_strict` por organização.
 *
 * Resolve override em organization_features → default em feature_flags.
 * Resultado conservador: erro/loading retorna `false` (flag OFF) — o caminho
 * legado é o seguro. Cache de 60s para evitar overhead.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
const FLAG_KEY = "user_write_instance_strict";

export function useUserWriteInstanceFlag(): {
  isStrict: boolean;
  isLoading: boolean;
} {
  const { organizationId } = useOrganization();

  const query = useQuery({
    queryKey: ["feature-flag", FLAG_KEY, organizationId],
    queryFn: async (): Promise<boolean> => {
      if (!organizationId) return false;

      const { data: override, error: overrideErr } = await supabase
        .from("organization_features")
        .select("enabled, expires_at")
        .eq("organization_id", organizationId)
        .eq("feature_key", FLAG_KEY)
        .maybeSingle();

      if (!overrideErr && override) {
        const notExpired =
          !override.expires_at || new Date(override.expires_at) > new Date();
        if (notExpired) return Boolean(override.enabled);
      }

      const { data: defaults, error: defaultErr } = await supabase
        .from("feature_flags")
        .select("default_enabled")
        .eq("key", FLAG_KEY)
        .maybeSingle();

      if (defaultErr || !defaults) return false;
      return Boolean(defaults.default_enabled);
    },
    enabled: !!organizationId,
    staleTime: 60 * 1000,
  });

  return {
    isStrict: query.data === true,
    isLoading: query.isLoading,
  };
}
