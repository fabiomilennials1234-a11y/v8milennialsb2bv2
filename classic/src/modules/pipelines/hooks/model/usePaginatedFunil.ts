import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCanDo, useCurrentTeamMember, useOrganization } from "@/modules/identity";
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
import { executarMoveCustom } from "../custom/useCustomPipelines";
import { useFunilRealtime } from "./useFunilRealtime";
import { fetchStageCounts, stageCountsQueryKey } from "@/modules/pipelines/lib/stage-counts-query";
import {
  aplicarMoveOtimista,
  cancelarFetchDoMove,
  colunaDoCardNoCache,
  reconciliarMoveNoFunil,
  reverterMoveOtimista,
  type MoveOtimista,
} from "@/modules/pipelines/lib/funil-move-cache";
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
 * QueryKeys por pipeline_id (padrão 626): `["pipeline-page", pipelineId,
 * stageKey, …]` e `["pipeline-stage-counts", pipelineId, …]`. O prefixo é o
 * mesmo do board legado — quem invalida por prefixo de fora (lead drawer,
 * tags) continua alcançando o board. Move e Realtime DESTA página, ao
 * contrário, endereçam coluna por coluna (`lib/funil-move-cache`).
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
  // Cirúrgico: cada evento invalida só as colunas que toca neste funil.
  useFunilRealtime(pipelineId);

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

  // Chave/busca compartilhadas com o cabeçalho (`useFunilMetrics`): mesmo
  // recorte ⇒ mesma chave ⇒ uma ida só no mount (ver `stage-counts-query`).
  const countsArgs = useMemo(
    () => ({ ...filterParams, p_pipeline_id: pipelineId ?? "" }),
    [filterParams, pipelineId],
  );
  const countsQuery = useQuery({
    queryKey: stageCountsQueryKey(pipelineId, countsArgs),
    queryFn: () => fetchStageCounts(countsArgs),
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

/** Variáveis do move na página unificada. */
export interface MoverCardNoFunilVars {
  entryId: string;
  /** `pipeline_stages.id` (uuid) — o caminho custom move por ele. */
  stageId: string;
  /**
   * `pipeline_stages.stage_key` — o caminho system escreve a key e o espelho
   * `trg_pe_stage_mirror` resolve o `stage_id` (types.ts gerado de prod ainda
   * não conhece a coluna `stage_id`; escrever a key é o caminho tipado E o que
   * os gatilhos de métrica já escutam). Também é a coluna de destino no cache.
   */
  stageKey: string;
  /**
   * O chamador já aplicou o otimismo (`aplicarMoveOtimista`) e é dono do
   * rollback — caso do `completarMove`, que move o card ANTES de gravar o
   * metadata do desfecho. Aqui o hook não aplica nem reverte; só reconcilia.
   */
  otimistaDoChamador?: MoveOtimista;
}

interface MoverCardContext {
  /** Otimismo aplicado por ESTE hook (rollback é dele). */
  move: MoveOtimista | null;
  fromStage: string | null;
  /** Recusado antes de escrever (sem permissão): nada mudou no banco. */
  negado?: boolean;
}

/**
 * Move de card na página unificada — um destino, dois caminhos:
 *
 *   custom  → `executarMoveCustom` (a MESMA escrita de
 *             `useMoveLeadInCustomPipe`: auto-transition de etapa final,
 *             gatilhos de workflow, integração carteira) — sem o `onSuccess`
 *             de invalidação ampla daquele hook;
 *   system  → UPDATE direto em `pipeline_entries` (fonte única, SCRUM-621): a
 *             MESMA linha que as views `pipe_*` escrevem, então os gatilhos de
 *             métrica/venda disparam idêntico.
 *
 * Cache (`lib/funil-move-cache`):
 *   onMutate  → card muda de coluna na hora (otimismo) + eco registrado;
 *   onError   → rollback fiel do snapshot;
 *   onSettled → UMA reconciliação: colunas de origem e destino + contagem
 *               deste funil; o resto só marcado como velho.
 */
export function useMoverCardNoFunil(pipeline: { id: string; type: "system" | "custom" } | null | undefined) {
  const queryClient = useQueryClient();
  const movePermission = useCanDo("move_pipe_record");
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation<{ lead_id?: string | null } | null, Error, MoverCardNoFunilVars, MoverCardContext>({
    onMutate: async ({ entryId, stageKey, otimistaDoChamador }) => {
      if (!pipeline) return { move: null, fromStage: null };
      if (otimistaDoChamador) {
        return { move: null, fromStage: otimistaDoChamador.snapshot.fromStage };
      }
      // Sem permissão o mutationFn recusa — não pisca o card à toa.
      if (!movePermission.allowed) return { move: null, fromStage: null, negado: true };
      const origem = colunaDoCardNoCache(queryClient, pipeline.id, entryId);
      await cancelarFetchDoMove(queryClient, { pipelineId: pipeline.id, stages: [origem, stageKey] });
      const move = aplicarMoveOtimista(queryClient, { pipelineId: pipeline.id, entryId, toStage: stageKey });
      return { move, fromStage: move.snapshot.fromStage ?? origem };
    },
    mutationFn: async ({ entryId, stageId, stageKey }) => {
      if (!pipeline) throw new Error("Funil não carregado");

      if (!movePermission.allowed) {
        throw new Error(
          movePermission.isLoading
            ? "Permissões ainda carregando — tente novamente"
            : "Sem permissão para mover registros no pipe",
        );
      }

      if (pipeline.type === "custom") {
        if (!teamMember?.organization_id) throw new Error("Organização não encontrada");
        return executarMoveCustom(
          { entry_id: entryId, pipeline_id: pipeline.id, stage_id: stageId },
          teamMember.organization_id,
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
    onError: (_err, _vars, context) => {
      if (context?.move) reverterMoveOtimista(queryClient, context.move);
    },
    onSettled: (data, _err, vars, context) => {
      // Negado por permissão: nenhuma escrita, nada a reconciliar.
      if (!pipeline || context?.negado) return;
      reconciliarMoveNoFunil(queryClient, {
        pipelineId: pipeline.id,
        entryId: vars.entryId,
        leadId: data?.lead_id ?? null,
        fromStage: context?.fromStage ?? null,
        toStage: vars.stageKey,
      });
    },
  });
}
