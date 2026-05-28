import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { categorizeStaleLeads } from "@/lib/metrics-calculations";
import type { StaleLeadsSummary } from "@/lib/metrics-calculations";

export interface StaleLead {
  id: string;
  name: string;
  company_name: string | null;
  responsible_id: string | null;
  days_inactive: number;
}

interface UseStaleLeadsOptions {
  daysThreshold?: number;
  memberId?: string | null;
}

export function useStaleLeads({ daysThreshold = 7, memberId }: UseStaleLeadsOptions = {}) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["stale-leads", organizationId, daysThreshold, memberId ?? "all"],
    queryFn: async (): Promise<{ leads: StaleLead[]; summary: StaleLeadsSummary }> => {
      const { data, error } = await supabase.rpc("get_stale_leads", {
        p_org_id: organizationId!,
        p_days_threshold: daysThreshold,
        p_member_id: memberId ?? null,
      });

      if (error) throw error;

      const leads = (data as StaleLead[]) ?? [];
      const summary = categorizeStaleLeads(leads);
      return { leads, summary };
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}
