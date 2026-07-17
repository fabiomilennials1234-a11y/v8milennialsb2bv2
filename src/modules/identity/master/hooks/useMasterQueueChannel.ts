/**
 * useMasterQueueChannel — live master support queue (ADR-0021, S2).
 *
 * A new Chamado from any org enters the queue on its own, and a claim/triage/status
 * change reflects live — no F5. The queue is cross-org, so there is deliberately NO
 * org filter: the master receives every ticket event because the support_tickets RLS
 * (is_master_user()) authorizes it, evaluated by apply_rls per subscriber. A
 * non-master mounting this would receive only their own tickets — but only the master
 * console mounts it, behind the isMaster guard.
 *
 * The queue query carries server-side ordering, filters and a limit, so an event
 * invalidates it (a short debounce coalesces bursts) rather than surgically patching
 * the cache — a refetch is the only way to keep ordering and filters honest.
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMasterAuth } from "./useMasterAuth";

const QUEUE_KEY = "master-support-tickets";
const DEBOUNCE_MS = 400;

export function useMasterQueueChannel() {
  const { isMaster } = useMasterAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isMaster) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const invalidateSoon = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        queryClient.invalidateQueries({ queryKey: [QUEUE_KEY] });
      }, DEBOUNCE_MS);
    };

    const channel = supabase
      .channel("master-support-queue")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_tickets" },
        invalidateSoon,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [isMaster, queryClient]);
}
