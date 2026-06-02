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

// Mapeamento de ação legada para recurso+ação na matriz team_member_permissions.
// A partir de 2026-05-20 (Permissions tab Pitstop), várias ações migraram para
// ACTION_TO_ORG_PERMISSION. As entradas null aqui significam: não usar matriz
// — usar a cascata superior (org_permission / feature / etc.).
const ACTION_TO_MATRIX: Record<PermissionAction, { resource: string; action: string } | null> = {
  move_pipe_record: null, // Migrado para ACTION_TO_ORG_PERMISSION (can_move_pipe_records)
  import_leads:     { resource: "leads", action: "create" },
  create_lead:      null, // Migrado para ACTION_TO_ORG_PERMISSION (can_create_leads)
  delete_lead:      null, // Usa branch dedicada delete_lead → can_delete_leads
  trigger_campaign: null, // Migrado para ACTION_TO_ORG_PERMISSION (can_manage_campaigns)
  edit_workflow:    null, // Usa feature_permissions (workflows.edit)
  export_leads:     null, // Migrado para ACTION_TO_ORG_PERMISSION (can_export_leads)
  view_lead:        null, // Migrado para ACTION_TO_ORG_PERMISSION (see_all_leads)
  send_message:     null, // Usa feature_permissions
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

// Mapeamento de ação → legacy org permission_key. Após consolidação PRD #408
// (migration 20261032000002), checkOrgPermission() resolve via feature_permissions
// usando LEGACY_ORG_KEY_TO_FEATURE_KEY. Apenas 5 keys foram mapeadas para feature_key
// (mesmo subset que user_has_org_permission). Keys ainda listadas aqui mas não mapeadas
// (can_create_leads / can_export_leads / can_move_pipe_records / can_manage_campaigns)
// resultam em fail-closed para non-admin members.
const ACTION_TO_ORG_PERMISSION: Partial<Record<PermissionAction, string>> = {
  create_lead:      "can_create_leads",
  export_leads:     "can_export_leads",
  view_lead:        "see_all_leads",
  move_pipe_record: "can_move_pipe_records",
  trigger_campaign: "can_manage_campaigns",
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

  // 5. delete_lead — branch dedicada (mantida pra preservar mensagem PT-BR)
  if (action === "delete_lead") {
    const allowed = await checkOrgPermission(supabase, tm.id, organizationId, tm.role, "can_delete_leads");
    if (!allowed) {
      await logDenied(userId, organizationId, action, "can_delete_leads_denied");
      return { allowed: false, reason: "Você não tem permissão para excluir leads" };
    }
    return { allowed: true, reason: "can_delete_leads" };
  }

  // 6. Permissões legacy resolvidas via feature_permissions (consolidação PRD #408).
  // Keys não-mapeadas em LEGACY_ORG_KEY_TO_FEATURE_KEY fail-close.
  const orgPermissionKey = ACTION_TO_ORG_PERMISSION[action];
  if (orgPermissionKey) {
    const allowed = await checkOrgPermission(
      supabase, tm.id, organizationId, tm.role, orgPermissionKey,
    );
    if (!allowed) {
      await logDenied(userId, organizationId, action, `org_permission_denied:${orgPermissionKey}`);
      return { allowed: false, reason: `Sem permissão: ${orgPermissionKey}` };
    }
    return { allowed: true, reason: orgPermissionKey };
  }

  // 7. Verificar na matriz legada team_member_permissions (fallback).
  // Fail-closed (#647): apenas um grant EXPLÍCITO value="allowed" libera.
  // Ausência de registro ("not_set") ou value="denied" bloqueiam — antes
  // a ausência defaultava para "allowed" (fail-OPEN).
  const matrixMapping = ACTION_TO_MATRIX[action];
  if (matrixMapping) {
    const matrixResult = await checkMatrixPermission(
      supabase, tm.id, matrixMapping.resource, matrixMapping.action,
    );

    if (matrixResult !== "allowed") {
      const reasonTag = matrixResult === "denied" ? "matrix_denied" : "matrix_not_set";
      await logDenied(userId, organizationId, action, reasonTag);
      return { allowed: false, reason: `Sem permissão: ${matrixMapping.resource}.${matrixMapping.action}` };
    }

    return { allowed: true, reason: "matrix_allowed" };
  }

  // 8. Fallback terminal: deny by default — toda ação precisa de mapeamento
  // explícito. Logado para auditoria (#647).
  await logDenied(userId, organizationId, action, "permission_not_defined");
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

// Mapeamento legacy permission_key → feature_key (consolidação PRD #408).
// Idêntico ao usado em user_has_org_permission() (migration 20261032000001).
// Tabelas legadas (team_member_org_permissions, organization_role_permissions)
// foram dropadas em 20261032000002. Source of truth agora é o par
// (member_feature_permissions, feature_permissions.default_value).
const LEGACY_ORG_KEY_TO_FEATURE_KEY: Record<string, string> = {
  see_unassigned_cards:   "leads.view_unassigned",
  see_subordinates_cards: "leads.view_subordinates",
  see_general_info:       "leads.view_general_info",
  see_all_leads:          "leads.view_all",
  can_delete_leads:       "leads.delete",
};

async function checkOrgPermission(
  supabase: SupabaseClient,
  teamMemberId: string,
  _organizationId: string,
  _role: string,
  permissionKey: string,
): Promise<boolean> {
  // 1. Mapear legacy key → feature_key. Unmapped → fail-closed.
  const featureKey = LEGACY_ORG_KEY_TO_FEATURE_KEY[permissionKey];
  if (!featureKey) return false;

  // 2. Override individual via member_feature_permissions
  const { data: override } = await supabase
    .from("member_feature_permissions")
    .select("enabled")
    .eq("team_member_id", teamMemberId)
    .eq("feature_key", featureKey)
    .maybeSingle();

  if (override) return override.enabled;

  // 3. Default da feature
  const { data: feature } = await supabase
    .from("feature_permissions")
    .select("default_value")
    .eq("key", featureKey)
    .maybeSingle();

  if (feature) return feature.default_value;

  // 4. Fail-closed se feature não encontrada
  return false;
}

async function checkMatrixPermission(
  supabase: SupabaseClient,
  teamMemberId: string,
  resource: string,
  action: string,
): Promise<"allowed" | "denied" | "not_set"> {
  const { data } = await supabase
    .from("team_member_permissions")
    .select("value")
    .eq("team_member_id", teamMemberId)
    .eq("resource_key", resource)
    .eq("action_key", action)
    .maybeSingle();

  // Fail-closed (#647): ausência de registro NÃO libera. Apenas um grant
  // explícito value="allowed" concede; "denied" e ausência ("not_set")
  // bloqueiam. O caller (canUserPerformAction) loga o motivo para auditoria.
  if (data?.value === "allowed") return "allowed";
  if (data?.value === "denied") return "denied";
  return "not_set";
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
