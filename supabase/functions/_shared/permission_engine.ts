/**
 * Permission Engine — resolução granular de permissões
 *
 * Cascata:
 * master → admin → feature_permissions (is_admin_only) →
 *   member_feature_permissions → feature_permissions.default_value
 *
 * Mantém compatibilidade com a matriz legada (team_member_permissions)
 * para as 9 recursos × 5 ações da matriz legada.
 *
 * Toda tentativa bloqueada é logada em runtime_logs.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logRuntime } from "./logger.ts";

// ─── Types ───────────────────────────────────────────────

export type PermissionAction =
  | "move_pipe_record"
  | "import_leads"
  | "create_lead"
  | "delete_lead"
  | "trigger_campaign"
  | "edit_workflow"
  | "export_leads"
  | "view_lead"
  | "send_message"
  | "manage_team"
  | "manage_copilot";

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

// Mapeamento de ação legada para recurso+ação na matriz team_member_permissions
const ACTION_TO_MATRIX: Record<PermissionAction, { resource: string; action: string } | null> = {
  move_pipe_record: null, // Usa permissão contextual por pipe
  import_leads:     { resource: "leads", action: "create" },
  create_lead:      { resource: "leads", action: "create" },
  delete_lead:      { resource: "leads", action: "delete" },
  trigger_campaign: { resource: "campanhas", action: "edit" },
  edit_workflow:    null, // Usa feature_permissions
  export_leads:     { resource: "leads", action: "export" },
  view_lead:        { resource: "leads", action: "view" },
  send_message:     null, // Qualquer membro autenticado pode enviar
  manage_team:      null, // Usa feature_permissions
  manage_copilot:   null, // Usa feature_permissions
};

// Mapeamento de ação legada para feature_key no novo sistema
const ACTION_TO_FEATURE: Partial<Record<PermissionAction, string>> = {
  edit_workflow:  "workflows.edit",
  manage_team:    "team.view",
  manage_copilot: "copilot.create",
  send_message:   "whatsapp.send_messages",
};

// ─── Helper ──────────────────────────────────────────────

function getServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ─── canUserPerformAction ────────────────────────────────

export async function canUserPerformAction(params: {
  supabase?: SupabaseClient;
  userId: string;
  organizationId: string;
  action: PermissionAction;
  resourceId?: string;
}): Promise<PermissionResult> {
  const { userId, organizationId, action, resourceId } = params;
  const supabase = params.supabase || getServiceClient();

  // 1. Master — sempre permitido
  const { data: masterRow } = await supabase
    .from("master_users")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (masterRow) {
    return { allowed: true, reason: "master_user" };
  }

  // 2. Buscar team_member na organização
  const { data: tm } = await supabase
    .from("team_members")
    .select("id, role")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .maybeSingle();

  if (!tm) {
    await logDenied(userId, organizationId, action, "not_org_member");
    return { allowed: false, reason: "Você não pertence a esta organização" };
  }

  const isAdmin = tm.role === "admin";

  // 3. Admin — sempre permitido
  if (isAdmin) {
    return { allowed: true, reason: "admin" };
  }

  // 4. Verificar no novo sistema de feature_permissions
  const featureKey = ACTION_TO_FEATURE[action];
  if (featureKey) {
    const allowed = await checkFeaturePermission(supabase, tm.id, featureKey);
    if (!allowed) {
      await logDenied(userId, organizationId, action, `feature_denied:${featureKey}`);
      return { allowed: false, reason: `Sem permissão: ${featureKey}` };
    }
    return { allowed: true, reason: `feature:${featureKey}` };
  }

  // 5. Permissões baseadas em org_permission_key (can_delete_leads, etc.)
  if (action === "delete_lead") {
    const allowed = await checkOrgPermission(supabase, tm.id, organizationId, tm.role, "can_delete_leads");
    if (!allowed) {
      await logDenied(userId, organizationId, action, "can_delete_leads_denied");
      return { allowed: false, reason: "Você não tem permissão para excluir leads" };
    }
    return { allowed: true, reason: "can_delete_leads" };
  }

  // 6. Verificar na matriz legada team_member_permissions
  const matrixMapping = ACTION_TO_MATRIX[action];
  if (matrixMapping) {
    const matrixResult = await checkMatrixPermission(
      supabase, tm.id, matrixMapping.resource, matrixMapping.action
    );

    if (matrixResult === "denied") {
      await logDenied(userId, organizationId, action, "matrix_denied");
      return { allowed: false, reason: `Sem permissão: ${matrixMapping.resource}.${matrixMapping.action}` };
    }

    return { allowed: true, reason: `matrix_${matrixResult}` };
  }

  // 7. Para move_pipe_record, verificar se tem alguma permissão no pipe
  if (action === "move_pipe_record" && resourceId) {
    const matrixResult = await checkMatrixPermission(supabase, tm.id, resourceId, "edit");
    if (matrixResult === "denied") {
      await logDenied(userId, organizationId, action, `matrix_denied_${resourceId}`);
      return { allowed: false, reason: `Sem permissão para mover registros neste funil` };
    }
    return { allowed: true, reason: `matrix_${matrixResult}` };
  }

  // 8. Fallback: deny by default — every action must be explicitly mapped
  return { allowed: false, reason: "permission_not_defined" };
}

// ─── canUserAccessFeature ────────────────────────────────

/**
 * Verifica se um usuário pode acessar uma feature específica.
 * Consulta feature_permissions + member_feature_permissions.
 */
