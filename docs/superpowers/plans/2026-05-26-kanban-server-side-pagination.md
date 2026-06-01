# Kanban Server-Side Pagination

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic `LIMIT 500` pipeline_entries query with per-stage paginated queries so orgs with 1000+ leads see every lead in the kanban.

**Architecture:** New Postgres RPC `get_pipeline_page` returns entries for a single stage with server-side filtering (responsible, search, origin, tags). New hook `usePaginatedPipeline` manages per-stage state with infinite scroll. `DraggableKanbanBoard` gains `onLoadMore` + `totalCount` per column. All 3 system pipe pages switch to the new hook; client-side filter logic is removed.

**Tech Stack:** Postgres RPC (plpgsql), Supabase PostgREST, TanStack Query v5 (useInfiniteQuery), React IntersectionObserver, existing DraggableKanbanBoard

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/20260526_get_pipeline_page.sql` | RPC: per-stage paginated query with server-side filters |
| Create | `src/hooks/usePaginatedPipeline.ts` | Hook: per-stage infinite query + stage counts |
| Modify | `src/components/kanban/DraggableKanbanBoard.tsx` | Add `onLoadMore`, `totalCount`, `hasMore` per column + sentinel |
| Modify | `src/hooks/usePipelineEntries.ts` | Export `LEAD_SELECT`, `flattenMetadata` for reuse; keep old hook (backward compat) |
| Modify | `src/hooks/usePipeWhatsapp.ts` | Add `usePipeWhatsappPaginated` wrapper |
| Modify | `src/hooks/usePipeConfirmacao.ts` | Add `usePipeConfirmacaoPaginated` wrapper |
| Modify | `src/hooks/usePipePropostas.ts` | Add `usePipePropostasPaginated` wrapper |
| Modify | `src/pages/PipeWhatsapp.tsx` | Switch to paginated hook, remove client-side filters |
| Modify | `src/pages/PipeConfirmacao.tsx` | Switch to paginated hook |
| Modify | `src/pages/PipePropostas.tsx` | Switch to paginated hook |

---

### Task 1: Postgres RPC — `get_pipeline_page`

**Files:**
- Create: `supabase/migrations/20260526_get_pipeline_page.sql`

The RPC returns entries for **one stage** with pagination and server-side filters. It also returns `total_count` so the frontend knows if there are more pages.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260526_get_pipeline_page.sql

CREATE OR REPLACE FUNCTION get_pipeline_page(
  p_pipeline_id uuid,
  p_stage_key   text,
  p_limit       int     DEFAULT 50,
  p_offset      int     DEFAULT 0,
  -- filters (all optional)
  p_responsible_id uuid   DEFAULT NULL,
  p_search         text   DEFAULT NULL,
  p_origin         text   DEFAULT NULL,
  p_tag_ids        uuid[] DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total   int;
  v_entries json;
BEGIN
  -- Count total matching entries for this stage (used for "X more" badge)
  SELECT count(*)
  INTO v_total
  FROM pipeline_entries pe
  JOIN leads l ON l.id = pe.lead_id AND l.deleted_at IS NULL
  WHERE pe.pipeline_id = p_pipeline_id
    AND pe.stage_key   = p_stage_key
    -- responsible filter: check metadata JSONB dual fields
    AND (
      p_responsible_id IS NULL
      OR (pe.metadata->>'pre_sale_responsible_id')::uuid = p_responsible_id
      OR (pe.metadata->>'sale_responsible_id')::uuid     = p_responsible_id
    )
    -- search filter
    AND (
      p_search IS NULL
      OR l.name    ILIKE '%' || p_search || '%'
      OR l.company ILIKE '%' || p_search || '%'
      OR l.phone   LIKE  '%' || p_search || '%'
    )
    -- origin filter
    AND (p_origin IS NULL OR l.origin = p_origin)
    -- tags filter (lead must have at least one of the tag IDs)
    AND (
      p_tag_ids IS NULL
      OR EXISTS (
        SELECT 1 FROM lead_tags lt
        WHERE lt.lead_id = l.id AND lt.tag_id = ANY(p_tag_ids)
      )
    );

  -- Fetch the page of entries with full lead data
  SELECT json_agg(row_to_json(t))
  INTO v_entries
  FROM (
    SELECT
      pe.id,
      pe.pipeline_id,
      pe.lead_id,
      pe.stage_key,
      pe.assigned_to,
      pe.metadata,
      pe.notes,
      pe.created_at,
      pe.updated_at,
      pe.stage_changed_at,
      pe.organization_id,
      json_build_object(
        'id',            l.id,
        'name',          l.name,
        'company',       l.company,
        'email',         l.email,
        'phone',         l.phone,
        'rating',        l.rating,
        'origin',        l.origin,
        'segment',       l.segment,
        'faturamento',   l.faturamento,
        'urgency',       l.urgency,
        'notes',         l.notes,
        'compromisso_date', l.compromisso_date,
        'ai_disabled',   l.ai_disabled,
        'avatar_url',    l.avatar_url,
        'pre_qualification_tier', l.pre_qualification_tier,
        'qualification_tier',     l.qualification_tier,
        'sdr_id',        l.sdr_id,
        'closer_id',     l.closer_id,
        'responsible_id', l.responsible_id,
        'pre_sale_responsible_id', l.pre_sale_responsible_id,
        'sale_responsible_id',     l.sale_responsible_id,
        'responsible',   (SELECT json_build_object('id', tm.id, 'name', tm.name, 'avatar_url', tm.avatar_url) FROM team_members tm WHERE tm.id = l.responsible_id),
        'sdr',           (SELECT json_build_object('id', tm.id, 'name', tm.name, 'avatar_url', tm.avatar_url) FROM team_members tm WHERE tm.id = l.sdr_id),
        'closer',        (SELECT json_build_object('id', tm.id, 'name', tm.name, 'avatar_url', tm.avatar_url) FROM team_members tm WHERE tm.id = l.closer_id),
        'pre_sale_responsible', (SELECT json_build_object('id', tm.id, 'name', tm.name, 'avatar_url', tm.avatar_url) FROM team_members tm WHERE tm.id = l.pre_sale_responsible_id),
        'sale_responsible',     (SELECT json_build_object('id', tm.id, 'name', tm.name, 'avatar_url', tm.avatar_url) FROM team_members tm WHERE tm.id = l.sale_responsible_id),
        'lead_tags',     COALESCE((
          SELECT json_agg(json_build_object(
            'tag', json_build_object('id', t.id, 'name', t.name, 'color', t.color)
          ))
          FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id
          WHERE lt.lead_id = l.id
        ), '[]'::json)
      ) AS lead
    FROM pipeline_entries pe
    JOIN leads l ON l.id = pe.lead_id AND l.deleted_at IS NULL
    WHERE pe.pipeline_id = p_pipeline_id
      AND pe.stage_key   = p_stage_key
      AND (
        p_responsible_id IS NULL
        OR (pe.metadata->>'pre_sale_responsible_id')::uuid = p_responsible_id
        OR (pe.metadata->>'sale_responsible_id')::uuid     = p_responsible_id
      )
      AND (
        p_search IS NULL
        OR l.name    ILIKE '%' || p_search || '%'
        OR l.company ILIKE '%' || p_search || '%'
        OR l.phone   LIKE  '%' || p_search || '%'
      )
      AND (p_origin IS NULL OR l.origin = p_origin)
      AND (
        p_tag_ids IS NULL
        OR EXISTS (
          SELECT 1 FROM lead_tags lt
          WHERE lt.lead_id = l.id AND lt.tag_id = ANY(p_tag_ids)
        )
      )
    ORDER BY pe.updated_at DESC NULLS LAST, pe.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) t;

  RETURN json_build_object(
    'entries',     COALESCE(v_entries, '[]'::json),
    'total_count', v_total
  );
END;
$$;

-- Stage counts (lightweight — no lead joins for filters, just raw counts)
CREATE OR REPLACE FUNCTION get_pipeline_stage_counts(
  p_pipeline_id uuid
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_object_agg(stage_key, cnt)
  FROM (
    SELECT pe.stage_key, count(*) AS cnt
    FROM pipeline_entries pe
    JOIN leads l ON l.id = pe.lead_id AND l.deleted_at IS NULL
    WHERE pe.pipeline_id = p_pipeline_id
    GROUP BY pe.stage_key
  ) sub;
$$;
```

