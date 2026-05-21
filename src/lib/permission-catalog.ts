/**
 * Permission catalog — single source of truth for the Pitstop > Permissões tab.
 *
 * 12 toggles in 7 groups. Mirrored on the server side via
 * supabase/functions/_shared/permission_engine.ts (ACTION_TO_ORG_PERMISSION
 * + ACTION_TO_FEATURE).
 *
 * Storage split (CTO decision 2026-05-20 — see ADR-2026-05-20-permission-tab-storage-split):
 *   - storage='organization_role_permissions' → 9 toggles in the dedicated table.
 *   - storage='feature_permissions'           → 3 management features mapped to
 *     existing feature_permissions.default_value rows.
 *
 * The PermissionsTab mutation hook (useUpdateRolePermission) abstracts the
 * destination so the UI is unaware of the split.
 */

export type PermissionStorage =
  | "organization_role_permissions"
  | "feature_permissions";

export interface PermissionDef {
  /** Key used in storage. For org_role_permissions, == permission_key. For feature_permissions, see featureKey. */
  key: string;
  label: string;
  description: string;
  tooltip: string;
  /** Show destructive AlertDialog confirmation on OFF transition. */
  destructive: boolean;
  /** True when the permission is also enforced by RLS server-side (Fase 1). */
  hasRls: boolean;
  storage: PermissionStorage;
  /** Required when storage='feature_permissions' — points to feature_permissions.key. */
  featureKey?: string;
}

export interface PermissionGroup {
  id: string;
  label: string;
  permissions: PermissionDef[];
}

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    id: "leads",
    label: "Leads",
    permissions: [
      {
        key: "can_create_leads",
        label: "Criar leads",
        description: "Adicionar leads manualmente pelo CRM",
        tooltip:
          "Permite criar leads via formulário e importação manual. Não afeta leads vindos por webhook.",
        destructive: false,
        hasRls: false,
        storage: "organization_role_permissions",
      },
      {
        key: "can_delete_leads",
        label: "Excluir leads",
        description: "Remove leads permanentemente. Aplicado no banco.",
        tooltip:
          "Permite excluir leads do sistema. Esta permissão também é aplicada via RLS no banco de dados (Fase 1) — desligar impede a ação até no console.",
        destructive: true,
        hasRls: true,
        storage: "organization_role_permissions",
      },
      {
        key: "can_export_leads",
        label: "Exportar leads",
        description: "Baixar lista em CSV",
        tooltip:
          "Habilita o botão de exportação na lista de leads. Não inclui mensagens nem histórico.",
        destructive: false,
        hasRls: false,
        storage: "organization_role_permissions",
      },
      {
        key: "see_all_leads",
        label: "Ver todos os leads",
        description: "Inclui leads de outros vendedores",
        tooltip:
          "Sem isto, o membro só enxerga leads onde é responsável, SDR, closer — ou de subordinados (se habilitado abaixo).",
        destructive: false,
        hasRls: false,
        storage: "organization_role_permissions",
      },
    ],
  },
  {
    id: "pipes_visibility",
    label: "Visibilidade em pipes",
    permissions: [
      {
        key: "see_unassigned_cards",
        label: "Cards não atribuídos",
        description: "Enxergar leads sem responsável nos pipes",
        tooltip:
          "Quando ligado, membros veem leads sem dono nos kanbans. Útil para distribuição manual.",
        destructive: false,
        hasRls: false,
        storage: "organization_role_permissions",
      },
      {
        key: "see_subordinates_cards",
        label: "Cards de subordinados",
        description: "Enxergar leads do time abaixo",
        tooltip:
          "Gestores veem leads dos membros que reportam a eles. Define-se hierarquia em Time.",
        destructive: false,
        hasRls: false,
        storage: "organization_role_permissions",
      },
      {
        key: "see_general_info",
        label: "Informações gerais",
        description: "Métricas e dashboards da organização",
        tooltip:
          "Acesso a totais agregados (vendas, pipeline, ranking). Sem isto, só vê o próprio desempenho.",
        destructive: false,
        hasRls: false,
        storage: "organization_role_permissions",
      },
    ],
  },
  {
    id: "pipes_action",
    label: "Ação em pipes",
    permissions: [
      {
        key: "can_move_pipe_records",
        label: "Mover cards no pipe",
        description: "Arrastar entre estágios",
        tooltip:
          "Habilita drag-and-drop entre stages. Sem isto, membros só visualizam, não movem.",
        destructive: false,
        hasRls: false,
        storage: "organization_role_permissions",
      },
    ],
  },
  {
    id: "campaigns",
    label: "Campanhas",
    permissions: [
      {
        key: "can_manage_campaigns",
        label: "Gerenciar campanhas",
        description: "Criar, editar e ativar campanhas",
        tooltip:
          "Acesso completo ao módulo Campanhas. Sem isto, vê resultados mas não edita configurações.",
        destructive: false,
        hasRls: false,
        storage: "organization_role_permissions",
      },
    ],
  },
  {
    id: "workflows",
    label: "Workflows",
    permissions: [
      {
        key: "can_manage_workflows",
        label: "Gerenciar workflows",
        description: "Criar e editar automações",
        tooltip:
          "Acesso ao construtor de workflows. Sem isto, workflows rodam normalmente mas membro não pode alterá-los.",
        destructive: false,
        hasRls: false,
        storage: "feature_permissions",
        featureKey: "workflows.create",
      },
    ],
  },
  {
    id: "team",
    label: "Time",
    permissions: [
      {
        key: "can_manage_team",
        label: "Gerenciar time",
        description: "Convidar, remover e ajustar membros",
        tooltip:
          "Acesso à página Time. Permite convidar, remover, atribuir roles e definir comissões.",
        destructive: true,
        hasRls: false,
        storage: "feature_permissions",
        featureKey: "team.view",
      },
    ],
  },
  {
    id: "copilot",
    label: "Copilot",
    permissions: [
      {
        key: "can_manage_copilot",
        label: "Gerenciar Copilot",
        description: "Configurar agentes de IA",
        tooltip:
          "Acesso a criar, editar e ativar agentes Copilot. Sem isto, vê conversas mas não muda configuração.",
        destructive: false,
        hasRls: false,
        storage: "feature_permissions",
        featureKey: "copilot.create",
      },
    ],
  },
] as const;

/** Flat list of all 12 permissions, in display order. */
export const ALL_PERMISSIONS: readonly PermissionDef[] = PERMISSION_GROUPS.flatMap(
  (g) => g.permissions,
);

export function findPermissionByKey(key: string): PermissionDef | undefined {
  return ALL_PERMISSIONS.find((p) => p.key === key);
}