export async function canUserAccessFeature(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string,
  featureKey: string,
): Promise<boolean> {
  // 1. Master sempre pode
  const { data: masterRow } = await supabase
    .from("master_users")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (masterRow) return true;

  // 2. Buscar team_member
  const { data: tm } = await supabase
    .from("team_members")
    .select("id, role")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .maybeSingle();

  if (!tm) return false;

  // 3. Admin sempre pode
  if (tm.role === "admin") return true;

  return checkFeaturePermission(supabase, tm.id, featureKey);
}

// ─── Helpers internos ────────────────────────────────────

async function checkFeaturePermission(
  supabase: SupabaseClient,
  teamMemberId: string,
  featureKey: string,
): Promise<boolean> {
  // 1. Buscar definição da feature
  const { data: feature } = await supabase
    .from("feature_permissions")
    .select("is_admin_only, default_value")
    .eq("key", featureKey)
    .maybeSingle();

  if (!feature) return false;
  if (feature.is_admin_only) return false;

  // 2. Buscar override do membro
  const { data: override } = await supabase
    .from("member_feature_permissions")
    .select("enabled")
    .eq("team_member_id", teamMemberId)
    .eq("feature_key", featureKey)
    .maybeSingle();

  if (override) return override.enabled;

  // 3. Usar default da feature
  return feature.default_value;
}

async function checkOrgPermission(
  supabase: SupabaseClient,
  teamMemberId: string,
  organizationId: string,
  role: string,
  permissionKey: string,
): Promise<boolean> {
  // 1. Override individual
  const { data: override } = await supabase
    .from("team_member_org_permissions")
    .select("enabled")
    .eq("team_member_id", teamMemberId)
    .eq("permission_key", permissionKey)
    .maybeSingle();

  if (override) return override.enabled;

  // 2. Permissão do role
  const { data: rolePerm } = await supabase
    .from("organization_role_permissions")
    .select("enabled")
    .eq("organization_id", organizationId)
    .eq("role", role)
    .eq("permission_key", permissionKey)
    .maybeSingle();

  if (rolePerm) return rolePerm.enabled;

  // 3. Default
  return false;
}

async function checkMatrixPermission(
  supabase: SupabaseClient,
  teamMemberId: string,
  resource: string,
  action: string,
): Promise<string> {
  const { data } = await supabase
    .from("team_member_permissions")
    .select("value")
    .eq("team_member_id", teamMemberId)
    .eq("resource_key", resource)
    .eq("action_key", action)
    .maybeSingle();

  // Se não tem registro, default = allowed (compatibilidade com orgs que não configuraram)
  return data?.value || "allowed";
}

async function logDenied(
  userId: string,
  organizationId: string,
  action: string,
  reason: string,
): Promise<void> {
  await logRuntime({
    organizationId,
    module: "permission",
    action: `denied:${action}`,
    status: "error",
    errorMessage: reason,
    entityType: "user",
    entityId: userId,
  });
}