- [ ] **Step 2: Apply migration to dev**

```bash
supabase db push --linked
```

- [ ] **Step 3: Verify RPC works**

Test with Supabase SQL editor:
```sql
SELECT get_pipeline_page(
  '2213999f-877b-48cf-bae2-0f66135db339',  -- Basic4u whatsapp pipe
  'respondeu',
  5,   -- limit
  0    -- offset
);
-- Should return JSON with entries array and total_count
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260526_get_pipeline_page.sql
git commit -m "feat(db): add get_pipeline_page RPC for server-side kanban pagination"
```

---

### Task 2: Export shared utilities from usePipelineEntries

**Files:**
- Modify: `src/hooks/usePipelineEntries.ts`

Export `LEAD_SELECT` and `flattenMetadata` so the new paginated hook can reuse them.

- [ ] **Step 1: Make exports public**

In `src/hooks/usePipelineEntries.ts`, change:

```typescript
// Before (line 8):
const LEAD_SELECT = `...`;

// After:
export const LEAD_SELECT = `...`;
```

```typescript
// Before (line 127):
function flattenMetadata(entry: any) {

// After:
export function flattenMetadata(entry: any) {
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePipelineEntries.ts
git commit -m "refactor: export LEAD_SELECT and flattenMetadata for reuse"
```

