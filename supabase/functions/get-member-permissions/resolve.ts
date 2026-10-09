/**
 * Resolve as permissões do membro na MESMA ordem de `has_feature_permission`
 * (SQL), que é quem a RLS e as RPCs consultam:
 *
 *   master/admin → true
 *   admin-only   → false
 *   1) override do membro       (member_feature_permissions)
 *   2) padrão da organização    (organization_feature_defaults)
 *   3) padrão do catálogo       (feature_permissions.default_value)
 *
 * O passo 2 faltava aqui: a tela ignorava o padrão da org que o banco
 * respeitava, e as duas discordavam (ex.: `leads.edit_document` ligado para a
 * org inteira continuava travado na ficha).
 */
export interface FeatureRow {
  key: string;
  is_admin_only: boolean;
  default_value: boolean;
}

export function resolvePermissions(input: {
  features: FeatureRow[];
  isAdmin: boolean;
  isMaster: boolean;
  memberOverrides: Map<string, boolean>;
  orgDefaults: Map<string, boolean>;
}): Record<string, boolean> {
  const { features, isAdmin, isMaster, memberOverrides, orgDefaults } = input;
  const result: Record<string, boolean> = {};
  for (const feat of features) {
    if (isAdmin || isMaster) {
      result[feat.key] = true;
    } else if (feat.is_admin_only) {
      result[feat.key] = false;
    } else if (memberOverrides.has(feat.key)) {
      result[feat.key] = memberOverrides.get(feat.key)!;
    } else if (orgDefaults.has(feat.key)) {
      result[feat.key] = orgDefaults.get(feat.key)!;
    } else {
      result[feat.key] = feat.default_value;
    }
  }
  return result;
}
