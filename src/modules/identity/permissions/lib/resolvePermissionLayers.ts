/**
 * Cascata de permissão efetiva, no cliente (#1630, PRD #1629).
 *
 * Espelha `has_feature_permission()` no banco. As duas precisam concordar: a
 * função decide o que o RLS deixa passar, esta decide o que a tela mostra, e
 * tela discordando do banco é um chamado garantido.
 *
 *   catálogo global (feature_permissions.default_value)
 *     ← default da ORG        (organization_feature_defaults)
 *       ← override do MEMBRO  (member_feature_permissions)
 *         ← edição local em curso
 *
 * O degrau da org é o que faz contratado novo herdar a política da organização
 * em vez do default do produto. Sem ele, o admin desligava membro a membro e a
 * próxima contratação desfazia tudo em silêncio.
 *
 * Não trata admin nem master: a tela de permissões só edita membro. Quem é
 * admin recebe `true` no banco antes de qualquer camada.
 */

export interface CatalogEntry {
  key: string;
  default_value: boolean;
}

export interface PermissionLayers {
  catalog: CatalogEntry[];
  /** organization_feature_defaults da org corrente. */
  orgDefaults: Record<string, boolean>;
  /** member_feature_permissions do membro selecionado. */
  memberOverrides: Record<string, boolean>;
  /** O que o usuário clicou e ainda não salvou. */
  localOverrides: Record<string, boolean>;
}

export interface ResolveOptions {
  /**
   * `"member"` (padrão) resolve a permissão efetiva de um membro.
   * `"org"` resolve a política da organização — a linha de um membro
   * específico não participa, senão o admin editaria a política vendo o valor
   * de outra pessoa no toggle.
   */
  scope?: "member" | "org";
}

/**
 * Aplica a cascata sobre as chaves do catálogo.
 *
 * Percorre o catálogo, e não a união das camadas, de propósito: chave que só
 * existe numa camada (resquício de feature removida) não deve aparecer na tela.
 *
 * As camadas são testadas com `in`, nunca por veracidade — `false` é um valor
 * definido, e `camada[key] || global` cairia no global toda vez que alguém
 * desligasse algo.
 */
export function buildPermissionMap(
  layers: PermissionLayers,
  options: ResolveOptions = {},
): Record<string, boolean> {
  const scope = options.scope ?? "member";
  const map: Record<string, boolean> = {};

  for (const entry of layers.catalog) {
    let value = entry.default_value;

    if (entry.key in layers.orgDefaults) {
      value = layers.orgDefaults[entry.key];
    }
    if (scope === "member" && entry.key in layers.memberOverrides) {
      value = layers.memberOverrides[entry.key];
    }
    if (entry.key in layers.localOverrides) {
      value = layers.localOverrides[entry.key];
    }

    map[entry.key] = value;
  }

  return map;
}
