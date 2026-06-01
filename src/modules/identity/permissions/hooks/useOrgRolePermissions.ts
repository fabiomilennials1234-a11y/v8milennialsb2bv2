/**
 * useOrgRolePermissions — aggregates the 12 permission toggles in
 * Pitstop > Permissões into a single Map<key, boolean>.
 *
 * Sources:
 *   - organization_role_permissions (role='member') for 9 keys.
 *   - feature_permissions.default_value for 3 management keys (mapped via
 *     PERMISSION_GROUPS catalog featureKey).
 *
 * Subscribes to both tables via Realtime so toggles by other admins
 * propagate within ~1s. Debounce 2s aligned with project convention.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "../../hooks/useOrganization";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import { ALL_PERMISSIONS, PERMISSION_GROUPS } from "@/lib/permission-catalog";

export interface OrgRolePermissionsMap {
  values: Map<string, boolean>;
  isLoading: boolean;
}

const QUERY_KEY_ORP = "org-role-permissions-map";
const QUERY_KEY_FP = "feature-permissions-defaults-map";

export function useOrgRolePermissions(): OrgRolePermissionsMap {
  const { organizationId, isReady } = useOrganization();

  // Realtime: invalidate cache on any change to either source.
  useRealtimeSubscription("organization_role_permissions", [QUERY_KEY_ORP]);
  useRealtimeSubscription("feature_permissions", [QUERY_KEY_FP]);

  // 1. organization_role_permissions (member role)
  const orgRolePerms = useQuery({
    queryKey: [QUERY_KEY_ORP, organizationId],
    queryFn: async () => {
      if (!organizationId) return [] as { permission_key: string; enabled: boolean }[];
      const { data, error } = await supabase
        .from("organization_role_permissions")
        .select("permission_key, enabled")
        .eq("organization_id", organizationId)
        .eq("role", "member");
      if (error) throw error;
      return (data ?? []) as { permission_key: string; enabled: boolean }[];
    },
    enabled: isReady && !!organizationId,
    staleTime: 30 * 1000,
  });

  // 2. feature_permissions (defaults — global, not org-scoped, but cheap)
  const featureDefaults = useQuery({
    queryKey: [QUERY_KEY_FP, organizationId],
    queryFn: async () => {
      const featureKeys = PERMISSION_GROUPS
        .flatMap((g) => g.permissions)
        .filter((p) => p.storage === "feature_permissions" && p.featureKey)
        .map((p) => p.featureKey!) as string[];
      if (featureKeys.length === 0) return [] as { key: string; default_value: boolean }[];
      const { data, error } = await supabase
        .from("feature_permissions")
        .select("key, default_value")
        .in("key", featureKeys);
      if (error) throw error;
      return (data ?? []) as { key: string; default_value: boolean }[];
    },
    enabled: isReady,
    staleTime: 30 * 1000,
  });

  const values = useMemo(() => {
    const map = new Map<string, boolean>();
    // Default: false for everything (fail-closed at read time too).
    for (const p of ALL_PERMISSIONS) map.set(p.key, false);

    // Apply org_role_permissions rows.
    for (const row of orgRolePerms.data ?? []) {
      // Only set if the key exists in catalog.
      if (map.has(row.permission_key)) map.set(row.permission_key, !!row.enabled);
    }

    // Apply feature_permissions defaults — catalog key maps to featureKey.
    for (const p of ALL_PERMISSIONS) {
      if (p.storage === "feature_permissions" && p.featureKey) {
        const row = (featureDefaults.data ?? []).find((r) => r.key === p.featureKey);
        if (row) map.set(p.key, !!row.default_value);
      }
    }
    return map;
  }, [orgRolePerms.data, featureDefaults.data]);

  return {
    values,
    isLoading: orgRolePerms.isLoading || featureDefaults.isLoading,
  };
}

export { QUERY_KEY_ORP, QUERY_KEY_FP };
