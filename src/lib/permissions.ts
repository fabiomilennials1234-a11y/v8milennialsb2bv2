/**
 * Ponto central de permissões no frontend.
 *
 * Componentes NÃO devem chamar Supabase diretamente para checar permissão.
 * Em vez disso, usam os hooks deste módulo que seguem a cascata:
 * master → admin → team_member_org_permissions → organization_role_permissions
 *                 → team_member_permissions → false
 *
 * Hooks disponíveis:
 * - usePermission(key)         → boolean | undefined (single org permission)
 * - useCanPerformAction(action) → { allowed, reason, isLoading }
 * - useAllPermissions()         → Record<PermissionKey, boolean>
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useUserRole } from "@/hooks/useUserRole";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useMasterAuth } from "@/hooks/useMasterAuth";
import type { PermissionKey } from "@/hooks/usePermissions";

// ─── Types ───────────────────────────────────────────────

export type AppAction =
  | "import_leads"
  | "create_lead"
  | "delete_lead"
  | "export_leads"
  | "view_lead"
  | "move_pipe_record"
  | "trigger_campaign"
  | "create_campaign"
  | "edit_campaign"
  | "delete_campaign"
  | "edit_workflow"
  | "create_workflow"
  | "send_message"
  | "manage_team"
  | "manage_copilot";

interface ActionResult {
  allowed: boolean;
  reason?: string;
  isLoading: boolean;
}

// Mapeamento de ação para permission_key de organização
const ACTION_TO_ORG_PERMISSION: Partial<Record<AppAction, PermissionKey>> = {
  delete_lead: "can_delete_leads",
  view_lead: "see_all_leads",
};

// Mapeamento de ação para resource_key + action_key na matriz
const ACTION_TO_MATRIX: Partial<Record<AppAction, { resource: string; action: string }>> = {
  import_leads: { resource: "leads", action: "create" },
  create_lead: { resource: "leads", action: "create" },
  export_leads: { resource: "leads", action: "export" },
  move_pipe_record: { resource: "pipe", action: "move" },
  trigger_campaign: { resource: "campanhas", action: "create" },
  create_campaign: { resource: "campanhas", action: "create" },
  edit_campaign: { resource: "campanhas", action: "edit" },
  delete_campaign: { resource: "campanhas", action: "delete" },
};

// Ações que requerem admin obrigatório
const ADMIN_ONLY_ACTIONS: AppAction[] = [
  "edit_workflow",
  "create_workflow",
  "manage_team",
];

// Ações que admin/closer/master podem executar
const ADMIN_OR_CLOSER_ACTIONS: AppAction[] = [
  "manage_copilot",
];

// ─── usePermission ───────────────────────────────────────

/**
 * Verifica uma permissão organizacional via RPC.
 * Admin/Master sempre retorna true.
 */
