/**
 * useOrgQuotas — expõe breakdown de quotas por recurso via org_resolve_all_quotas.
 *
 * SECURITY: Always scoped to current user's organization.
 *
 * Uso:
 *   const { getQuota, isLoading } = useOrgQuotas();
 *   const whatsapp = getQuota('max_whatsapp_instances');
 *   // → { effective_limit: 5, current_usage: 3, can_add: true, remaining: 2, ... }
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import type { LimitKey } from "@/lib/feature-registry";

export interface QuotaInfo {
  plan_base: number;
  purchased_addons: number;
  admin_adjustment: number;
  effective_limit: number;
  current_usage: number;
  is_unlimited: boolean;
  can_add: boolean;
  remaining: number;
}

type QuotaResource = "max_whatsapp_instances" | "max_users" | "max_copilot_agents";

const EMPTY_QUOTA: QuotaInfo = {
  plan_base: 0,
  purchased_addons: 0,
  admin_adjustment: 0,
  effective_limit: -1,
  current_usage: 0,
  is_unlimited: true,
  can_add: true,
  remaining: -1,
};

export function useOrgQuotas() {
  const { organizationId, isLoading: orgLoading } = useOrganization();
  const queryClient = useQueryClient();

  const { data, isLoading: queryLoading } = useQuery<Record<string, QuotaInfo>>({
    queryKey: ["org-quotas", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("org_resolve_all_quotas", {
        p_org_id: organizationId!,
      });
      if (error) throw error;
      return data as unknown as Record<string, QuotaInfo>;
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const isLoading = orgLoading || queryLoading;

  const getQuota = (key: QuotaResource | LimitKey): QuotaInfo => {
    // While loading, return permissive defaults (same UX as checkLimit returning -1)
    if (!data) return EMPTY_QUOTA;
    return data[key] ?? EMPTY_QUOTA;
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["org-quotas", organizationId] });
    // Also invalidate features since they share limit data
    queryClient.invalidateQueries({ queryKey: ["org-features", organizationId] });
  };

  return { getQuota, isLoading, invalidate };
}
