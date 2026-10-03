/**
 * useMasterSupportUnread — the staff side of the loop (ADR-0021, S3).
 *
 * Symmetric to the customer's useSupportUnread: a badge lights the instant a
 * customer replies. The trigger notify_support_ticket_reply inserts a
 * 'support_ticket_customer_reply' notification for every active master when a
 * non-master comments; here it is read back and aggregated by Chamado.
 *
 * A master's notifications carry the *ticket's* org_id, not the master's (a master
 * has none), so the house useRealtimeSubscription — which forces an org filter —
 * cannot serve this. A dedicated channel with no filter does; notifications RLS
 * (user_id = auth.uid()) is what scopes the stream to this master.
 */

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  SUPPORT_CUSTOMER_REPLY_TYPE,
  summarizeUnreadReplies,
  type UnreadSummary,
} from "@/modules/platform/lib/support-unread";
import { useMasterAuth } from "./useMasterAuth";

const MASTER_UNREAD_KEY = "master-support-unread";
const DEBOUNCE_MS = 400;

export function useMasterSupportUnread(): UnreadSummary & { isLoading: boolean } {
  const { isMaster, masterUser } = useMasterAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isMaster) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const invalidateSoon = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        queryClient.invalidateQueries({ queryKey: [MASTER_UNREAD_KEY] });
      }, DEBOUNCE_MS);
    };

    const channel = supabase
      .channel("master-support-unread")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        invalidateSoon,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [isMaster, queryClient]);

  const { data, isLoading } = useQuery({
    queryKey: [MASTER_UNREAD_KEY, masterUser?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("type, entity_id")
        .eq("type", SUPPORT_CUSTOMER_REPLY_TYPE)
        .is("read_at", null);

      if (error) throw error;
      return summarizeUnreadReplies(data ?? [], SUPPORT_CUSTOMER_REPLY_TYPE);
    },
    enabled: isMaster,
  });

  return { byTicket: data?.byTicket ?? {}, total: data?.total ?? 0, isLoading };
}

/** Opening the Chamado is the act of reading it — mark this ticket's replies read. */
export function useMarkMasterRepliesRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ticketId: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("type", SUPPORT_CUSTOMER_REPLY_TYPE)
        .eq("entity_id", ticketId)
        .is("read_at", null);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [MASTER_UNREAD_KEY] });
      queryClient.invalidateQueries({ queryKey: ["user-alerts"] });
    },
  });
}
