# Cache Optimization — Pipe Funnel Performance

## Problem

Navigating between pipe funnels (Whatsapp, Confirmacao, Propostas) is slow. Every navigation triggers full data refetches instead of serving from cache. Root causes:

1. Realtime subscriptions invalidate entire query families instead of surgical updates
2. Mutations cascade-invalidate 3-4 unrelated query families per card move
3. No staleTime on pipe queries (default 5 min too aggressive with realtime)
4. Team members fetched redundantly across every pipe hook (5-7x)
5. Zero prefetching on navigation hover
6. Dashboard metrics refetch on every page visit (staleTime 1 min)

## Requirements

### REQ-01: Surgical Realtime Updates
- `useRealtimeSubscription` must accept a callback that receives the realtime payload
- For INSERT/UPDATE events: use `queryClient.setQueryData` to patch the affected item in cache
- For DELETE events: remove the item from cache
- Fallback: only invalidate if the record's shape doesn't match the cached query
- Keep debounce for bulk operations (existing DEBOUNCE_MS)

### REQ-02: Optimized staleTime for Pipe Queries
- `usePipeConfirmacao`: staleTime 10 min (realtime provides freshness)
- `usePipePropostas`: staleTime 10 min
- `usePipeWhatsapp`: staleTime 10 min (currently 30s — far too aggressive)
- Rationale: realtime subscription already guarantees UI freshness; staleTime only matters for remounts

### REQ-03: Surgical Mutation Invalidations
- Update mutations should only invalidate the specific pipe they belong to
- Remove cascade invalidations of `["leads"]`, `["recent_activity"]`, `["follow_ups"]` from pipe mutations
- These secondary queries have their own realtime subscriptions or update on their own schedule

### REQ-04: Navigation Prefetch
- When pipe navigation links become visible (sidebar/top nav hover or mount), prefetch the pipe data
- Use `queryClient.prefetchQuery` with the same queryFn/queryKey as the pipe hooks
- Only prefetch if data is stale (React Query handles this natively)

### REQ-05: Optimized Metrics Caching
- `useDashboardMetrics`: staleTime 5 min (currently 1 min)
- `useConversionRates`: staleTime 5 min (currently no staleTime)
- `useFunnelData`: staleTime 5 min (currently no staleTime)
- `useRankingData`: staleTime 5 min (currently 1 min)
- `useGoals` / `useTeamGoals` / `useIndividualGoals`: staleTime 5 min (currently 2 min)

### REQ-06: QueryClient Default Tuning
- Increase default `gcTime` from 10 min to 30 min (keep data in memory longer for back-navigation)
- Change `refetchOnReconnect` from `"always"` to `true` (only refetch stale queries on reconnect)

## Out of Scope
- Pagination/infinite scroll for pipes
- Splitting pipe queries into smaller nested queries
- Server-side caching (Supabase edge caching)
- Team members deduplication (would require refactoring all pipe selects — too invasive)

## Success Criteria
- Navigating between pipes feels instant when data is cached
- Moving a card does NOT trigger full refetch of the pipe
- Realtime changes appear in <3 seconds without full refetch
- Dashboard metrics survive navigation without re-querying