export function usePermission(permissionKey: PermissionKey) {
  const { data: userRole } = useUserRole();
  const { organizationId, isReady } = useOrganization();
  const { isMaster } = useMasterAuth();

  return useQuery({
    queryKey: ["permission", permissionKey, organizationId, userRole?.role, isMaster],
    queryFn: async (): Promise<boolean> => {
      if (!organizationId) return false;
      if (isMaster) return true;
      if (userRole?.role === "admin" || userRole?.role === "agency") return true;

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

// ─── useCanPerformAction ─────────────────────────────────

/**
 * Verifica se o usuário pode executar uma ação específica.
 * Segue a cascata completa de permissões.
 */
export function useCanPerformAction(action: AppAction): ActionResult {
  const { data: userRole, isLoading: roleLoading } = useUserRole();
  const { data: teamMember, isLoading: tmLoading } = useCurrentTeamMember();
  const { organizationId, isReady } = useOrganization();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();

  const isLoading = roleLoading || tmLoading || masterLoading || !isReady;
  const role = userRole?.role ?? teamMember?.role;
  const isAdmin = isMaster || role === "admin" || role === "agency";

  // Resolução síncrona para casos simples
  if (isLoading) return { allowed: false, isLoading: true };

  // Master/admin sempre pode
  if (isAdmin) return { allowed: true, reason: "admin", isLoading: false };

  // Admin-only actions
  if (ADMIN_ONLY_ACTIONS.includes(action)) {
    return { allowed: false, reason: "Apenas administradores", isLoading: false };
  }

  // Admin/closer actions
  if (ADMIN_OR_CLOSER_ACTIONS.includes(action)) {
    if (role === "closer") return { allowed: true, reason: "closer", isLoading: false };
    return { allowed: false, reason: "Apenas administradores e closers", isLoading: false };
  }

  // Ações abertas
  if (action === "send_message") {
    return { allowed: true, reason: "open", isLoading: false };
  }

  // Para permissões que precisam de query assíncrona, usamos o hook separado
  // abaixo (useCanPerformActionAsync)
  return { allowed: true, reason: "fallback", isLoading: false };
}

// ─── useCanPerformActionAsync ────────────────────────────

/**
 * Versão assíncrona de useCanPerformAction que consulta a cascata
 * completa incluindo team_member_permissions e org_permissions.
 * Use quando precisar de verificação exata (ex: antes de importar leads).
 */
export function useCanPerformActionAsync(action: AppAction) {
  const { data: userRole, isLoading: roleLoading } = useUserRole();
  const { data: teamMember, isLoading: tmLoading } = useCurrentTeamMember();
  const { organizationId, isReady } = useOrganization();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();

  const role = userRole?.role ?? teamMember?.role;
  const isAdmin = isMaster || role === "admin" || role === "agency";

  return useQuery({
    queryKey: ["can-perform", action, organizationId, role, teamMember?.id, isMaster],
    queryFn: async (): Promise<{ allowed: boolean; reason?: string }> => {
      if (!organizationId) return { allowed: false, reason: "no_org" };
      if (isAdmin) return { allowed: true, reason: "admin" };

      // Admin-only
      if (ADMIN_ONLY_ACTIONS.includes(action)) {
        return { allowed: false, reason: "Apenas administradores" };
      }

      // Admin/closer
      if (ADMIN_OR_CLOSER_ACTIONS.includes(action)) {
        if (role === "closer") return { allowed: true, reason: "closer" };
        return { allowed: false, reason: "Apenas administradores e closers" };
      }

      // Open
      if (action === "send_message") {
        return { allowed: true, reason: "open" };
      }

      // Check org permission key
      const orgPermKey = ACTION_TO_ORG_PERMISSION[action];
      if (orgPermKey) {
        const { data } = await supabase.rpc("user_has_org_permission", {
          p_permission_key: orgPermKey,
        });
        if (data !== true) {
          return { allowed: false, reason: `Sem permissão: ${orgPermKey}` };
        }
        return { allowed: true, reason: orgPermKey };
      }

      // Check matrix permission
      const matrixMapping = ACTION_TO_MATRIX[action];
      if (matrixMapping && teamMember?.id) {
        const { data } = await supabase
          .from("team_member_permissions")
          .select("value")
          .eq("team_member_id", teamMember.id)
          .eq("resource_key", matrixMapping.resource)
          .eq("action_key", matrixMapping.action)
          .maybeSingle();

        const value = data?.value || "allowed"; // default = allowed (compatibilidade)
        if (value === "denied") {
          return { allowed: false, reason: `${matrixMapping.resource}.${matrixMapping.action} negado` };
        }
        return { allowed: true, reason: `matrix_${value}` };
      }

      return { allowed: true, reason: "fallback" };
    },
    enabled: isReady && !roleLoading && !tmLoading && !masterLoading && !!role,
    staleTime: 5 * 60 * 1000,
  });
}

// ─── useAllPermissions ───────────────────────────────────

/**
 * Carrega todas as permissões organizacionais do usuário.
 * Reutiliza useMyPermissions de usePermissions.ts.
 * Admin/master tem tudo true.
 */
export { useMyPermissions as useAllPermissions } from "@/hooks/usePermissions";

// ─── Imperative helpers (for use inside mutations) ───────

/**
 * Verifica via RPC se o usuário atual é admin.
 * Para uso dentro de mutationFn (onde hooks não podem ser chamados).
 * @throws Error se não for admin.
 */
export async function assertIsAdmin(): Promise<void> {
  const { data } = await supabase.rpc("is_user_admin");
  if (data !== true) {
    throw new Error("Apenas administradores podem realizar esta ação");
  }
}

/**
 * Verifica via RPC se o usuário tem uma permissão organizacional.
 * @throws Error se não tiver.
 */
export async function assertOrgPermission(permissionKey: string, message?: string): Promise<void> {
  const { data } = await supabase.rpc("user_has_org_permission", {
    p_permission_key: permissionKey,
  });
  if (data !== true) {
    throw new Error(message || `Sem permissão: ${permissionKey}`);
  }
}

/**
 * Verifica na matriz team_member_permissions se o membro pode executar ação.
 * Retorna true se não existe registro (default = allowed por compatibilidade).
 */
export async function checkMatrixPermission(
  teamMemberId: string,
  resource: string,
  action: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("team_member_permissions")
    .select("value")
    .eq("team_member_id", teamMemberId)
    .eq("resource_key", resource)
    .eq("action_key", action)
    .maybeSingle();

  return (data?.value || "allowed") !== "denied";
}
