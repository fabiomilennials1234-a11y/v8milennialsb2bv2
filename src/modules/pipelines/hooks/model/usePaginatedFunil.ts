import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCanDo, useOrganization } from "@/modules/identity";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import { flattenMetadata } from "./usePipelineEntries";
import {
  MAX_STAGES,
  PAGE_SIZE,
  SEARCH_DEBOUNCE_MS,
  sharedRpcFilterParams,
  type PaginatedFilters,
  type StageData,
} from "./usePaginatedPipeline";
import { useMoveLeadInCustomPipe } from "../custom/useCustomPipelines";
import type { CustomPipelineStage } from "@/contracts/pipe";

/**
 * Board paginado da PÁGINA UNIFICADA `/funil/:slug` (SCRUM-632, F4).
 *
 * Irmão de `usePaginatedPipeline` com uma diferença de endereço: o funil entra
 * por `p_pipeline_id` — o caminho canônico que a SCRUM-626 abriu — e as
 * contagens vêm de `get_pipeline_stage_counts_by_id`, o motor único que serve
 * qualquer funil (system ou custom). O bloco de filtros é o MESMO objeto
 * (`sharedRpcFilterParams`), então badge e cards nunca divergem de recorte.
 *
 * QueryKeys por pipeline_id (padrão 626): `["pipeline-page", pipelineId, …]` e
 * `["pipeline-stage-counts", pipelineId, …]`. O prefixo `pipeline-page` é o
 * mesmo do board legado de propósito — `invalidateAfterMove` e o realtime já
 * invalidam por esse prefixo, e a página nova pega carona sem mudança lá.
 *
 * Na W6 (demolição), `usePaginatedPipeline` colapsa neste hook.
 */

/** Etapas de QUALQUER funil, direto da fonte única `pipeline_stages` (F1). */
export function useFunilStages(pipelineId: string | undefined) {
  useRealtimeSubscription("pipeline_stages", ["funil-stages"]);

  return useQuery({
    queryKey: ["funil-stages", pipelineId],
    queryFn: async () => {
      if (!pipelineId) return [] as CustomPipelineStage[];

      // Pós-F1 (20270906001000) toda etapa — de sistema ou custom — vive em
      // `pipeline_stages` com FK real pro funil. Uma query serve as duas
      // famílias; o shape devolvido é o contrato `CustomPipelineStage`, que os
      // diálogos reaproveitados (settings/import/disparo) já consomem.
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select(
          "id, organization_id, pipeline_id, stage_key, name, color, position, is_active, is_final_positive, is_final_negative, stage_role, requires_sale_value, target_pipeline_id, target_stage_id, target_pipe_type, target_stage_key, checklist_template_id, created_at, updated_at",
        )
        .eq("pipeline_id", pipelineId)
        .eq("is_active", true)
        .order("position", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as CustomPipelineStage[];
    },
    enabled: !!pipelineId,
    staleTime: 60_000,
  });
}

/**
 * Ponte de tipo até o regen de `types.ts` — `p_pipeline_id` (626) ainda não
 * existe na assinatura gerada de `get_pipeline_page`, e
 * `get_pipeline_stage_counts_by_id` nem consta. Mesmo padrão documentado em
 * `usePaginatedPipeline.rpcArgs`; morre no próximo `supabase gen types`.
 */
function rpcArgs<T extends object>(params: T): never {
  return params as unknown as never;
}

type RpcPageRow = Record<string, unknown> & { lead?: unknown };

function flattenRpcEntry(row: RpcPageRow) {
  const lead = typeof row.lead === "string" ? JSON.parse(row.lead) : row.lead;
  return flattenMetadata({ ...row, lead });
}

function useStageSlot(
  pipelineId: string | undefined,
  filterParams: ReturnType<typeof sharedRpcFilterParams>,
  stageKey: string | undefined,
  filtersKey: string,
  organizationId: string | null | undefined,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: ["pipeline-page", pipelineId, stageKey ?? "__empty__", organizationId, filtersKey],
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc(
        "get_pipeline_page",
        rpcArgs({
          ...filterParams,
          p_pipeline_id: pipelineId!,
          p_stage_id: stageKey!,
          p_page_size: PAGE_SIZE,
          p_cursor: pageParam ?? null,
        }),
      );
      if (error) throw error;
      return ((data ?? []) as RpcPageRow[]).map(flattenRpcEntry);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return lastPage[lastPage.length - 1]?.created_at ?? undefined;
    },
    enabled: enabled && !!organizationId && !!pipelineId && !!stageKey,
    staleTime: 30_000,
  });
}

