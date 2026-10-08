/**
 * Deriva, para cada feature key oferecida por algum plano ativo, o plano
 * mais barato (menor position) que a desbloqueia. Fonte de verdade para a
 * mensagem de upgrade ("disponível no Torque Automation").
 */

export interface ActivePlan {
  name: string;
  display_name: string;
  position: number;
  features: Record<string, boolean>;
}

export interface UnlockPlan {
  name: string;
  display_name: string;
}

export type FeatureUnlockMap = Record<string, UnlockPlan>;

export function computeFeatureUnlockPlan(plans: ActivePlan[]): FeatureUnlockMap {
  const sorted = [...plans].sort((a, b) => a.position - b.position);
  const map: FeatureUnlockMap = {};
  for (const plan of sorted) {
    for (const [key, enabled] of Object.entries(plan.features ?? {})) {
      if (enabled === true && !(key in map)) {
        map[key] = { name: plan.name, display_name: plan.display_name };
      }
    }
  }
  return map;
}
