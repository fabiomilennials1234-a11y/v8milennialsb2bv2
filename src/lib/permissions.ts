/**
 * Ponto central de permissões no frontend.
 *
 * Cascata:
 * master → admin → feature_permissions → member_feature_permissions
 *
 * Hooks disponíveis:
 * - usePermission(key)          → boolean | undefined (single org permission)
 * - useCanPerformAction(action) → { allowed, reason, isLoading }
 * - useAllPermissions()         → Record<PermissionKey, boolean>
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useUserRole, useFeaturePermissions } from "@/hooks/useUserRole";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useMasterAuth } from "@/hooks/useMasterAuth";
import { useTeamMemberMatrixPermissions } from "@/hooks/useTeamMemberMatrixPermissions";
import type { PermissionKey } from "@/hooks/usePermissions";

// ─── Types ───────────────────────────────────────────────

export type AppAction =
  | "import_leads"
  | "create_lead"
  | "delete_lead"
  | "export_leads"
  | "view_lead"
  | "reassign_lead"
  | "remove_lead_from_pipe"
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

// Mapeamento de ação para resource_key + action_key na matriz legada
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

// Mapeamento de ação para feature_key no novo sistema
const ACTION_TO_FEATURE: Partial<Record<AppAction, string>> = {
  edit_workflow: "workflows.edit",
  create_workflow: "workflows.create",
  manage_team: "team.view",
  manage_copilot: "copilot.create",
  reassign_lead: "leads.reassign",
  remove_lead_from_pipe: "leads.remove_from_pipe",
};

// ─── resolveAction (pure) ─────────────────────────────────

export interface ResolveActionContext {
  isMaster: boolean;
  role: string | null | undefined;
  featurePermissions: Record<string, boolean>;
  matrixPermissions: Map<string, "allowed" | "denied">;
}

export interface ResolveActionResult {
  allowed: boolean;
  reason: string;
}

/**
 * Pure permission resolver. No React, no IO.
 *
 * Cascade: master → admin → ACTION_TO_FEATURE → ACTION_TO_MATRIX
 *          → open actions (send_message) → fail-closed (unmapped_action).
 *
 * Default for matrix actions without an explicit entry is "allowed",
 * mirroring the server-side engine (supabase/functions/_shared/permission_engine.ts).
 */
export function resolveAction(
  action: AppAction,
  ctx: ResolveActionContext,
): ResolveActionResult {
  if (ctx.isMaster) return { allowed: true, reason: "admin" };
  if (ctx.role === "admin") return { allowed: true, reason: "admin" };

  const featureKey = ACTION_TO_FEATURE[action];
  if (featureKey) {
    const allowed = ctx.featurePermissions[featureKey] === true;
    return {
      allowed,
      reason: allowed ? `feature:${featureKey}` : `Sem permissão: ${featureKey}`,
    };
  }

  const matrixMapping = ACTION_TO_MATRIX[action];
  if (matrixMapping) {
    const key = `${matrixMapping.resource}:${matrixMapping.action}`;
    const value = ctx.matrixPermissions.get(key);
    if (value === "denied") {
      return { allowed: false, reason: `matrix_denied:${matrixMapping.resource}.${matrixMapping.action}` };
    }
    return { allowed: true, reason: value === "allowed" ? "matrix_allowed" : "matrix_default_allowed" };
  }

  if (action === "send_message") {
    return { allowed: true, reason: "open" };
  }

  return { allowed: false, reason: "unmapped_action" };
}

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

// ─── useCanPerformAction ─────────────────────────────────

/**
 * Verifica se o usuário pode executar uma ação específica.
 * Usa feature_permissions para ações mapeadas.
 */
export function useCanPerformAction(action: AppAction): ActionResult {
  const { data: userRole, isLoading: roleLoading } = useUserRole();
  const { data: teamMember, isLoading: tmLoading } = useCurrentTeamMember();
  const { isReady } = useOrganization();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();
  const { data: featurePerms, isLoading: featureLoading } = useFeaturePermissions();
  const { data: matrixPerms, isLoading: matrixLoading } = useTeamMemberMatrixPermissions(teamMember?.id);

  const isLoading =
    roleLoading || tmLoading || masterLoading || !isReady || featureLoading || matrixLoading;

  if (isLoading) return { allowed: false, isLoading: true };

  const role = userRole?.role ?? teamMember?.role ?? null;
  const result = resolveAction(action, {
    isMaster,
    role,
    featurePermissions: featurePerms ?? {},
    matrixPermissions: matrixPerms ?? new Map(),
  });

  return { allowed: result.allowed, reason: result.reason, isLoading: false };
}