export function usePaginatedFunil(
  pipelineId: string | undefined,
  stages: Array<Pick<CustomPipelineStage, "stage_key">>,
  filters: PaginatedFilters = {},
) {
  const { organizationId, isReady } = useOrganization();
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(filters.search ?? "");
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [filters.search]);

  // Fonte única (SCRUM-621): cards de qualquer funil vivem em pipeline_entries.
  useRealtimeSubscription("pipeline_entries", ["pipeline-page", "pipeline-stage-counts"]);

  const filterParams = useMemo(
    () => sharedRpcFilterParams(organizationId ?? "", debouncedSearch, filters),
    // A lista dimensiona cada campo do filtro — espelho de usePaginatedPipeline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      organizationId,
      debouncedSearch,
      filters.responsibleId,
      filters.tagIds,
      filters.origins,
      filters.ratingMin,
      filters.ratingMax,
      filters.calorMin,
      filters.calorMax,
      filters.urgency,
      filters.productType,
      filters.meetingAfter,
      filters.meetingBefore,
      filters.periodAfter,
      filters.periodBefore,
      filters.closedStatusKeys,
      filters.updatedBefore,
      filters.overdueExcludeStatusKeys,
      filters.statusKeys,
      filters.scheduled,
      filters.qualificationTier,
      filters.preQualificationTier,
      filters.stalledMinDays,
      filters.stalledMaxDays,
    ],
  );

  const filtersKey = useMemo(() => JSON.stringify(filterParams), [filterParams]);

  const countsQuery = useQuery({
    queryKey: ["pipeline-stage-counts", pipelineId, organizationId, filtersKey],
    queryFn: async () => {
      if (!organizationId || !pipelineId) return {} as Record<string, number>;
      // `as never` no nome: RPC mais nova que o types.ts gerado de prod —
      // mesmo padrão de `moverNegocio`; morre no próximo regen.
      const { data, error } = await supabase.rpc(
        "get_pipeline_stage_counts_by_id" as never,
        rpcArgs({ ...filterParams, p_pipeline_id: pipelineId }),
      );
      if (error) throw error;
      // O motor devolve (stage_id, stage_key, cnt) e separa linhas fantasma
      // (stage_id NULL) — o board endereça coluna por stage_key, então soma
      // por key (fantasma soma na key que o card ainda carrega).
      const map: Record<string, number> = {};
      for (const row of (data ?? []) as Array<{ stage_key: string | null; cnt: number }>) {
        if (row.stage_key) map[row.stage_key] = (map[row.stage_key] ?? 0) + Number(row.cnt);
      }
      return map;
    },
    enabled: isReady && !!organizationId && !!pipelineId,
    staleTime: 30_000,
  });

  const stageCounts = countsQuery.data ?? {};

  const stageKeys = useMemo(() => stages.map((s) => s.stage_key), [stages]);

  // Fixed-slots (mesma regra do board legado): sempre MAX_STAGES hooks,
  // habilita só os ativos — a contagem de hooks por render nunca muda.
  /* eslint-disable react-hooks/rules-of-hooks */
  const stageQueries: ReturnType<typeof useStageSlot>[] = [];
  for (let i = 0; i < MAX_STAGES; i++) {
    const key = stageKeys[i];
    stageQueries.push(
      useStageSlot(
        pipelineId,
        filterParams,
        key,
        filtersKey,
        organizationId,
        isReady && !!organizationId && i < stageKeys.length,
      ),
    );
  }
  /* eslint-enable react-hooks/rules-of-hooks */

  const stageData = useMemo(() => {
    const map: Record<string, StageData> = {};
    for (let i = 0; i < stageKeys.length && i < MAX_STAGES; i++) {
      const key = stageKeys[i];
      const q = stageQueries[i];
      const items = q.data?.pages.flat() ?? [];
      map[key] = {
        items,
        totalCount: stageCounts[key] ?? items.length,
        hasMore: q.hasNextPage ?? false,
        isFetchingMore: q.isFetchingNextPage,
        fetchMore: () => {
          if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
        },
        isLoading: q.isLoading,
      };
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageKeys, ...stageQueries.map((q) => q.data), stageCounts]);

  const isLoading =
    countsQuery.isLoading || stageQueries.some((q, i) => i < stageKeys.length && q.isLoading);

  return {
    stageData,
    stageCounts,
    isLoading,
    isLoadingCounts: countsQuery.isLoading,
    organizationId,
  };
}

