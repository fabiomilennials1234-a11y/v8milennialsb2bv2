/**
 * Fábrica ÚNICA da chave de uma coluna do board paginado (`/funil/:slug`).
 *
 * `["pipeline-page", pipelineId, stageKey, orgId, filtersKey]` — o mesmo
 * endereço para quem lê (`usePaginatedFunil`) e para quem aquece
 * (`usePrefetchPipes`). Antes desta fábrica o prefetch do trilho gravava em
 * `["pipeline_entries", slug, org]`, chave que tela nenhuma lia: o hover
 * baixava dado para o lixo (armadilha da chave legada).
 *
 * Quem invalida por PREFIXO (`["pipeline-page"]`, `["pipeline-page", id]`)
 * segue alcançando — a forma da chave não mudou, só ganhou dono.
 */
export const PIPELINE_PAGE = "pipeline-page";
export const COLUNA_VAZIA = "__empty__";

export function pipelinePageKey(
  pipelineId: string | null | undefined,
  stageKey: string | null | undefined,
  organizationId: string | null | undefined,
  filtersKey: string,
) {
  return [PIPELINE_PAGE, pipelineId, stageKey ?? COLUNA_VAZIA, organizationId, filtersKey] as const;
}

/** Serialização do recorte que entra na chave — a mesma dos dois lados. */
export function filtersKeyDe(filterParams: object): string {
  return JSON.stringify(filterParams);
}
