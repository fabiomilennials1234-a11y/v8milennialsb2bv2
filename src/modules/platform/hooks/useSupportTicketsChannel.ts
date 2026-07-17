/**
 * useSupportTicketsChannel — the customer's list and open thread stay live (ADR-0021, S4).
 *
 * When a master resolves a Chamado or moves it to waiting-on-customer, the change
 * reaches the customer's screen on its own — until now the customer's list only
 * refreshed on their own mutations, so a staff-side status change was invisible
 * until an F5.
 *
 * postgres_changes on support_tickets, no org filter: the table's RLS scopes the
 * stream to the tickets this user may see (their own; an admin, the org's). Any
 * event invalidates the shared support-tickets key, which refreshes both the list
 * (`[support-tickets, orgId]`) and any open thread (`[support-tickets, orgId, id]`).
 * A short debounce coalesces bursts.
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

const TICKETS_KEY = "support-tickets";
const DEBOUNCE_MS = 400;

export function useSupportTicketsChannel() {
  const { isReady } = useOrganization();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isReady) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const invalidateSoon = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        queryClient.invalidateQueries({ queryKey: [TICKETS_KEY] });
      }, DEBOUNCE_MS);
    };

    const channel = supabase
      .channel("support-tickets-list")
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
  }, [isReady, queryClient]);
}
