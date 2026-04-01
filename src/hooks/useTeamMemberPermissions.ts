import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { useOrganization } from "./useOrganization";

export type TeamMemberPermission = Tables<"team_member_permissions">;
export type TeamMemberPermissionInsert = TablesInsert<"team_member_permissions">;

export const RESOURCE_KEYS = [
  "leads",
  "contatos",
  "empresas",
  "tarefas",
  "produtos",
  "pipe_whatsapp",
  "pipe_confirmacao",
  "pipe_propostas",
  "campanhas",
  "checklists",
] as const;

export const ACTION_KEYS = ["create", "view", "edit", "delete", "export"] as const;

export const PERMISSION_VALUES = ["denied", "allowed", "if_responsible", "team_access", "unassigned"] as const;

export type ResourceKey = (typeof RESOURCE_KEYS)[number];
export type ActionKey = (typeof ACTION_KEYS)[number];
export type PermissionValue = (typeof PERMISSION_VALUES)[number];

export const RESOURCE_LABELS: Record<ResourceKey, string> = {
  leads: "Leads",
  contatos: "Contatos",
  empresas: "Empresas",
  tarefas: "Tarefas",
  produtos: "Produtos",
  pipe_whatsapp: "Funil WhatsApp",
  pipe_confirmacao: "Funil Confirmação",
  pipe_propostas: "Funil Propostas",
  campanhas: "Campanhas",
  checklists: "Checklists",
};

export const ACTION_LABELS: Record<ActionKey, string> = {
  create: "Criar",
  view: "Ver",
  edit: "Editar",
  delete: "Excluir",
  export: "Exportar",
};

/** Descrição do que cada ação significa (exibida na UI) */
export const ACTION_DESCRIPTIONS: Record<ActionKey, string> = {
  create: "Pode criar novos registros neste recurso",
  view: "Quem pode ver: se responsável, equipe, todos ou sem responsável",
  edit: "Pode alterar registros que tiver permissão de ver",
  delete: "Pode excluir registros (recomendado apenas admin)",
  export: "Pode exportar dados: negado, se responsável, equipe ou permitido",
};

/** Opções para "Ver" — escopo de visibilidade (pode marcar mais de uma) */
export const VIEW_OPTIONS: { value: PermissionValue; label: string; description: string }[] = [
  { value: "denied", label: "Nenhum", description: "Não vê nenhum registro deste recurso" },
  { value: "if_responsible", label: "Se responsável", description: "Vê onde sou responsável atribuído" },
  { value: "team_access", label: "Equipe", description: "Vê registros atribuídos a outros membros da equipe" },
  { value: "allowed", label: "Todos", description: "Vê todos os registros do recurso na organização" },
  { value: "unassigned", label: "Sem responsável", description: "Vê cards/leads que não têm responsável atribuído" },
];

/** Opções para "Exportar" */
export const EXPORT_OPTIONS: { value: PermissionValue; label: string; description: string }[] = [
  { value: "denied", label: "Negado", description: "Não pode exportar" },
  { value: "if_responsible", label: "Se responsável", description: "Só exporta o que for responsável" },
  { value: "team_access", label: "Acesso à equipe", description: "Pode exportar dados da equipe" },
  { value: "allowed", label: "Permitido", description: "Pode exportar todos os dados do recurso" },
];

/**
 * Permissões de um ou mais team_members (por team_member_id).
 * SECURITY: Só retorna permissões de membros da organização atual.
 */
export function useTeamMemberPermissions(teamMemberIds: string[]) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["team-member-permissions", teamMemberIds.sort().join(","), organizationId],
    queryFn: async () => {
      if (teamMemberIds.length === 0 || !organizationId) return [];
      const { data: membersInOrg } = await supabase
        .from("team_members")
        .select("id")
        .eq("organization_id", organizationId)
        .in("id", teamMemberIds);
      const allowedIds = (membersInOrg ?? []).map((m) => m.id);
      if (allowedIds.length === 0) return [];
      const { data, error } = await supabase
        .from("team_member_permissions")
        .select("*")
        .in("team_member_id", allowedIds);
      if (error) throw error;
      return (data ?? []) as TeamMemberPermission[];
    },
    enabled: isReady && !!organizationId && teamMemberIds.length > 0,
  });
}

