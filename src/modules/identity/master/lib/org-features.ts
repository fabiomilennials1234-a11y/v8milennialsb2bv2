/**
 * Features de uma org, com a ORIGEM de cada uma (regra OR-2: feature liberada
 * vem do plano ou de um extra da org).
 *
 * Espelha `org_get_features_and_limits` — que não serve para a ficha porque,
 * chamada por um master, devolve TUDO ligado (o bypass de master vem antes do
 * cálculo). Ordem de precedência, igual à do banco:
 *
 *   1. plano (`subscription_plans.features`, casado pelo NOME em texto — OR-4
 *      ainda não aplicado: o banco lê `subscription_plan`, não `plan_id`)
 *   2. extra da org (`organization_features`), se não expirou — sobrescreve o plano
 *   3. `feature_flags.default_enabled`, para o que o plano não menciona
 *
 * Mudou a função SQL, muda aqui.
 */

export interface FeatureCatalogEntry {
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  default_enabled: boolean | null;
}

export interface OrgFeatureOverride {
  feature_key: string;
  enabled: boolean;
  override_reason: string | null;
  overridden_at: string | null;
  expires_at: string | null;
}

export type FeatureSource = "plano" | "extra" | "padrao";

export interface ResolvedFeature {
  key: string;
  name: string;
  category: string;
  enabled: boolean;
  source: FeatureSource;
  /** O extra que está valendo, se houver. */
  override: OrgFeatureOverride | null;
  /** Extra que existe mas expirou — some do cálculo, fica visível na ficha. */
  expiredOverride: OrgFeatureOverride | null;
}

export function resolveOrgFeatures(
  catalog: readonly FeatureCatalogEntry[],
  planFeatures: Record<string, unknown>,
  overrides: readonly OrgFeatureOverride[],
  now: Date = new Date(),
): ResolvedFeature[] {
  const byKey = new Map(overrides.map((o) => [o.feature_key, o]));

  return catalog
    .map((f): ResolvedFeature => {
      const o = byKey.get(f.key) ?? null;
      const valid = o && (!o.expires_at || new Date(o.expires_at) > now) ? o : null;
      const base = {
        key: f.key,
        name: f.name,
        category: f.category ?? "general",
        override: valid,
        expiredOverride: o && !valid ? o : null,
      };
      if (valid) return { ...base, enabled: valid.enabled, source: "extra" };
      if (f.key in planFeatures) return { ...base, enabled: planFeatures[f.key] === true, source: "plano" };
      return { ...base, enabled: !!f.default_enabled, source: "padrao" };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}
