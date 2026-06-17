/**
 * Overrides de métrica org-específicos (temporários).
 *
 * Milennials: a métrica de "reuniões marcadas" no Comando (FUNIL DE VENDAS e
 * card "Metas da Equipe") deve usar a coorte correta da aba Saúde
 * (`get_funnel_health` → `stages.reuniao`), e não o `get_dashboard_metrics`
 * (que conta eventos `meeting_booked` sem dedup por lead, inflando o número).
 *
 * Override aplicado só nesta org enquanto a generalização para todas as orgs
 * não é decidida. Ver TabVisaoGeralV2.tsx / TabPerformanceV2.tsx.
 */
export const MILENNIALS_ORG_ID = "6030520a-2ca7-477d-be89-55758e2cd808";
