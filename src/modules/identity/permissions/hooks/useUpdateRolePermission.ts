/**
 * useUpdateRolePermission — single mutation that abstracts the storage split.
 *
 * Catalog entry's `storage` field decides:
 *   - 'organization_role_permissions' → UPSERT (org_id, role='member', key, enabled).
 *   - 'feature_permissions'           → UPDATE feature_permissions SET default_value
 *                                       WHERE key = featureKey.
 *
 * Optimistic update on the aggregated cache (useOrgRolePermissions). Invalidates
 * dependent caches on success/rollback.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "../../org-team/hooks/useOrganization";
import { findPermissionByKey } from "@/lib/permission-catalog";
import { QUERY_KEY_ORP, QUERY_KEY_FP } from "./useOrgRolePermissions";

export interface UpdateRolePermissionInput {
  key: string;
  enabled: boolean;
}

export function useUpdateRolePermission() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ key, enabled }: UpdateRolePermissionInput) => {
      if (!organizationId) throw new Error("Sem organização ativa.");
      const def = findPermissionByKey(key);
      if (!def) throw new Error(`Permissão desconhecida: ${key}`);

      if (def.storage === "organization_role_permissions") {
        const { error } = await supabase
          .from("organization_role_permissions")
          .upsert(
            {
              organization_id: organizationId,
              role: "member",
              permission_key: key,
              enabled,
            },
            { onConflict: "organization_id,role,permission_key" },
          );
        if (error) throw error;
      } else if (def.storage === "feature_permissions") {
        if (!def.featureKey) {
          throw new Error(`Catalog inválido: ${key} sem featureKey.`);
        }
        const { error } = await supabase
          .from("feature_permissions")
          .update({ default_value: enabled })
          .eq("key", def.featureKey);
        if (error) throw error;
      }

      return { key, enabled };
    },
    onMutate: async ({ key, enabled }) => {
      // Optimistic: patch the cached row, return rollback context.
      await queryClient.cancelQueries({ queryKey: [QUERY_KEY_ORP, organizationId] });
      await queryClient.cancelQueries({ queryKey: [QUERY_KEY_FP, organizationId] });
      const def = findPermissionByKey(key);
      if (!def) return { prevOrp: null, prevFp: null };

      if (def.storage === "organization_role_permissions") {
        const prev = queryClient.getQueryData<{ permission_key: string; enabled: boolean }[]>(
          [QUERY_KEY_ORP, organizationId],
        );
        if (prev) {
          const existing = prev.find((r) => r.permission_key === key);
          const next = existing
            ? prev.map((r) => (r.permission_key === key ? { ...r, enabled } : r))
            : [...prev, { permission_key: key, enabled }];
          queryClient.setQueryData([QUERY_KEY_ORP, organizationId], next);
        }
        return { prevOrp: prev, prevFp: null };
      } else if (def.storage === "feature_permissions" && def.featureKey) {
        const prev = queryClient.getQueryData<{ key: string; default_value: boolean }[]>(
          [QUERY_KEY_FP, organizationId],
        );
        if (prev) {
          const next = prev.map((r) =>
            r.key === def.featureKey ? { ...r, default_value: enabled } : r,
          );
          queryClient.setQueryData([QUERY_KEY_FP, organizationId], next);
        }
        return { prevOrp: null, prevFp: prev };
      }
      return { prevOrp: null, prevFp: null };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevOrp !== undefined && ctx.prevOrp !== null) {
        queryClient.setQueryData([QUERY_KEY_ORP, organizationId], ctx.prevOrp);
      }
      if (ctx?.prevFp !== undefined && ctx.prevFp !== null) {
        queryClient.setQueryData([QUERY_KEY_FP, organizationId], ctx.prevFp);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ORP, organizationId] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY_FP, organizationId] });
      // Also invalidate caches that depend on org permissions.
      queryClient.invalidateQueries({ queryKey: ["my-permissions"] });
      queryClient.invalidateQueries({ queryKey: ["permission"] });
      queryClient.invalidateQueries({ queryKey: ["can-perform"] });
      queryClient.invalidateQueries({ queryKey: ["feature-permissions"] });
    },
  });
}