// ─── useCanPerformActionAsync ────────────────────────────

export interface AsyncActionResult {
  allowed: boolean;
  reason: string;
  isLoading: boolean;
}

/**
 * Versão assíncrona de useCanPerformAction. Consulta a cascata completa
 * incluindo team_member_permissions e org_permissions via RPC.
 *
 * **Fail-closed contract** — sempre retorna um objeto estável
 * `{ allowed, reason, isLoading }`. Enquanto qualquer dependência
 * (role, team_member, master, org) está carregando, `allowed = false`
 * e `isLoading = true`. Isso evita o padrão histórico de caller
 * `if (perm && !perm.allowed)` que silenciosamente liberava a ação quando
 * `perm` ainda era `undefined` (incidente backlog
 * `permissions-fallback-fail-closed`).
 */
export function useCanPerformActionAsync(action: AppAction): AsyncActionResult {
  const { data: userRole, isLoading: roleLoading } = useUserRole();
  const { data: teamMember, isLoading: tmLoading } = useCurrentTeamMember();
  const { organizationId, isReady } = useOrganization();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();
  const { data: featurePerms } = useFeaturePermissions();

  const role = userRole?.role ?? teamMember?.role;
  const isAdmin = isMaster || role === "admin";

  const depsLoading = roleLoading || tmLoading || masterLoading || !isReady;

  const query = useQuery({
    queryKey: ["can-perform", action, organizationId, role, teamMember?.id, isMaster],
    queryFn: async (): Promise<{ allowed: boolean; reason: string }> => {
      if (!organizationId) return { allowed: false, reason: "no_org" };
      if (isAdmin) return { allowed: true, reason: "admin" };

      // Feature-based
      const featureKey = ACTION_TO_FEATURE[action];
      if (featureKey) {
        const allowed = featurePerms?.[featureKey] === true;
        return { allowed, reason: allowed ? `feature:${featureKey}` : `Sem permissão` };
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

      // Check matrix permission (legacy)
      const matrixMapping = ACTION_TO_MATRIX[action];
      if (matrixMapping && teamMember?.id) {
        const { data } = await supabase
          .from("team_member_permissions")
          .select("value")
          .eq("team_member_id", teamMember.id)
          .eq("resource_key", matrixMapping.resource)
          .eq("action_key", matrixMapping.action)
          .maybeSingle();

        const value = data?.value || "allowed";
        if (value === "denied") {
          return { allowed: false, reason: `${matrixMapping.resource}.${matrixMapping.action} negado` };
        }
        return { allowed: true, reason: `matrix_${value}` };
      }

      return { allowed: false, reason: "unmapped_action" };
    },
    enabled: !depsLoading && !!role,
    staleTime: 5 * 60 * 1000,
  });

  // Fail-closed wrapper: while deps OR the query itself is loading, deny.
  if (depsLoading) {
    return { allowed: false, reason: "loading", isLoading: true };
  }
  if (!role) {
    return { allowed: false, reason: "no_role", isLoading: false };
  }
  if (query.isLoading || query.data === undefined) {
    return { allowed: false, reason: "loading", isLoading: true };
  }
  return { allowed: query.data.allowed, reason: query.data.reason, isLoading: false };
}

// ─── useAllPermissions ───────────────────────────────────

export { useMyPermissions as useAllPermissions } from "@/hooks/usePermissions";

// ─── Imperative helpers (for use inside mutations) ───────

export async function assertIsAdmin(): Promise<void> {
  const { data } = await supabase.rpc("is_user_admin");
  if (data !== true) {
    throw new Error("Apenas administradores podem realizar esta ação");
  }
}

export async function assertOrgPermission(permissionKey: string, message?: string): Promise<void> {
  const { data } = await supabase.rpc("user_has_org_permission", {
    p_permission_key: permissionKey,
  });
  if (data !== true) {
    throw new Error(message || `Sem permissão: ${permissionKey}`);
  }
}

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