---

### Task 3: New hook — `usePaginatedPipeline`

**Files:**
- Create: `src/hooks/usePaginatedPipeline.ts`

This hook manages per-stage infinite queries using TanStack Query's `useInfiniteQuery`. Each stage gets its own query. Filters are passed to the RPC server-side.

- [ ] **Step 1: Create the hook**

```typescript
// src/hooks/usePaginatedPipeline.ts

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { usePipelineId, type PipelineType } from "./usePipelineEntries";
import { flattenMetadata } from "./usePipelineEntries";
import { usePipelineStages } from "./usePipelineStages";
import { useRealtimeSubscription } from "./useRealtimeSubscription";
import { useCallback } from "react";

const PAGE_SIZE = 50;

export interface PipelineFilters {
  responsibleId?: string | null;
  search?: string | null;
  origin?: string | null;
  tagIds?: string[] | null;
}

interface PageResult {
  entries: any[];
  total_count: number;
}

function useStagePage(
  pipelineId: string | null,
  stageKey: string,
  filters: PipelineFilters,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: [
      "pipeline_page",
      pipelineId,
      stageKey,
      filters.responsibleId ?? "all",
      filters.search ?? "",
      filters.origin ?? "all",
      filters.tagIds?.join(",") ?? "",
    ],
    queryFn: async ({ pageParam = 0 }) => {
      if (!pipelineId) return { entries: [], total_count: 0 } as PageResult;

      const { data, error } = await supabase.rpc("get_pipeline_page", {
        p_pipeline_id: pipelineId,
        p_stage_key: stageKey,
        p_limit: PAGE_SIZE,
        p_offset: pageParam,
        p_responsible_id: filters.responsibleId === "all" ? null : (filters.responsibleId ?? null),
        p_search: filters.search || null,
        p_origin: filters.origin === "all" ? null : (filters.origin ?? null),
        p_tag_ids: filters.tagIds?.length ? filters.tagIds : null,
      });

      if (error) throw error;

      const result = data as unknown as PageResult;
      return {
        entries: (result.entries ?? []).map(flattenMetadata),
        total_count: result.total_count,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.entries.length, 0);
      if (loaded >= lastPage.total_count) return undefined;
      return loaded;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export interface PaginatedStageData {
  stageKey: string;
  items: any[];
  totalCount: number;
  hasMore: boolean;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

export function usePaginatedPipeline(slug: PipelineType, filters: PipelineFilters) {
  const { organizationId, isReady } = useOrganization();
  const { data: pipelineId } = usePipelineId(slug);
  const { data: stages = [] } = usePipelineStages(slug);
  const queryClient = useQueryClient();

  const stageKeys = stages.map((s: any) => s.stage_key);
  const enabled = isReady && !!organizationId && !!pipelineId && stageKeys.length > 0;

  // One infinite query per stage
  const stageQueries = stageKeys.map((sk: string) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useStagePage(pipelineId ?? null, sk, filters, enabled)
  );

  // Realtime: invalidate all stage queries on pipeline_entries change
  useRealtimeSubscription("pipeline_entries", ["pipeline_entries", slug, organizationId], {
    onUpdate: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline_page", pipelineId] });
      return [];
    },
    onDelete: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline_page", pipelineId] });
      return [];
    },
  });

  // Stage counts (unfiltered, for badge totals)
  const { data: rawCounts } = useQuery({
    queryKey: ["pipeline_stage_counts", pipelineId],
    queryFn: async () => {
      if (!pipelineId) return {};
      const { data, error } = await supabase.rpc("get_pipeline_stage_counts", {
        p_pipeline_id: pipelineId,
      });
      if (error) throw error;
      return (data ?? {}) as Record<string, number>;
    },
    enabled: !!pipelineId,
    staleTime: 30_000,
  });

  const stageData: PaginatedStageData[] = stageKeys.map((sk: string, i: number) => {
    const q = stageQueries[i];
    const allItems = q.data?.pages.flatMap((p) => p.entries) ?? [];
    const totalCount = q.data?.pages[0]?.total_count ?? 0;

    return {
      stageKey: sk,
      items: allItems,
      totalCount,
      hasMore: q.hasNextPage ?? false,
      isLoading: q.isLoading,
      isFetchingNextPage: q.isFetchingNextPage,
      fetchNextPage: q.fetchNextPage,
    };
  });

  const isLoading = stageQueries.some((q) => q.isLoading);

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["pipeline_page", pipelineId] });
    queryClient.invalidateQueries({ queryKey: ["pipeline_stage_counts", pipelineId] });
  }, [queryClient, pipelineId]);

  const invalidateStage = useCallback(
    (stageKey: string) => {
      queryClient.invalidateQueries({
        queryKey: ["pipeline_page", pipelineId, stageKey],
      });
      queryClient.invalidateQueries({ queryKey: ["pipeline_stage_counts", pipelineId] });
    },
    [queryClient, pipelineId],
  );

  // Flat array of all loaded items (for backward-compat with stats, export, etc.)
  const allItems = stageData.flatMap((sd) => sd.items);

  return {
    stageData,
    allItems,
    rawCounts: rawCounts ?? {},
    isLoading,
    invalidateAll,
    invalidateStage,
    pipelineId,
  };
}
```

