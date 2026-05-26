import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { usePipelineId, flattenMetadata, type PipelineType } from "./usePipelineEntries";
import { useRealtimeSubscription } from "./useRealtimeSubscription";
import type { PipelineStage } from "./usePipelineStages";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const MAX_STAGES = 20;

export interface PaginatedFilters {
  search?: string;
  responsibleId?: string | null;
  tagIds?: string[];
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

function rpcParams(
  slug: PipelineType,
  orgId: string,
  search: string,
  filters: PaginatedFilters
) {
  return {
    p_pipeline_slug: slug,
    p_org_id: orgId,
    p_search: search || null,
    p_responsible_id:
      filters.responsibleId === "all"
        ? null
        : filters.responsibleId || null,
    p_tag_ids: filters.tagIds?.length ? filters.tagIds : null,
  };
}

function useStageSlot(
  slug: PipelineType,
  stageKey: string | undefined,
  organizationId: string | undefined,
  search: string,
  filters: PaginatedFilters,
  enabled: boolean
) {
  const query = useInfiniteQuery({
    queryKey: [
      "pipeline-page",
      slug,
      stageKey ?? "__empty__",
      organizationId,
      search,
      filters.responsibleId,
      filters.tagIds,
    ],
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("get_pipeline_page", {
        ...rpcParams(slug, organizationId!, search, filters),
        p_stage_id: stageKey!,
        p_page_size: PAGE_SIZE,
        p_cursor: pageParam ?? null,
      });
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

  const countsQuery = useQuery({
    queryKey: [
      "pipeline-stage-counts",
      slug,
      organizationId,
      debouncedSearch,
      filters.responsibleId,
      filters.tagIds,
    ],
    queryFn: async () => {
      if (!organizationId) return {};
      const { data, error } = await supabase.rpc(
        "get_pipeline_stage_counts",
        rpcParams(slug, organizationId, debouncedSearch, filters)
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
        slug,
        key,
        organizationId,
        debouncedSearch,
        filters,
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
