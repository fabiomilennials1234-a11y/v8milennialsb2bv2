import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useClassificacaoCafeJurere } from "./useClassificacaoCafeJurere";

export function useCafeJurereCadastro(leadId: string | null, enabled: boolean) {
  const { organizationId } = useOrganization();
  const piloto = useClassificacaoCafeJurere();
  const active = piloto && enabled && !!organizationId && !!leadId;
  const query = useQuery({
    queryKey: ["cafe-jurere-cadastro", organizationId, leadId],
    enabled: active,
    queryFn: async () => {
      const { data, error } = await supabase.from("upsell_clients")
        .select("external_id,name,company,cnpj,erp_status,erp_segment,erp_registered_at,erp_city,erp_uf,erp_owner_name,erp_owner_external_id,erp_metadata")
        .eq("organization_id", organizationId!).eq("lead_id", leadId!).eq("external_source", "toth")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
  // Desabilitar a flag não pode deixar um snapshot antigo do cache na ficha.
  return { ...query, data: active ? query.data : undefined, isFetching: active && query.isFetching, isError: active && query.isError };
}
