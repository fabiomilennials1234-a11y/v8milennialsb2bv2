import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

export interface LeadResponsiblesSummary {
  preSaleName: string | null;
  saleName: string | null;
}

/** Papéis atuais do lead; autoria e snapshots de reuniões não são alterados. */
export function useLeadResponsibles(leadId: string | null) {
  const { organizationId, isReady } = useOrganization();
  return useQuery({
    queryKey: ["lead-responsibles", leadId, organizationId],
    queryFn: async (): Promise<LeadResponsiblesSummary | null> => {
      if (!leadId || !organizationId) return null;
      const { data, error } = await supabase
        .from("leads")
        .select(`
          pre_sale_responsible:team_members!leads_pre_sale_responsible_id_fkey(name),
          sale_responsible:team_members!leads_sale_responsible_id_fkey(name)
        `)
        .eq("id", leadId)
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        preSaleName: data.pre_sale_responsible?.name ?? null,
        saleName: data.sale_responsible?.name ?? null,
      };
    },
    enabled: !!leadId && !!organizationId && isReady,
    staleTime: 30_000,
  });
}
