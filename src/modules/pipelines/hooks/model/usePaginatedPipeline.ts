import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { usePipelineId, flattenMetadata, type PipelineType } from "./usePipelineEntries";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import type { PipelineStage } from "./usePipelineStages";

// Exportados p/ o hook irmão `usePaginatedFunil` (SCRUM-632): mesma cadência de
// página/debounce/slots nos dois boards até a W6 fundir os hooks.
export const PAGE_SIZE = 20;
export const SEARCH_DEBOUNCE_MS = 300;
// Fixed-slots cap: always call this many useStageSlot hooks, enable only the
// active ones (see loop below). Boards with more active stages than this hide
// the overflow columns' cards entirely. Raised 20→40 because orgs like Basic4u
// run 25+ active stages (leads in stages 21-25 were invisible on the board).
export const MAX_STAGES = 40;

/**
 * Filters applied to a paginated board. `search`, `responsibleId` and `tagIds`
 * were the original server-side dimensions; everything below is the generic
 * filter surface added so the column-count badge and the paginated cards stay
 * consistent (the count used to ignore client-only filters → e.g. Perdido kept
 * showing 21 after filtering origin=site to 10). Each board maps its own UI
 * (origin single/multi, time buckets, period, overdue)
 * into these generic params; the RPCs (get_pipeline_page /
 * get_pipeline_stage_counts) apply them as plain SQL predicates. A null/empty
 * value means "filter disabled".
 */
export interface PaginatedFilters {
  search?: string;
  responsibleId?: string | null;
  tagIds?: string[];
  /** leads.origin ∈ origins (empty/undefined = no filter) */
  origins?: string[];
  /** leads.urgency = urgency */
  urgency?: string | null;
  /** metadata.product_type = productType */
  productType?: string | null;
  /** metadata.meeting_date range (ISO) — confirmação time buckets */
  meetingAfter?: string | null;
  meetingBefore?: string | null;
  /**
   * Period range (ISO). For entries whose stage_key ∈ closedStatusKeys the ref
   * date is metadata.metrics_period_at (fallback updated_at); otherwise
   * created_at. closedStatusKeys null → always created_at (whatsapp /
   * confirmação period selector).
   */
  periodAfter?: string | null;
  periodBefore?: string | null;
  closedStatusKeys?: string[] | null;
  /** Overdue bucket: updated_at <= updatedBefore AND stage_key ∉ exclude set */
  updatedBefore?: string | null;
  overdueExcludeStatusKeys?: string[] | null;
  /** stage_key ∈ statusKeys (confirmação status multi-select) */
  statusKeys?: string[] | null;
  /** true → only leads with a 'scheduled' scheduled_user_message */
  scheduled?: boolean | null;
  /** leads.qualification_tier ∈ list (empty/undefined = no filter) */
  qualificationTier?: string[];
  /** leads.pre_qualification_tier ∈ list (IA tier; empty/undefined = no filter) */
  preQualificationTier?: string[];
  /**
   * "Parado há": idade na etapa ATUAL, em dias completos, medida sobre
   * COALESCE(stage_changed_at, entered_at, created_at). Distinto de
   * periodAfter/Before, que olham a data de criação. Ver `lib/stalled-buckets`.
   */
  stalledMinDays?: number | null;
  stalledMaxDays?: number | null;
}

export interface StageData {
  items: any[];
  totalCount: number;
  hasMore: boolean;
  isFetchingMore: boolean;
  fetchMore: () => void;
  isLoading: boolean;
}

function flattenRpcEntry(row: any) {
  const lead = typeof row.lead === "string" ? JSON.parse(row.lead) : row.lead;
  return flattenMetadata({ ...row, lead });
}

const nonEmpty = (a?: string[] | null) => (a && a.length ? a : null);
const orNull = <T,>(v: T | null | undefined) => (v === undefined || v === null ? null : v);

