/**
 * useResetOrgRolePermissions — bulk mutation that sets all 12 toggles
 * back to enabled=true (the default after backfill 2026-05-20).
 *
 * Implementation: parallel upserts for organization_role_permissions rows
 * and a single batched UPDATE for feature_permissions defaults.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "../../org-team/hooks/useOrganization";
import { ALL_PERMISSIONS } from "@/lib/permission-catalog";
import { QUERY_KEY_ORP, QUERY_KEY_FP } from "./useOrgRolePermissions";

export function useResetOrgRolePermissions() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("Sem organização ativa.");

      const orgRoleRows = ALL_PERMISSIONS
        .filter((p) => p.storage === "organization_role_permissions")
        .map((p) => ({
          organization_id: organizationId,
          role: "member",
          permission_key: p.key,
          enabled: true,
        }));

      const featureKeys = ALL_PERMISSIONS
        .filter((p) => p.storage === "feature_permissions" && p.featureKey)
        .map((p) => p.featureKey!) as string[];

      // 1. Upsert all org_role_permissions
      if (orgRoleRows.length > 0) {
        const { error } = await supabase
          .from("organization_role_permissions")
          .upsert(orgRoleRows, { onConflict: "organization_id,role,permission_key" });
        if (error) throw error;
      }

      // 2. Update feature_permissions defaults (one query per key — small N)
      if (featureKeys.length > 0) {
        const { error } = await supabase
          .from("feature_permissions")
          .update({ default_value: true })
          .in("key", featureKeys);
        if (error) throw error;
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ORP, organizationId] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY_FP, organizationId] });
      queryClient.invalidateQueries({ queryKey: ["my-permissions"] });
      queryClient.invalidateQueries({ queryKey: ["permission"] });
      queryClient.invalidateQueries({ queryKey: ["can-perform"] });
      queryClient.invalidateQueries({ queryKey: ["feature-permissions"] });
    },
  });
}
