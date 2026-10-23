import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/modules/identity";

/** Ask the canonical chat policy whether this account has unrestricted scope.
 * Null lead/phone cannot match ownership; only an actual bypass returns true.
 * Strict ownership, org admins, masters and explicit exceptions stay server-owned.
 */
export function useChatVendorAccess(organizationId: string | null | undefined) {
  const { user } = useAuth();
  const access = useQuery({
    // Shares the invalidation prefix with ChatRestrictionCard, not its cache entry.
    queryKey: ["chat_restrict_to_owner", organizationId, "vendor-access", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("can_see_chat_scope", {
        p_org_id: organizationId!, p_lead_id: null, p_normalized_phone: null,
      });
      if (error) throw error;
      return data === true;
    },
    enabled: !!organizationId && !!user?.id,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  return !!organizationId && !!user?.id && access.isSuccess && access.data === true;
}
