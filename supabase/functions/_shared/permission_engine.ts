/**
 * Permission Engine — resolução granular de permissões
 *
 * Segue a cascata completa:
 * master → admin → team_member_org_permissions → organization_role_permissions
 *                 → team_member_permissions (matriz recurso×ação) → false
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

// Mapeamento de ação para recurso+ação na matriz team_member_permissions
const ACTION_TO_MATRIX: Record<PermissionAction, { resource: string; action: string } | null> = {
  move_pipe_record: null, // Usa permissão contextual por pipe
  import_leads:     { resource: "leads", action: "create" },
  create_lead:      { resource: "leads", action: "create" },
  delete_lead:      { resource: "leads", action: "delete" },
  trigger_campaign: { resource: "campanhas", action: "edit" },
  edit_workflow:    null, // Admin-only
  export_leads:     { resource: "leads", action: "export" },
  view_lead:        { resource: "leads", action: "view" },
  send_message:     null, // Qualquer membro autenticado pode enviar
  manage_team:      null, // Admin-only
  manage_copilot:   null, // Admin/closer
};

// Ações que requerem admin obrigatório (não verificam matriz)
const ADMIN_ONLY_ACTIONS: PermissionAction[] = [
  "edit_workflow",
  "manage_team",
];

// Ações que qualquer membro autenticado pode executar
const OPEN_ACTIONS: PermissionAction[] = [
  "send_message",
];

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

  const isAdmin = tm.role === "admin" || tm.role === "agency";

  // 3. Admin — sempre permitido
  if (isAdmin) {
    return { allowed: true, reason: "admin" };
  }

  // 4. Ações admin-only: bloquear não-admins
  if (ADMIN_ONLY_ACTIONS.includes(action)) {
    await logDenied(userId, organizationId, action, `role_${tm.role}_not_admin`);
    return { allowed: false, reason: "Apenas administradores podem realizar esta ação" };
  }

  // 5. Ações abertas: qualquer membro
  if (OPEN_ACTIONS.includes(action)) {
    return { allowed: true, reason: "open_action" };
  }

  // 6. Copilot: admin ou closer
  if (action === "manage_copilot") {
    if (tm.role === "closer") {
      return { allowed: true, reason: "closer_can_manage_copilot" };
    }
    await logDenied(userId, organizationId, action, `role_${tm.role}_not_allowed`);
    return { allowed: false, reason: "Apenas administradores e closers podem gerenciar o copilot" };
  }

  // 7. Permissões baseadas em org_permission_key (can_delete_leads, etc.)
  if (action === "delete_lead") {
    const allowed = await checkOrgPermission(supabase, tm.id, organizationId, tm.role, "can_delete_leads");
    if (!allowed) {
      await logDenied(userId, organizationId, action, "can_delete_leads_denied");
      return { allowed: false, reason: "Você não tem permissão para excluir leads" };
    }
    return { allowed: true, reason: "can_delete_leads" };
  }

  // 8. Verificar na matriz team_member_permissions
  const matrixMapping = ACTION_TO_MATRIX[action];
  if (matrixMapping) {
    const matrixResult = await checkMatrixPermission(
      supabase, tm.id, matrixMapping.resource, matrixMapping.action
    );

    if (matrixResult === "denied") {
      await logDenied(userId, organizationId, action, "matrix_denied");
      return { allowed: false, reason: `Sem permissão: ${matrixMapping.resource}.${matrixMapping.action}` };
    }

    // allowed, if_responsible, team_access — para estas, permitir
    // (o filtro mais fino de scope é feito via RLS)
    return { allowed: true, reason: `matrix_${matrixResult}` };
  }

  // 9. Para move_pipe_record, verificar se tem alguma permissão no pipe
  if (action === "move_pipe_record" && resourceId) {
    // resourceId = tipo do pipe (pipe_whatsapp, pipe_confirmacao, pipe_propostas)
    const matrixResult = await checkMatrixPermission(supabase, tm.id, resourceId, "edit");
    if (matrixResult === "denied") {
      await logDenied(userId, organizationId, action, `matrix_denied_${resourceId}`);
      return { allowed: false, reason: `Sem permissão para mover registros neste funil` };
    }
    return { allowed: true, reason: `matrix_${matrixResult}` };
  }

  // 10. Fallback: se não há regra específica, permitir (compatibilidade)
  return { allowed: true, reason: "fallback_allowed" };
}

// ─── Helpers internos ────────────────────────────────────

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
