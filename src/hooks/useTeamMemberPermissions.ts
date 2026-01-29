import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

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
  { value: "if_responsible", label: "Se responsável", description: "Vê onde sou SDR ou Closer responsável" },
  { value: "team_access", label: "Equipe", description: "Vê registros atribuídos a outros membros da equipe" },
  { value: "allowed", label: "Todos", description: "Vê todos os registros do recurso na organização" },
  { value: "unassigned", label: "Sem responsável", description: "Vê cards/leads que não têm SDR ou Closer atribuído" },
];

/** Opções para "Exportar" */
export const EXPORT_OPTIONS: { value: PermissionValue; label: string; description: string }[] = [
  { value: "denied", label: "Negado", description: "Não pode exportar" },
  { value: "if_responsible", label: "Se responsável", description: "Só exporta o que for responsável" },
  { value: "team_access", label: "Acesso à equipe", description: "Pode exportar dados da equipe" },
  { value: "allowed", label: "Permitido", description: "Pode exportar todos os dados do recurso" },
];

/** Permissões de um ou mais team_members (por team_member_id) */
export function useTeamMemberPermissions(teamMemberIds: string[]) {
  return useQuery({
    queryKey: ["team-member-permissions", teamMemberIds.sort().join(",")],
    queryFn: async () => {
      if (teamMemberIds.length === 0) return [];
      const { data, error } = await supabase
        .from("team_member_permissions")
        .select("*")
        .in("team_member_id", teamMemberIds);
      if (error) throw error;
      return data as TeamMemberPermission[];
    },
    enabled: teamMemberIds.length > 0,
  });
}

/** Escopos selecionados para "Ver" (pode haver várias linhas por recurso) */
export function getViewScopes(
  permissionsList: TeamMemberPermission[],
  teamMemberId: string,
  resource: ResourceKey
): PermissionValue[] {
  return permissionsList
    .filter(
      (p) =>
        p.team_member_id === teamMemberId &&
        p.resource_key === resource &&
        p.action_key === "view" &&
        p.value !== "denied"
    )
    .map((p) => p.value as PermissionValue);
}

/** Escopos selecionados para "Exportar" */
export function getExportScopes(
  permissionsList: TeamMemberPermission[],
  teamMemberId: string,
  resource: ResourceKey
): PermissionValue[] {
  return permissionsList
    .filter(
      (p) =>
        p.team_member_id === teamMemberId &&
        p.resource_key === resource &&
        p.action_key === "export" &&
        p.value !== "denied"
    )
    .map((p) => p.value as PermissionValue);
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

/** Salvar matriz de permissões. Para view/export, values pode ter vários itens (múltiplos escopos). */
export function useSaveTeamMemberPermissions() {
  const queryClient = useQueryClient();

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
      const toDelete = new Set<string>();
      teamMemberIds.forEach((tmId) => {
        permissions.forEach((p) => {
          toDelete.add(`${tmId}|${p.resource_key}|${p.action_key}`);
        });
      });

      for (const key of toDelete) {
        const [tmId, resource_key, action_key] = key.split("|");
        await supabase
          .from("team_member_permissions")
          .delete()
          .eq("team_member_id", tmId)
          .eq("resource_key", resource_key)
          .eq("action_key", action_key);
      }

      const rows: TeamMemberPermissionInsert[] = teamMemberIds.flatMap((tmId) =>
        permissions.flatMap((p) =>
          (p.values.length ? p.values : ["denied"]).map((value) => ({
            team_member_id: tmId,
            resource_key: p.resource_key,
            action_key: p.action_key,
            value,
            updated_at: new Date().toISOString(),
          }))
        )
      );
      if (rows.length === 0) return;
      const { error } = await supabase
        .from("team_member_permissions")
        .insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-member-permissions"] });
    },
  });
}