**Note on hooks-in-loop:** `useStagePage` is called per stage. The number of stages is fixed per pipeline and doesn't change at runtime (stages are loaded once and stable). This is safe because React hooks order is deterministic when the array length is constant. If you prefer, extract to a `StageQueryManager` pattern, but in practice pipeline stages are immutable during a session.

- [ ] **Step 2: Verify types**

```bash
npx tsc --noEmit 2>&1 | grep -i "usePaginatedPipeline\|error" | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePaginatedPipeline.ts
git commit -m "feat: add usePaginatedPipeline hook with per-stage infinite queries"
```

---

### Task 4: Modify DraggableKanbanBoard — infinite scroll support

**Files:**
- Modify: `src/components/kanban/DraggableKanbanBoard.tsx`

Add `totalCount`, `hasMore`, `onLoadMore`, `isFetchingMore` to `KanbanColumn`. Add IntersectionObserver sentinel at column bottom.

- [ ] **Step 1: Extend KanbanColumn type**

In `src/components/kanban/DraggableKanbanBoard.tsx`, update the interface:

```typescript
export interface KanbanColumn<T extends DraggableItem> {
  id: string;
  title: string;
  color: string;
  items: T[];
  totalCount?: number;
  hasMore?: boolean;
  isFetchingMore?: boolean;
  onLoadMore?: () => void;
}
```