/**
 * Move de card na página unificada — um destino, dois caminhos:
 *
 *   custom  → `useMoveLeadInCustomPipe` (INSTEAD OF da view): preserva TODA a
 *             lógica viva do board custom — auto-transition de etapa final,
 *             gatilhos de workflow, guarda de permissão;
 *   system  → UPDATE direto em `pipeline_entries` (fonte única, SCRUM-621): a
 *             MESMA linha que as views `pipe_*` escrevem, então os gatilhos de
 *             métrica/venda disparam idêntico. Os fluxos ricos do board de
 *             sistema (LossReasonDialog, modais de reunião, guarda de valor)
 *             NÃO moram aqui — chegam com a paridade de sistema na SCRUM-633/634;
 *             até lá as rotas `/pipe-*` continuam nas páginas antigas.
 *
 * Invalida por prefixo `pipeline-page`/`pipeline-stage-counts` (as chaves da
 * página nova) e as chaves do board custom legado — durante o expand as duas
 * páginas convivem e nenhuma pode ficar mentindo.
 */
export function useMoverCardNoFunil(pipeline: { id: string; type: "system" | "custom" } | null | undefined) {
  const queryClient = useQueryClient();
  const moveCustom = useMoveLeadInCustomPipe();
  const movePermission = useCanDo("move_pipe_record");

  return useMutation({
    mutationFn: async ({
      entryId,
      stageId,
      stageKey,
    }: {
      entryId: string;
      /** `pipeline_stages.id` (uuid) — o caminho custom move por ele. */
      stageId: string;
      /**
       * `pipeline_stages.stage_key` — o caminho system escreve a key e o
       * espelho `trg_pe_stage_mirror` resolve o `stage_id` (types.ts gerado de
       * prod ainda não conhece a coluna `stage_id`; escrever a key é o caminho
       * tipado E o que os gatilhos de métrica já escutam).
       */
      stageKey: string;
    }) => {
      if (!pipeline) throw new Error("Funil não carregado");

      if (pipeline.type === "custom") {
        return moveCustom.mutateAsync({
          entry_id: entryId,
          pipeline_id: pipeline.id,
          stage_id: stageId,
        });
      }

      if (!movePermission.allowed) {
        throw new Error(
          movePermission.isLoading
            ? "Permissões ainda carregando — tente novamente"
            : "Sem permissão para mover registros no pipe",
        );
      }

      const { data, error } = await supabase
        .from("pipeline_entries")
        .update({ stage_key: stageKey, stage_changed_at: new Date().toISOString() })
        .eq("id", entryId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      // Página nova.
      queryClient.invalidateQueries({ queryKey: ["pipeline-page"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-stage-counts"] });
      // Páginas antigas conviventes (expand): custom lê por estas…
      queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
      queryClient.invalidateQueries({ queryKey: ["custom_pipe_stage_counts"] });
      // …e as de sistema pelas views de compat.
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
    },
  });
}
