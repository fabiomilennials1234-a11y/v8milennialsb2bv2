import type { Enums } from "@/integrations/supabase/types";

/**
 * "Lead qualificado" nas Métricas LLM — a mesma régua de "Boas avaliações" do
 * Estúdio e da tela de saúde do funil (`20270812030000_metric_boas_avaliacoes.sql`):
 *
 *     tier_efetivo = COALESCE(qualification_tier, pre_qualification_tier)
 *     bons         = tier_efetivo IN ('prata', 'ouro', 'diamante')
 *
 * Vale a qualificação do vendedor; sem ela, a pré-qualificação da IA. Bronze e
 * desqualificado ficam de fora. Substitui `qualification_score >= 70` (CTO,
 * 02/10: o score do lead não é mais critério).
 */
export const QUALIFIED_TIERS = ["prata", "ouro", "diamante"] as const satisfies readonly Enums<"qualification_tier">[];

const LIST = QUALIFIED_TIERS.join(",");

/**
 * Filtro PostgREST para `.or(...)`. PostgREST não filtra por COALESCE; esta
 * disjunção é equivalente: o tier final é bom, OU não há tier final e a
 * pré-qualificação é boa.
 */
export const QUALIFIED_TIER_FILTER =
  `qualification_tier.in.(${LIST}),` + `and(qualification_tier.is.null,pre_qualification_tier.in.(${LIST}))`;

/** Mesma regra em memória — usada pelo teste para provar a equivalência. */
export function isQualifiedLead(lead: {
  qualification_tier: Enums<"qualification_tier"> | null;
  pre_qualification_tier: Enums<"qualification_tier"> | null;
}): boolean {
  const efetivo = lead.qualification_tier ?? lead.pre_qualification_tier;
  return efetivo !== null && (QUALIFIED_TIERS as readonly string[]).includes(efetivo);
}