/**
 * Shared param block sent to BOTH RPCs. Stage/cursor/page-size are appended by
 * the per-stage query. Empty arrays and "all" sentinels collapse to null so an
 * inactive filter short-circuits server-side.
 *
 * Exported for unit testing: it is the SINGLE source of the filter params for
 * both get_pipeline_stage_counts (the column badge) and get_pipeline_page (the
 * cards). Because both consume this exact object, the tier predicate can never
 * be sent to only one of them — badge == cards by construction.
 */
export function sharedRpcParams(
  slug: PipelineType,
  orgId: string,
  search: string,
  filters: PaginatedFilters
) {
  return {
    p_pipeline_slug: slug,
    ...sharedRpcFilterParams(orgId, search, filters),
  };
}

/**
 * O bloco de filtros SEM o seletor de funil (slug/id).
 *
 * Extraído de `sharedRpcParams` na SCRUM-632: a página unificada (`/funil/:slug`)
 * fala com as MESMAS RPCs mas endereça o funil por `p_pipeline_id` (caminho
 * canônico da SCRUM-626), não por slug. O mapeamento filtro→parâmetro fica num
 * lugar só — duplicá-lo divergiria badge e cards entre as duas famílias de
 * board na primeira mudança de filtro.
 */
export function sharedRpcFilterParams(
  orgId: string,
  search: string,
  filters: PaginatedFilters
) {
  const stalled = {
    min: orNull(filters.stalledMinDays),
    max: orNull(filters.stalledMaxDays),
  };
  return {
    p_org_id: orgId,
    p_search: search || null,
    p_responsible_id:
      filters.responsibleId === "all" ? null : filters.responsibleId || null,
    p_tag_ids: nonEmpty(filters.tagIds),
    p_origins: nonEmpty(filters.origins),
    p_urgency: filters.urgency && filters.urgency !== "all" ? filters.urgency : null,
    p_product_type:
      filters.productType && filters.productType !== "all" ? filters.productType : null,
    p_meeting_after: filters.meetingAfter || null,
    p_meeting_before: filters.meetingBefore || null,
    p_period_after: filters.periodAfter || null,
    p_period_before: filters.periodBefore || null,
    p_closed_status_keys: nonEmpty(filters.closedStatusKeys),
    p_updated_before: filters.updatedBefore || null,
    p_overdue_exclude_status_keys: nonEmpty(filters.overdueExcludeStatusKeys),
    p_status_keys: nonEmpty(filters.statusKeys),
    p_scheduled: filters.scheduled ? true : null,
    p_qualification_tier: nonEmpty(filters.qualificationTier),
    p_pre_qualification_tier: nonEmpty(filters.preQualificationTier),
    // "Parado há" entra na chamada SÓ quando está ativo — e isso é ordem de
    // deploy, não estilo. O PostgREST resolve a função por nome + argumentos:
    // mandar `p_stalled_min_days: null` contra um banco que ainda não recebeu a
    // migration 20270729000010 devolve PGRST202 ("could not find the function
    // ... in the schema cache") e derruba o board INTEIRO, não só o filtro.
    // Omitindo, a chamada padrão continua idêntica à de hoje: o front pode
    // subir antes da migration, e só quem escolhe uma faixa depende dela.
    ...(stalled.min !== null || stalled.max !== null
      ? { p_stalled_min_days: stalled.min, p_stalled_max_days: stalled.max }
      : {}),
  };
}

/**
 * Ponte de tipo até o regen de `src/integrations/supabase/types.ts`.
 *
 * `p_stalled_min_days` / `p_stalled_max_days` existem na migration
 * `20270729000010_pipeline_page_stalled_days_filter.sql`, mas `types.ts` é
 * gerado a partir do schema de PROD — enquanto a migration não for aplicada e os
 * tipos regenerados, a assinatura conhecida pelo TS não tem esses campos. Editar
 * `types.ts` na mão é proibido (arquivo auto-gerado), então a divergência mora
 * aqui, num ponto só, em vez de virar `as any` espalhado.
 *
 * Os parâmetros seguem dentro de `sharedRpcParams` de propósito: é o objeto
 * único que alimenta as DUAS RPCs, e é essa unicidade que garante que a
 * contagem da coluna e os cards apliquem exatamente o mesmo recorte.
 *
 * Depois de `supabase gen types`, apague esta função e passe `sharedParams`
 * direto — o TS volta a checar a forma inteira sozinho.
 */
