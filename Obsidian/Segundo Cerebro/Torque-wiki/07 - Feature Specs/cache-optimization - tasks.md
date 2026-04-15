---
tags:
  - torque-crm
  - spec
  - features
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: .specs/features/cache-optimization/tasks.md
---

# Cache Optimization - Tasks

## T1: QueryClient Defaults (REQ-06)
- **What:** Update QueryClient default options in App.tsx
- **Where:** `src/App.tsx` lines 91-101
- **Changes:** gcTime → 30 min, refetchOnReconnect → true
- **Done when:** Defaults updated, app compiles

## T2: useRealtimeSubscription - Surgical Updates (REQ-01)
- **What:** Add optional callbacks for INSERT/UPDATE/DELETE to avoid full invalidation
- **Where:** `src/hooks/useRealtimeSubscription.ts`
- **Depends on:** None
- **Changes:** Accept options param with onInsert/onUpdate/onDelete callbacks. When provided and event type matches, use setQueryData. Fall back to invalidation for unhandled events.
- **Done when:** Hook accepts callbacks, existing behavior preserved when no callbacks provided

## T3: Pipe staleTime + Surgical Handlers (REQ-01, REQ-02) [P]
- **What:** Add staleTime 10min and surgical realtime handlers to all 3 pipe hooks
- **Where:** `src/hooks/usePipeConfirmacao.ts`, `src/hooks/usePipePropostas.ts`, `src/hooks/usePipeWhatsapp.ts`
- **Depends on:** T2
- **Changes per hook:**
  - Add `staleTime: 10 * 60 * 1000`
  - Pass `onUpdate` handler: merge flat fields into cached item by id
  - Pass `onDelete` handler: filter out item by id
  - No `onInsert` handler (let it invalidate - new records need full nested data)
- **Done when:** Hooks use 10min staleTime and surgical handlers

## T4: Scoped Mutation Invalidations (REQ-03) [P]
- **What:** Remove cross-query invalidations from pipe mutation onSuccess
- **Where:** Same 3 pipe hook files as T3
- **Depends on:** None (can be done in same files as T3)
- **Changes:**
  - Remove `["leads"]`, `["recent_activity"]`, `["follow_ups"]` from onSuccess invalidations
  - Keep only the pipe's own queryKey invalidation
- **Done when:** Mutations only invalidate their own pipe

## T5: Metrics + Goals staleTime (REQ-05) [P]
- **What:** Increase staleTime on dashboard metrics and goals hooks
- **Where:** `src/hooks/useDashboardMetrics.ts`, `src/hooks/useGoals.ts`
- **Depends on:** None
- **Changes:**
  - `useDashboardMetrics`: staleTime 5 min
  - `useConversionRates`: staleTime 5 min
  - `useFunnelData`: staleTime 5 min
  - `useRankingData`: staleTime 5 min
  - `useGoals`: staleTime 5 min
  - `useTeamGoals`: staleTime 5 min
  - `useIndividualGoals`: staleTime 5 min
- **Done when:** All metrics hooks have 5min staleTime

## T6: Navigation Prefetch (REQ-04)
- **What:** Create usePrefetchPipes hook and wire into TopNavigation
- **Where:** NEW `src/hooks/usePrefetchPipes.ts`, `src/components/layout/TopNavigation.tsx`
- **Depends on:** T3 (needs to know the queryKeys/queryFns)
- **Changes:**
  - Create hook that prefetches all 3 pipe queries
  - Call on Funis dropdown open/hover in TopNavigation
- **Done when:** Opening Funis dropdown triggers prefetch of pipe data

## Execution Order
```
T1 ─────────────────► done
T2 ──► T3 + T4 ─────► done
T5 ─────────────────► done
T6 (after T3) ──────► done
```

T1, T2, T5 can run in parallel.
T3 + T4 run together after T2 (same files).
T6 runs after T3.


## Links relacionados

- [[MOC - Arquitetura]]

- [[Metas]]

- [[Dashboard]]

- [[Ranking]]

- [[Follow-ups]]

- [[WhatsApp Evolution]]

- [[00 - INDEX]]
- [[Visao Geral]]