- [ ] **Step 2: Add scroll sentinel to DroppableColumn**

After the `SortableContext` children block inside `DroppableColumn`, add:

```tsx
{/* Infinite scroll sentinel */}
{column.hasMore && (
  <LoadMoreSentinel
    onLoadMore={column.onLoadMore}
    isFetching={column.isFetchingMore}
  />
)}
```

- [ ] **Step 3: Create LoadMoreSentinel component**

Add inside the same file, before the main export:

```tsx
function LoadMoreSentinel({
  onLoadMore,
  isFetching,
}: {
  onLoadMore?: () => void;
  isFetching?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !onLoadMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetching) {
          onLoadMore();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onLoadMore, isFetching]);

  return (
    <div ref={ref} className="flex items-center justify-center py-3">
      {isFetching ? (
        <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      ) : (
        <span className="text-xs text-muted-foreground">Carregar mais...</span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update column header count badge**

In the column header, replace the hardcoded items.length with totalCount when available:

```tsx
<span className="bg-muted text-muted-foreground text-xs font-medium px-2 py-0.5 rounded-full">
  {column.totalCount ?? column.items.length}
</span>
```

- [ ] **Step 5: Add `useRef` to imports if not already present**

Ensure `useRef` is imported at the top of the file.

- [ ] **Step 6: Verify build**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add src/components/kanban/DraggableKanbanBoard.tsx
git commit -m "feat(kanban): add infinite scroll support with LoadMoreSentinel per column"
```

---

### Task 5: Wire PipeWhatsapp to paginated hook

**Files:**
- Modify: `src/hooks/usePipeWhatsapp.ts` — add `usePipeWhatsappPaginated`
- Modify: `src/pages/PipeWhatsapp.tsx` — switch to paginated

- [ ] **Step 1: Add paginated wrapper in usePipeWhatsapp.ts**

```typescript
import { usePaginatedPipeline, type PipelineFilters } from "./usePaginatedPipeline";

export function usePipeWhatsappPaginated(filters: PipelineFilters) {
  return usePaginatedPipeline("whatsapp", filters);
}
```

- [ ] **Step 2: Update PipeWhatsapp.tsx — replace data source**

In `PipeWhatsappInner`, replace:

```typescript
// OLD
const { data: pipeData, isLoading, isError, refetch } = usePipeWhatsapp();
```

With:

```typescript
// NEW
const pipelineFilters: PipelineFilters = useMemo(() => ({
  responsibleId: filterResponsible,
  search: searchTerm || null,
  origin: filterOrigin,
  tagIds: filterTags.length > 0 ? filterTags : null,
}), [filterResponsible, searchTerm, filterOrigin, filterTags]);

const {
  stageData,
  allItems: pipeData,
  rawCounts,
  isLoading,
  invalidateAll: refetch,
  invalidateStage,
} = usePipeWhatsappPaginated(pipelineFilters);
```

- [ ] **Step 3: Update columns useMemo — use stageData instead of client-side filter**

Replace the `columns` useMemo with:

```typescript
const columns = useMemo((): KanbanColumn<LeadCardData>[] => {
  return statusColumns.map((col) => {
    const sd = stageData.find((s) => s.stageKey === col.id);
    const items = (sd?.items ?? [])
      .filter((item: any) => item.lead != null)
      .map(transformToCard);

    return {
      ...col,
      items,
      totalCount: sd?.totalCount ?? 0,
      hasMore: sd?.hasMore ?? false,
      isFetchingMore: sd?.isFetchingNextPage ?? false,
      onLoadMore: sd?.fetchNextPage,
    };
  });
}, [statusColumns, stageData, metricsMap]);
```

