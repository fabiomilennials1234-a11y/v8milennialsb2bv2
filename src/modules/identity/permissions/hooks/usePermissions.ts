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
    staleTime: 5 * 60 * 1000,
  });
}

export interface TeamMemberOrgPermission {
  id: string;
  team_member_id: string;
  permission_key: PermissionKey;
  enabled: boolean;
}

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

/**
 * Lista permissões de um membro da equipe (seleção múltipla).
 * Admin usa para editar quais features o membro tem.
 */
export function useTeamMemberOrgPermissions(teamMemberId: string | null) {
  return useQuery({
    queryKey: ["team-member-org-permissions", teamMemberId],
    queryFn: async (): Promise<Record<PermissionKey, boolean>> => {
      if (!teamMemberId) {
        return PERMISSION_KEYS.reduce((acc, k) => ({ ...acc, [k]: false }), {} as Record<PermissionKey, boolean>);
      }
      const { data, error } = await supabase
        .from("team_member_org_permissions")
        .select("permission_key, enabled")
        .eq("team_member_id", teamMemberId);
      if (error) throw error;
      const map = PERMISSION_KEYS.reduce((acc, k) => ({ ...acc, [k]: false }), {} as Record<PermissionKey, boolean>);
      (data || []).forEach((row: { permission_key: PermissionKey; enabled: boolean }) => {
        if (PERMISSION_KEYS.includes(row.permission_key)) map[row.permission_key] = row.enabled;
      });
      return map;
    },
    enabled: !!teamMemberId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Salva permissões (seleção múltipla) de um membro da equipe.
 * Substitui todas as linhas do team_member por um upsert por permission_key.
 */
export function useSaveTeamMemberOrgPermissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      teamMemberId,
      permissions,
    }: {
      teamMemberId: string;
      permissions: Record<PermissionKey, boolean>;
    }) => {
      const rows = PERMISSION_KEYS.filter((k) => permissions[k]).map((k) => ({
        team_member_id: teamMemberId,
        permission_key: k,
        enabled: true,
      }));
      const { error: delErr } = await supabase
        .from("team_member_org_permissions")
        .delete()
        .eq("team_member_id", teamMemberId);
      if (delErr) throw delErr;
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("team_member_org_permissions").insert(rows);
        if (insErr) throw insErr;
      }
    },
    onSuccess: (_, { teamMemberId }) => {
      queryClient.invalidateQueries({ queryKey: ["team-member-org-permissions", teamMemberId] });
      queryClient.invalidateQueries({ queryKey: ["my-permissions"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Erro ao salvar permissões");
    },
  });
}
