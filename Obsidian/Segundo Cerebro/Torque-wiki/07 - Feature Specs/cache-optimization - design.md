---
tags:
  - torque-crm
  - spec
  - features
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: .specs/features/cache-optimization/design.md
---

# Cache Optimization - Design

## Architecture Changes

### 1. useRealtimeSubscription - Surgical Updates (REQ-01)

**Current:** Receives any realtime event → invalidateQueries (full refetch)
**New:** Receives realtime event with payload → setQueryData to patch single item

New signature:
```typescript
useRealtimeSubscription(
  table: string,
  queryKeys: string[],
  options?: {
    // When provided, does setQueryData instead of invalidation
    // Receives the realtime payload and returns the updated cache
    onInsert?: (newRecord: any, oldData: any[]) => any[];
    onUpdate?: (updatedRecord: any, oldData: any[]) => any[];
    onDelete?: (deletedRecord: any, oldData: any[]) => any[];
  }
)
```

**Why callbacks instead of generic logic:**
Pipe queries have deeply nested selects (lead, team_members, tags). The realtime payload only contains the flat record. A generic "replace by id" would lose the nested data. So:
- `onUpdate`: merge the flat fields from realtime into the existing cached item (keep nested data intact)
- `onInsert`: invalidate - the new record needs the full nested select
- `onDelete`: filter out by id (no nested data needed)

### 2. Pipe Hooks - staleTime + Surgical Handlers (REQ-02, REQ-01)

Each pipe hook will:
1. Set `staleTime: 10 * 60 * 1000` (10 min)
2. Pass surgical handlers to `useRealtimeSubscription`

### 3. Mutation Invalidations - Scoped (REQ-03)

Remove cross-query invalidations. Each mutation only invalidates its own pipe:
- `useUpdatePipeConfirmacao.onSuccess` → only `["pipe_confirmacao"]`
- `useUpdatePipeProposta.onSuccess` → only `["pipe_propostas"]`
- `useUpdatePipeWhatsapp.onSuccess` → only `["pipe_whatsapp"]`

Removed invalidations (`["leads"]`, `["recent_activity"]`, `["follow_ups"]`) are covered by their own realtime subscriptions or are not user-visible during pipe operations.

### 4. Prefetch on Navigation (REQ-04)

Add `usePrefetchPipes()` hook called from TopNavigation. Uses `queryClient.prefetchQuery` for all 3 pipes when the Funis dropdown is opened/hovered.

### 5. File Changes Summary

| File | Change |
|------|--------|
| `src/hooks/useRealtimeSubscription.ts` | Add surgical update support via callbacks |
| `src/hooks/usePipeConfirmacao.ts` | staleTime 10min, surgical handlers, scoped invalidations |
| `src/hooks/usePipePropostas.ts` | staleTime 10min, surgical handlers, scoped invalidations |
| `src/hooks/usePipeWhatsapp.ts` | staleTime 10min, surgical handlers, scoped invalidations |
| `src/hooks/useDashboardMetrics.ts` | staleTime 5min on all queries |
| `src/hooks/useGoals.ts` | staleTime 5min |
| `src/hooks/usePrefetchPipes.ts` | NEW - prefetch hook for navigation |
| `src/components/layout/TopNavigation.tsx` | Wire usePrefetchPipes on Funis dropdown |
| `src/App.tsx` | gcTime 30min, refetchOnReconnect true |


## Links relacionados

- [[MOC - Arquitetura]]

- [[Metas]]

- [[Gestao de Time]]

- [[Dashboard]]

- [[Follow-ups]]

- [[Pipe Propostas]]

- [[Pipe Confirmacao]]

- [[Pipe WhatsApp]]

- [[WhatsApp Evolution]]

- [[00 - INDEX]]
- [[Visao Geral]]