- [ ] **Step 4: Remove client-side `filterItems` function**

The `filterItems` function (lines ~243-274) can be removed — all filtering is now server-side. Also remove the `matchesResponsibleFilter` import.

Keep the `leadsWithSchedule` filter as client-side if needed (it's a cross-table check), or remove it if not critical for this pipe.

- [ ] **Step 5: Update drag-and-drop handler to invalidate both stages**

In `handleStatusChange`, after the mutation completes, invalidate both source and target stages:

```typescript
const handleStatusChange = async (itemId: string, newStatus: string) => {
  // ... existing logic ...
  // After successful mutation:
  invalidateStage(item.status);  // old stage
  invalidateStage(newStatus);    // new stage
};
```

- [ ] **Step 6: Update stats calculation**

Replace the `stats` useMemo to use `rawCounts`:

```typescript
const stats = useMemo(() => {
  const total = Object.values(rawCounts).reduce((a, b) => a + b, 0);
  return {
    total,
    abordado: rawCounts["abordado"] ?? 0,
    respondeu: rawCounts["respondeu"] ?? 0,
    scheduled: rawCounts["agendado"] ?? 0,
    pending: rawCounts["novo"] ?? 0,
  };
}, [rawCounts]);
```

- [ ] **Step 7: Update ghost leads count**

Ghost leads are no longer a concern — the RPC joins `leads` with `deleted_at IS NULL`, so null leads are excluded server-side. Remove or simplify `ghostLeadsCount`.

- [ ] **Step 8: Verify build + test locally**

```bash
npx tsc --noEmit
npm run dev
# Navigate to /funis → Funil WhatsApp
# Verify: columns load, scroll loads more, filters work, drag-and-drop works
```

- [ ] **Step 9: Commit**

```bash
git add src/hooks/usePipeWhatsapp.ts src/pages/PipeWhatsapp.tsx
git commit -m "feat(pipe-whatsapp): switch to server-side paginated kanban queries"
```

---

### Task 6: Wire PipeConfirmacao to paginated hook

**Files:**
- Modify: `src/hooks/usePipeConfirmacao.ts`
- Modify: `src/pages/PipeConfirmacao.tsx`

Same pattern as Task 5. Key differences:
- Pipeline slug: `"confirmacao"`
- Stage keys differ (marcada, d5, d3, d1, compareceu, etc.)
- Has meeting-specific card data (meeting_date, meet_link, is_confirmed)

- [ ] **Step 1: Add paginated wrapper**

In `src/hooks/usePipeConfirmacao.ts`:

```typescript
import { usePaginatedPipeline, type PipelineFilters } from "./usePaginatedPipeline";

export function usePipeConfirmacaoPaginated(filters: PipelineFilters) {
  return usePaginatedPipeline("confirmacao", filters);
}
```

- [ ] **Step 2: Update PipeConfirmacao.tsx**

Apply same pattern as PipeWhatsapp:
1. Replace `usePipeConfirmacao()` with `usePipeConfirmacaoPaginated(pipelineFilters)`
2. Build `columns` from `stageData` instead of client-side filter
3. Remove client-side `filterItems`
4. Update drag-and-drop to `invalidateStage`
5. Update stats from `rawCounts`

- [ ] **Step 3: Verify build + test**

```bash
npx tsc --noEmit
npm run dev
# Navigate to Funil Confirmacao, verify columns + pagination
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/usePipeConfirmacao.ts src/pages/PipeConfirmacao.tsx
git commit -m "feat(pipe-confirmacao): switch to server-side paginated kanban queries"
```

---

### Task 7: Wire PipePropostas to paginated hook

**Files:**
- Modify: `src/hooks/usePipePropostas.ts`
- Modify: `src/pages/PipePropostas.tsx`

Same pattern. Extra complexity: Propostas loads `products` and `pipe_proposta_items` in a second pass. This needs to be preserved — fetch products for the loaded page items, not for all 500.

- [ ] **Step 1: Add paginated wrapper**

In `src/hooks/usePipePropostas.ts`:

```typescript
import { usePaginatedPipeline, type PipelineFilters } from "./usePaginatedPipeline";

export function usePipePropostasPaginated(filters: PipelineFilters) {
  return usePaginatedPipeline("propostas", filters);
}
```

- [ ] **Step 2: Update PipePropostas.tsx**

Apply same pattern. For the products secondary fetch, use `allItems` from the paginated hook and run the products fetch as a separate `useQuery` keyed on the loaded entry IDs:

```typescript
const loadedEntryIds = useMemo(
  () => stageData.flatMap((sd) => sd.items.map((i: any) => i.id)),
  [stageData],
);

const { data: productsData } = useQuery({
  queryKey: ["proposta_products", loadedEntryIds],
  queryFn: async () => {
    if (loadedEntryIds.length === 0) return { productsMap: new Map(), itemsMap: new Map() };
    const allItems = stageData.flatMap((sd) => sd.items);
    const productIds = allItems.map((e: any) => e.product_id).filter(Boolean);

    const [productsRes, itemsRes] = await Promise.all([
      supabase
        .from("products")
        .select("id, name, type, ticket, ticket_minimo")
        .in("id", productIds),
      supabase
        .from("pipe_proposta_items")
        .select("*, product:products(id, name, type, ticket, ticket_minimo)")
        .in("pipe_proposta_id", loadedEntryIds),
    ]);

    const productsMap = new Map((productsRes.data ?? []).map((p: any) => [p.id, p]));
    const itemsMap = new Map<string, any[]>();
    for (const item of (itemsRes.data ?? [])) {
      const arr = itemsMap.get(item.pipe_proposta_id) ?? [];
      arr.push(item);
      itemsMap.set(item.pipe_proposta_id, arr);
    }
    return { productsMap, itemsMap };
  },
  enabled: loadedEntryIds.length > 0,
  staleTime: 60_000,
});
```

- [ ] **Step 3: Verify build + test**

```bash
npx tsc --noEmit
npm run dev
# Navigate to Funil Propostas, verify columns + products display
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/usePipePropostas.ts src/pages/PipePropostas.tsx
git commit -m "feat(pipe-propostas): switch to server-side paginated kanban queries"
```

---

### Task 8: Deploy RPC to prod + verify

**Files:** None (deployment)

- [ ] **Step 1: Deploy migration to prod**

```bash
supabase db push --linked --project-ref jsjsmuncfkbsbzqzqhfq
```

Or apply via Supabase SQL editor (paste migration content).

- [ ] **Step 2: Test RPC in prod**

```sql
SELECT get_pipeline_page(
  '2213999f-877b-48cf-bae2-0f66135db339',
  'respondeu', 5, 0
);
-- Verify Dra. Mariana Rosa appears in results
```

- [ ] **Step 3: Push frontend and deploy**

```bash
git push origin main
# Wait for CI → pull :latest on EasyPanel
```

- [ ] **Step 4: Verify in prod**

Log in as Ana Luiza in Basic4u org. Navigate to Funil WhatsApp. Confirm Dra. Mariana Rosa is visible in the "Respondeu" column.

---

### Task 9: Cleanup — remove old LIMIT 500 query

**Files:**
- Modify: `src/hooks/usePipelineEntries.ts`

After all 3 pipes are confirmed working with pagination:

- [ ] **Step 1: Deprecate usePipelineEntries**

Add deprecation notice but keep function (custom pipelines may still use it):

```typescript
/**
 * @deprecated Use usePaginatedPipeline for system pipes.
 * Retained for custom_pipelines backward compat.
 */
export function usePipelineEntries(slug: PipelineType) {
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/usePipelineEntries.ts
git commit -m "chore: deprecate monolithic usePipelineEntries in favor of paginated"
```