function rpcArgs<T extends object>(params: T): never {
  return params as unknown as never;
}

function useStageSlot(
  sharedParams: ReturnType<typeof sharedRpcParams>,
  stageKey: string | undefined,
  filtersKey: string,
  organizationId: string | undefined,
  enabled: boolean
) {
  const query = useInfiniteQuery({
    queryKey: [
      "pipeline-page",
      sharedParams.p_pipeline_slug,
      stageKey ?? "__empty__",
      organizationId,
      filtersKey,
    ],
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("get_pipeline_page", rpcArgs({
        ...sharedParams,
        p_stage_id: stageKey!,
        p_page_size: PAGE_SIZE,
        p_cursor: pageParam ?? null,
      }));
      if (error) throw error;
      return (data ?? []).map(flattenRpcEntry);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return lastPage[lastPage.length - 1]?.created_at ?? undefined;
    },
    enabled: enabled && !!organizationId && !!stageKey,
    staleTime: 30_000,
  });

  return query;
}

export function usePaginatedPipeline(
  slug: PipelineType,
  stages: PipelineStage[] | { stage_key: string }[],
  filters: PaginatedFilters = {}
) {
  const { organizationId, isReady } = useOrganization();
  const { data: pipelineId } = usePipelineId(slug);
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(filters.search ?? "");
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [filters.search]);

  useRealtimeSubscription("pipeline_entries", [
    "pipeline-page",
    slug,
    organizationId,
  ]);

  // Single source of truth for every server-side filter dimension. Computed
  // once and shared by the counts query + all stage queries so the column
  // badge (count) and the rendered cards (pages) can never diverge.
  const sharedParams = useMemo(
    () => sharedRpcParams(slug, organizationId ?? "", debouncedSearch, filters),
    [
      slug,
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
    ]
  );

  // Stable cache key for the whole filter set (drives refetch of counts + pages
  // whenever ANY dimension changes — origin, time bucket, etc.).
  const filtersKey = useMemo(() => JSON.stringify(sharedParams), [sharedParams]);

  const countsQuery = useQuery({
    queryKey: ["pipeline-stage-counts", slug, organizationId, filtersKey],
    queryFn: async () => {
      if (!organizationId) return {};
      const { data, error } = await supabase.rpc(
        "get_pipeline_stage_counts",
        rpcArgs(sharedParams)
      );
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const row of data ?? []) {
        map[row.stage_key] = Number(row.cnt);
      }
      return map;
    },
    enabled: isReady && !!organizationId,
    staleTime: 30_000,
  });

  const stageCounts = countsQuery.data ?? {};

  // Fixed-slots: always call MAX_STAGES hooks, enable only active ones
  const stageKeys = useMemo(
    () => stages.map((s) => s.stage_key),
    [stages]
  );

  /* eslint-disable react-hooks/rules-of-hooks */
  const stageQueries: ReturnType<typeof useStageSlot>[] = [];
  for (let i = 0; i < MAX_STAGES; i++) {
    const key = stageKeys[i];
    stageQueries.push(
      useStageSlot(
        sharedParams,
        key,
        filtersKey,
        organizationId,
        isReady && !!organizationId && i < stageKeys.length
      )
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
  }, [stageKeys, ...stageQueries.map((q) => q.data), stageCounts]);

  const isLoading =
    countsQuery.isLoading ||
    stageQueries.some((q, i) => i < stageKeys.length && q.isLoading);

  const allItems = useMemo(() => {
    return Object.values(stageData).flatMap((s) => s.items);
  }, [stageData]);

  return {
    stageData,
    stageCounts,
    allItems,
    isLoading,
    isLoadingCounts: countsQuery.isLoading,
    organizationId,
    pipelineId,
  };
}
