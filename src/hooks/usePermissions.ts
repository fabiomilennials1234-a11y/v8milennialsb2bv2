import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { useUserRole } from "./useUserRole";

export type PermissionKey =
  | "see_unassigned_cards"
  | "see_subordinates_cards"
  | "see_general_info"
  | "see_all_leads";

export interface OrgRolePermission {
  id: string;
  organization_id: string;
  role: string;
  permission_key: PermissionKey;
  enabled: boolean;
}

/**
 * Retorna se o usuário tem uma permissão específica.
 * Admin sempre tem todas. Senão, lê organization_role_permissions.
 */
export function useHasPermission(permissionKey: PermissionKey) {
  const { data: userRole } = useUserRole();
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["permission", permissionKey, organizationId, userRole?.role],
    queryFn: async (): Promise<boolean> => {
      if (!organizationId) return false;
      if (userRole?.role === "admin") return true;

      const { data, error } = await supabase.rpc("user_has_org_permission", {
        p_permission_key: permissionKey,
      });
      if (error) throw error;
      return data === true;
    },
    enabled: isReady && !!userRole,
  });
}

/**
 * Lista todas as permissões do role atual na organização (para exibir na UI).
 * Admin não precisa (tem tudo). Usado para mostrar badges/restrições.
 */
export function useMyPermissions() {
  const { data: userRole } = useUserRole();
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["my-permissions", organizationId, userRole?.role],
    queryFn: async (): Promise<Record<PermissionKey, boolean>> => {
      const keys: PermissionKey[] = [
        "see_unassigned_cards",
        "see_subordinates_cards",
        "see_general_info",
        "see_all_leads",
      ];
      if (!organizationId) {
        return keys.reduce((acc, k) => ({ ...acc, [k]: false }), {} as Record<PermissionKey, boolean>);
      }
      if (userRole?.role === "admin") {
        return keys.reduce((acc, k) => ({ ...acc, [k]: true }), {} as Record<PermissionKey, boolean>);
      }

      const result = {} as Record<PermissionKey, boolean>;
      for (const key of keys) {
        const { data } = await supabase.rpc("user_has_org_permission", {
          p_permission_key: key,
        });
        result[key] = data === true;
      }
      return result;
    },
    enabled: isReady && !!userRole,
  });
}

/**
 * Lista permissões por role da organização (apenas admin).
 * Usado na tela de configurações para o admin habilitar/desabilitar por role.
 */
export function useOrganizationRolePermissions() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["organization-role-permissions", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("organization_role_permissions")
        .select("*")
        .eq("organization_id", organizationId)
        .order("role")
        .order("permission_key");
      if (error) throw error;
      return data as OrgRolePermission[];
    },
    enabled: isReady && !!organizationId,
  });
}
