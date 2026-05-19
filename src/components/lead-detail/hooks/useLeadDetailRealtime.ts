import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

/**
 * Realtime fan-out for the lead detail modal (Issue #306, PRD #284 Fase 3).
 *
 * Subscribes to the 6 tables that drive the modal:
 *   - `leads`              (the lead row itself; filter by id)
 *   - `lead_history`       (activity feed)
 *   - `lead_comments`      (comments thread)
 *   - `lead_tags`          (tag chips)
 *   - `pipeline_entries`   (cross-pipe accordion)
 *   - `pipe_proposta_items` (proposta line items — no lead_id column,
 *                            filtered by org, narrowed client-side via
 *                            the invalidated queries themselves)
 *
 * Gates:
 *   - Disabled when the modal is closed or no lead is selected.
 *   - 500ms lazy delay before enabling — avoids churn if the user is
 *     flipping between leads quickly.
 *
 * The underlying `useRealtimeChannel` handles backoff, circuit-breaker,
 * and unmount-time `removeChannel` for each subscription. Each event
 * routes to a `queryClient.invalidateQueries` call for the relevant
 * cache key — the components that depend on those keys refetch
 * automatically.
 *
 * Depends on the RLS fix in migration 20261030000003 (#291) which
 * eliminated recursive `team_members` subqueries on `lead_history` —
 * without that fix the Realtime `apply_rls()` evaluation deadlocks.
 */
export function useLeadDetailRealtime(
  leadId: string | null,
  isOpen: boolean,
  organizationId: string | null | undefined,
): { enabled: boolean } {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const debounceTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Lazy enable after 500ms to avoid churn on quick lead swaps.
  useEffect(() => {
    if (!isOpen || !leadId) {
      setEnabled(false);
      return;
    }
    setEnabled(false);
    const t = setTimeout(() => setEnabled(true), 500);
    return () => {
      clearTimeout(t);
      setEnabled(false);
    };
  }, [isOpen, leadId]);

  const invalidate = useCallback(
    (keys: string[][]) => {
      // Debounce per cache-key to coalesce bulk updates.
      for (const queryKey of keys) {
        const k = queryKey.join("::");
        const existing = debounceTimers.current.get(k);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey });
          debounceTimers.current.delete(k);
        }, 150);
        debounceTimers.current.set(k, timer);
      }
    },
    [queryClient],
  );

  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const isLive = enabled && !!leadId;
  const leadFilter = leadId ? `id=eq.${leadId}` : undefined;
  const leadIdFilter = leadId ? `lead_id=eq.${leadId}` : undefined;
  const orgFilter = organizationId ? `organization_id=eq.${organizationId}` : undefined;

  useRealtimeChannel({
    table: "leads",
    filter: leadFilter,
    enabled: isLive,
    onEvent: () => {
      if (!leadId) return;
      invalidate([
        ["lead-detail", leadId],
        ["lead-visibility", leadId],
      ]);
    },
  });

  useRealtimeChannel({
    table: "lead_history",
    filter: leadIdFilter,
    enabled: isLive,
    onEvent: () => {
      if (!leadId) return;
      invalidate([
        ["lead-timeline", leadId],
        ["lead_history", leadId],
        ["lead-history", leadId],
      ]);
    },
  });

  useRealtimeChannel({
    table: "lead_comments",
    filter: leadIdFilter,
    enabled: isLive,
    onEvent: () => {
      if (!leadId) return;
      invalidate([
        ["lead-comments", leadId],
        ["lead_comments", leadId],
      ]);
    },
  });

  useRealtimeChannel({
    table: "lead_tags",
    filter: leadIdFilter,
    enabled: isLive,
    onEvent: () => {
      if (!leadId) return;
      invalidate([
        ["lead-tags", leadId],
        ["lead-detail", leadId],
      ]);
    },
  });

  useRealtimeChannel({
    table: "pipeline_entries",
    filter: leadIdFilter,
    enabled: isLive,
    onEvent: () => {
      if (!leadId) return;
      invalidate([
        ["pipeline_entries", leadId],
        ["lead-pipes", leadId],
      ]);
    },
  });

  useRealtimeChannel({
    table: "pipe_proposta_items",
    filter: orgFilter,
    enabled: isLive && !!organizationId,
    onEvent: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      if (!leadId) return;
      // Items themselves don't reference the lead — invalidate the
      // proposta cache scoped to this lead and let the next fetch
      // narrow on the server.
      void payload;
      invalidate([
        ["pipe_propostas_items", leadId],
        ["lead-pipes", leadId],
      ]);
    },
  });

  return { enabled: isLive };
}
