/**
 * Ponto central de permissões no frontend.
 *
 * Hooks canônicos (novos):
 * - useIdentity()       → identity completa (role, master, features)
 * - useCanDo(action)    → { allowed, reason, isLoading }
 *
 * Imperativos:
 * - assertPermission(action) → throws se negado (para mutations)
 *
 * Legacy (mantidos por compatibilidade):
 * - usePermission(key)  → boolean via RPC (single org permission)
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "../hooks/useOrganization";
import { useUserRole } from "../hooks/useUserRole";
import { useIdentity } from "../auth/hooks/useIdentity";
import type { PermissionKey } from "../hooks/usePermissions";
import {
  ACTION_TO_FEATURE as CANONICAL_ACTION_TO_FEATURE,
  type AppAction,
} from "@/shared/permission-actions";

export type { AppAction };

interface ActionResult {
  allowed: boolean;
  reason?: string;
  isLoading: boolean;
}

const ACTION_TO_ORG_PERMISSION: Partial<Record<AppAction, PermissionKey>> = {
  delete_lead:       "can_delete_leads",
  view_lead:         "see_all_leads",
  create_lead:       "can_create_leads",
  export_leads:      "can_export_leads",
  move_pipe_record:  "can_move_pipe_records",
  trigger_campaign:  "can_manage_campaigns",
  create_campaign:   "can_manage_campaigns",
  edit_campaign:     "can_manage_campaigns",
  delete_campaign:   "can_manage_campaigns",
};

const ACTION_TO_MATRIX: Partial<Record<AppAction, { resource: string; action: string }>> = {
  import_leads: { resource: "leads", action: "create" },
};

const ACTION_TO_FEATURE: Partial<Record<AppAction, string>> = {
  edit_workflow: "workflows.edit",
  create_workflow: "workflows.create",
  manage_team: "team.view",
  manage_copilot: "copilot.create",
  reassign_lead: "leads.reassign",
  remove_lead_from_pipe: "leads.remove_from_pipe",
};

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

export function usePermission(permissionKey: PermissionKey) {
  const { data: userRole } = useUserRole();
  const { organizationId, isReady } = useOrganization();
  const { isMaster } = useIdentity();

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

// ─── Imperative helpers (for use inside mutations) ───────

/**
 * Imperative permission check for mutations.
 * Calls is_user_admin RPC (which includes master check after DB fix).
 * For non-admin/master, checks feature permission via RPC.
 */
export async function assertPermissionClient(action: AppAction): Promise<void> {
  const { data: isAdmin } = await supabase.rpc("is_user_admin");
  if (isAdmin === true) return;

  const featureKey = CANONICAL_ACTION_TO_FEATURE[action];
  if (!featureKey) {
    throw new Error(`Ação desconhecida: ${action}`);
  }

  const { data: hasPermission } = await supabase.rpc("user_has_org_permission", {
    p_permission_key: featureKey,
  });
  if (hasPermission !== true) {
    throw new Error(`Sem permissão: ${featureKey}`);
  }
}

export { assertPermissionClient as assertPermission };
