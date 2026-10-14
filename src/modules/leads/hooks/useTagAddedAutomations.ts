import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { AutomacaoDeEtiqueta } from "../lib/import-tags";

/** Automações ativas com gatilho "tag adicionada" — só o que o aviso do import precisa. */
export function useTagAddedAutomations() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["workflows", organizationId, "tag_added_ativos"],
    enabled: isReady && !!organizationId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workflows")
        .select("id, name, trigger_config")
        .eq("organization_id", organizationId!)
        .eq("trigger_type", "tag_added")
        .eq("is_active", true);
      if (error) throw error;
      return (data ?? []) as AutomacaoDeEtiqueta[];
    },
  });
}
