import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrganization } from "@/modules/identity";
import type { Pipeline } from "../model/usePipelines";
import { MAX_STAGES, sharedRpcFilterParams } from "../model/usePaginatedPipeline";
import {
  buscarEtapasDoFunil,
  buscarPaginaDoFunil,
  funilStagesKey,
} from "../model/usePaginatedFunil";
import {
  EXTRAS_INICIAIS_DO_FUNIL,
  comporFiltrosDoFunil,
  createInitialFunilFilterState,
  paginatedFiltersDoEstado,
} from "@/modules/pipelines/lib/funil-filtros-estado";
import { resolveFunil } from "@/modules/pipelines/lib/resolve-funil";
import { filtersKeyDe, pipelinePageKey } from "@/modules/pipelines/lib/pipeline-page-key";
import { fetchStageCounts, stageCountsQueryKey } from "@/modules/pipelines/lib/stage-counts-query";
import type { PipelinePageCursor } from "@/modules/pipelines/lib/pipeline-page-cursor";

/** Mesmo frescor da tela (`usePaginatedFunil`): prefetch não pode durar mais que ela. */
const FRESCOR_COLUNA_MS = 30_000;
const FRESCOR_ETAPAS_MS = 60_000;

export interface AlvoDoPrefetchDeFunil {
  /** Slug ou uuid do funil — o `:slug` de `/funil/:slug`. */
  slug: string;
  /**
   * Dono forçado pela visão "Meus" (`useVisaoMeuTodos("funis").donoForcado`).
   * Entra no recorte: sem ele, a chave aquecida não seria a que a tela lê.
   */
  donoForcado: string | null;
}

/**
 * Recorte com que `/funil/:slug` abre: painel no estado inicial, busca vazia,
 * extras no padrão — composto pelas mesmas funções puras que `Funil.tsx` usa.
 */
export function recorteInicialDoFunil(organizationId: string, donoForcado: string | null) {
  const painel = paginatedFiltersDoEstado(createInitialFunilFilterState(), "", donoForcado ?? "all");
  // Estado inicial: sem período (sem âncora dos fechados) e sem faixa de reunião.
  const filtros = comporFiltrosDoFunil(painel, EXTRAS_INICIAIS_DO_FUNIL, {
    closedStatusKeys: [],
    temPeriodo: false,
    timeParams: {},
  });
  return sharedRpcFilterParams(organizationId, "", filtros);
}

/**
 * Aquece o board de um funil na intenção (hover/foco no trilho): etapas,
 * contagens e a 1ª página de cada coluna — nas MESMAS chaves que a tela lê
 * (`pipelinePageKey`, `stageCountsQueryKey`, `funilStagesKey`), com os
 * mesmos queryFns. Um aquecimento em voo por vez; o funil precisa já estar
 * na lista em cache (o trilho a carrega para montar o item).
 */
export function usePrefetchPipes() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const emVoo = useRef(false);

  return useCallback(
    async ({ slug, donoForcado }: AlvoDoPrefetchDeFunil): Promise<void> => {
      if (!organizationId || emVoo.current) return;
      const pipelines = queryClient.getQueryData<Pipeline[]>(["pipelines", organizationId]) ?? [];
      const pipeline = resolveFunil(pipelines, slug);
      if (!pipeline) return;

      emVoo.current = true;
      try {
        const stages = await queryClient.fetchQuery({
          queryKey: funilStagesKey(pipeline.id),
          queryFn: () => buscarEtapasDoFunil(pipeline.id),
          staleTime: FRESCOR_ETAPAS_MS,
        });

        const filterParams = recorteInicialDoFunil(organizationId, donoForcado);
        const filtersKey = filtersKeyDe(filterParams);
        const countsArgs = { ...filterParams, p_pipeline_id: pipeline.id };

        await Promise.all([
          queryClient.prefetchQuery({
            queryKey: stageCountsQueryKey(pipeline.id, countsArgs),
            queryFn: () => fetchStageCounts(countsArgs),
            staleTime: FRESCOR_COLUNA_MS,
          }),
          ...stages.slice(0, MAX_STAGES).map((stage) =>
            queryClient.prefetchInfiniteQuery({
              queryKey: pipelinePageKey(pipeline.id, stage.stage_key, organizationId, filtersKey),
              queryFn: ({ pageParam }) =>
                buscarPaginaDoFunil(pipeline.id, stage.stage_key, filterParams, pageParam),
              initialPageParam: null as PipelinePageCursor | null,
              staleTime: FRESCOR_COLUNA_MS,
            }),
          ),
        ]);
      } catch {
        // Aquecimento é oportunista: falha aqui só vira a carga normal da tela.
      } finally {
        emVoo.current = false;
      }
    },
    [queryClient, organizationId],
  );
}