/** Escopos selecionados para "Ver". Uma linha por (tm, resource, action); value_scopes = array de escopos. */
export function getViewScopes(
  permissionsList: TeamMemberPermission[],
  teamMemberId: string,
  resource: ResourceKey
): PermissionValue[] {
  const row = permissionsList.find(
    (p) =>
      p.team_member_id === teamMemberId &&
      p.resource_key === resource &&
      p.action_key === "view"
  );
  if (!row) return [];
  const raw = (row as TeamMemberPermission & { value_scopes?: unknown }).value_scopes;
  const scopes = Array.isArray(raw) ? raw : null;
  if (scopes && scopes.length > 0) {
    return scopes.filter((s) => s && s !== "denied") as PermissionValue[];
  }
  return row.value && row.value !== "denied" ? [row.value as PermissionValue] : [];
}

/** Escopos selecionados para "Exportar". */
export function getExportScopes(
  permissionsList: TeamMemberPermission[],
  teamMemberId: string,
  resource: ResourceKey
): PermissionValue[] {
  const row = permissionsList.find(
    (p) =>
      p.team_member_id === teamMemberId &&
      p.resource_key === resource &&
      p.action_key === "export"
  );
  if (!row) return [];
  const raw = (row as TeamMemberPermission & { value_scopes?: unknown }).value_scopes;
  const scopes = Array.isArray(raw) ? raw : null;
  if (scopes && scopes.length > 0) {
    return scopes.filter((s) => s && s !== "denied") as PermissionValue[];
  }
  return row.value && row.value !== "denied" ? [row.value as PermissionValue] : [];
}

/** Valor único para Criar/Editar/Excluir (uma linha por recurso+ação) */
export function getValue(
  permissionsList: TeamMemberPermission[],
  teamMemberId: string,
  resource: ResourceKey,
  action: ActionKey
): PermissionValue {
  const row = permissionsList.find(
    (p) =>
      p.team_member_id === teamMemberId &&
      p.resource_key === resource &&
      p.action_key === action
  );
  return (row?.value as PermissionValue) || "denied";
}

/**
 * Salvar matriz de permissões via RPC (SECURITY DEFINER).
 * Para view/export, values pode ter vários itens (múltiplos escopos).
 * Evita 401 por RLS e 409 por concorrência ao fazer DELETE+INSERT no servidor.
 */
export function useSaveTeamMemberPermissions() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({
      teamMemberIds,
      permissions,
    }: {
      teamMemberIds: string[];
      permissions: {
        resource_key: ResourceKey;
        action_key: ActionKey;
        values: PermissionValue[];
      }[];
    }) => {
      await supabase.auth.refreshSession().catch(() => {});
      if (!organizationId) throw new Error("Organização não disponível");

      const validIds = teamMemberIds.filter(Boolean);
      if (validIds.length === 0) return;

      const payload = permissions.map((p) => ({
        resource_key: p.resource_key,
        action_key: p.action_key,
        values: p.values.length ? p.values : ["denied"],
      }));

      const { error } = await supabase.rpc("save_team_member_permissions", {
        p_team_member_ids: validIds,
        p_permissions: payload,
      });

      if (error) {
        const msg = error.message ?? "";
        if (
          error.code === "PGRST301" ||
          error.code === "401" ||
          msg.toLowerCase().includes("jwt") ||
          msg.toLowerCase().includes("refresh") ||
          msg.toLowerCase().includes("unauthorized")
        ) {
          throw new Error("Sessão expirada. Faça login novamente.");
        }
        if (error.code === "23505" || msg.toLowerCase().includes("conflito") || msg.toLowerCase().includes("duplicate")) {
          throw new Error("Conflito ao salvar. Tente novamente ou faça login de novo.");
        }
        if (msg.toLowerCase().includes("acesso negado") || msg.toLowerCase().includes("apenas admin")) {
          throw new Error("Acesso negado. Apenas admin pode alterar permissões.");
        }
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-member-permissions"] });
    },
  });
}
