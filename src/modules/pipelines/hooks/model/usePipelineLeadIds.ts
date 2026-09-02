import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * Filter params accepted by {@link usePipelineLeadIds} — o resolvedor de
 * público POR PIPELINE_ID (SCRUM-633), sobre o motor único
 * `get_pipeline_lead_ids` da migration 20270908003000 (SCRUM-626).
 *
 * Substitui o PAR {@link useFilteredLeadIds} (slug dos 3 pipes de sistema) /
 * {@link useCustomFilteredLeadIds} (uuid de funil custom): um funil, um id —
 * o chamador não precisa mais saber a família do funil para resolver público.
 *
 *   - `stageId`               — pipeline_stages.id (uuid, canônico); `null`/
 *                               omitido = funil inteiro
 *   - `stageKey`              — alias legado por slug de etapa; use `stageId`
 *                               em código novo (os dois compõem por AND no motor)
 *   - `search`                — ILIKE em nome / telefone / empresa do lead
 *   - `responsibleId`         — pre/sale responsible (metadata da entry + colunas
 *                               do lead); `"all"`/`null` limpa (paridade board)
 *   - `tagIds`                — lead precisa ter TODAS as tags (interseção)
 *   - `qualificationTier`     — `leads.qualification_tier` ∈ lista; vazia = todos
 *   - `preQualificationTier`  — `leads.pre_qualification_tier` ∈ lista; vazia = todos
 *   - `origin`                — `leads.origin` ∈ lista; vazia = todos
 */
export interface PipelineLeadIdsParams {
  stageId?: string | null;
  stageKey?: string | null;
  search?: string;
  responsibleId?: string | null;
  tagIds?: string[];
  qualificationTier?: string[];
  preQualificationTier?: string[];
  origin?: string[];
}

/**
 * Resolve TODOS os lead_ids de UM funil (qualquer tipo — sistema ou custom)
 * que casam com o filtro ativo, via `get_pipeline_lead_ids` por `p_pipeline_id`.
 *
 * É a fonte "Filtro ativo"/público de Disparo da página unificada
 * `/funil/:slug` (SCRUM-632): resolve o conjunto COMPLETO do funil (não só a
 * página carregada do kanban), então a contagem do wizard bate com o board.
 *
 * Tenancy é server-side: o motor deriva as orgs do chamador via
 * `get_my_organization_ids()` (+ ramo master gateado por `is_master_user()`
 * quando `p_organization_id` vem preenchido) e a RLS do chamador continua
 * valendo — a RPC não é SECURITY DEFINER.
 *
 * Hazard PGRST202 (assinatura): verificado contra PROD em 2026-09-02 — a
 * chamada com named params contendo `p_pipeline_id` resolve no schema cache
 * (42501 de permissão com anon, nunca PGRST202). Ver relatório SCRUM-633.
 */
export function usePipelineLeadIds(
  pipelineId: string | null | undefined,
  params: PipelineLeadIdsParams = {},
) {
  const { organizationId } = useOrganization();
  const {
    stageId,
    stageKey,
    search,
    responsibleId,
    tagIds,
    qualificationTier,
    preQualificationTier,
    origin,
  } = params;

  // Normalização idêntica à de useFilteredLeadIds/useCustomFilteredLeadIds:
  // "all"/vazio → null, para o filtro inativo curto-circuitar server-side e a
  // cache key coincidir entre resolvers com condições idênticas.
  const pStageId = stageId || null;
  const pStageKey = stageKey || null;
  const pResponsibleId = responsibleId === "all" ? null : responsibleId || null;
  const pSearch = search || null;
  const pTagIds = tagIds?.length ? tagIds : null;
  const pQualificationTier = qualificationTier?.length ? qualificationTier : null;
  const pPreQualificationTier = preQualificationTier?.length
    ? preQualificationTier
    : null;
  const pOrigin = origin?.length ? origin : null;

  return useQuery({
    queryKey: [
      "pipeline_lead_ids",
      pipelineId,
      pStageId,
      pStageKey,
      pSearch,
      pResponsibleId,
      pTagIds,
      pQualificationTier,
      pPreQualificationTier,
      pOrigin,
      organizationId,
    ],
    queryFn: async (): Promise<string[]> => {
      // Ponte de tipo até o regen de types.ts: get_pipeline_lead_ids
      // (20270908003000) é mais nova que o último gerado. Nome e args entram
      // como `never` (sem `any`) e o shape do retorno é assertado abaixo —
      // mesmo racional do rpcArgs de usePaginatedPipeline.
      const { data, error } = await supabase.rpc("get_pipeline_lead_ids" as unknown as never, {
        p_pipeline_id: pipelineId,
        p_stage_id: pStageId,
        p_stage_key: pStageKey,
        p_search: pSearch,
        p_responsible_id: pResponsibleId,
        p_tag_ids: pTagIds,
        p_qualification_tier: pQualificationTier,
        p_pre_qualification_tier: pPreQualificationTier,
        p_origin: pOrigin,
        // Master-ghost: destrava o ramo master server-side p/ org sem
        // membership (gateado por is_master_user). Ver migration 20261228000000.
        p_organization_id: organizationId,
      } as unknown as never);
      if (error) throw error;
      return (data ?? []) as string[];
    },
    enabled: !!organizationId && !!pipelineId,
  });
}
