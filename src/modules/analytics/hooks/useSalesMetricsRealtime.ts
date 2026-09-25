import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrganization } from "@/modules/identity";
import { useRealtimeChannel } from "@/shared/realtime/useRealtimeChannel";
import { invalidateSalesMetrics } from "@/shared/realtime/invalidate-sales-metrics";

/** One subscription per page, shared by all tabs and cards. */
export function useSalesMetricsRealtime() {
  const { organizationId, isReady } = useOrganization();
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabled = isReady && !!organizationId;
  const refresh = useCallback(() => {
    if (enabled) void invalidateSalesMetrics(queryClient, organizationId);
  }, [enabled, organizationId, queryClient]);

  const { state } = useRealtimeChannel({
    table: "sale_events",
    filter: organizationId ? `organization_id=eq.${organizationId}` : undefined,
    enabled,
    onEvent: (payload) => {
      // Sales, reversals and adjustments are all INSERTs in the same ledger.
      if (!enabled || payload.eventType !== "INSERT" || payload.new.organization_id !== organizationId) return;
      // Coalesce one transaction's related events without postponing forever
      // under a continuous stream of sales.
      if (timer.current) return;
      timer.current = setTimeout(() => { timer.current = null; refresh(); }, 250);
    },
  });

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, [organizationId, enabled]);

  useEffect(() => {
    // Also closes the gap between the first fetch and subscription/reconnect.
    if (state === "joined") refresh();
  }, [state, refresh]);

  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    // Realtime outages must not leave a dashboard frozen indefinitely.
    const fallback = state !== "joined" ? setInterval(onVisible, 30_000) : null;
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
      if (fallback) clearInterval(fallback);
    };
  }, [enabled, state, refresh]);
}
