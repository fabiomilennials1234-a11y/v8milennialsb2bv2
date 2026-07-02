import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "../../org-team/hooks/useOrganization";
import { useUserRole } from "./useUserRole";

export type PermissionKey =
  | "see_unassigned_cards"
  | "see_subordinates_cards"
  | "see_general_info"
  | "see_all_leads"
  | "can_delete_leads"
  | "can_create_leads"
  | "can_export_leads"
  | "can_move_pipe_records"
  | "can_manage_campaigns";

/**
 * Retorna se o usuário tem uma permissão específica.
 * Admin sempre tem todas. Delega para user_has_org_permission() RPC
 * que internamente mapeia org keys → feature keys.
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
    staleTime: 5 * 60 * 1000,
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
      const keys: PermissionKey[] = PERMISSION_KEYS;
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
    staleTime: 5 * 60 * 1000,
  });
}

// NOTA (2026-07-02): useOrganizationRolePermissions, useTeamMemberOrgPermissions
// e useSaveTeamMemberOrgPermissions foram REMOVIDOS — consultavam as tabelas
// organization_role_permissions/team_member_org_permissions, DROPADAS pela
// consolidação de permissões (PRD #408, migration 20261032000002). O modelo
// consolidado vive em feature_permissions (catálogo global) +
// member_feature_permissions (override por membro) — superfície de UI:
// Equipe > MemberPermissions.

const PERMISSION_KEYS: PermissionKey[] = [
  "see_unassigned_cards",
  "see_subordinates_cards",
  "see_general_info",
  "see_all_leads",
  "can_delete_leads",
  "can_create_leads",
  "can_export_leads",
  "can_move_pipe_records",
  "can_manage_campaigns",
];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  see_unassigned_cards: "Cards não atribuídos",
  see_subordinates_cards: "Cards de subordinados",
  see_general_info: "Informações gerais",
  see_all_leads: "Ver todos os leads",
  can_delete_leads: "Excluir leads",
  can_create_leads: "Criar leads",
  can_export_leads: "Exportar leads",
  can_move_pipe_records: "Mover cards no pipe",
  can_manage_campaigns: "Gerenciar campanhas",
};

