/**
 * useTicketChannel — live delivery of new comments on one Chamado (ADR-0021).
 *
 * Subscribes Realtime postgres_changes for INSERTs on this ticket's comments and
 * folds each incoming row into the comments cache. The message the sender just
 * wrote arrives here too, so it is deduped by id against the row the mutation's
 * own refetch already placed.
 *
 * Delivery only — the store is Postgres. An event missed while offline is
 * recovered on the thread's next fetch, never lost. Authorization is the table's
 * own RLS (author / admin-org / master, is_internal filtered), evaluated by
 * apply_rls per subscriber; nothing here filters, because nothing here needs to.
 *
 * The same subscription backs both the customer thread and the master detail —
 * one cache key (`support-ticket-comments`), both sides live. (Broadcast was the
 * ADR's first choice; it needs an RLS policy on realtime.messages that this
 * project cannot grant — see ADR-0021's amendment.)
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SupportTicketComment } from "./useSupportTickets";

const COMMENTS_KEY = "support-ticket-comments";
const ATTACHMENTS_KEY = "support-ticket-attachments";

export function useTicketChannel(ticketId: string | undefined | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!ticketId) return;

    const channel = supabase
      .channel(`support-comments:${ticketId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "support_ticket_comments",
          filter: `ticket_id=eq.${ticketId}`,
        },
        (payload) => {
          const record = payload.new as SupportTicketComment | undefined;
          if (!record?.id) return;

          queryClient.setQueryData<SupportTicketComment[]>(
            [COMMENTS_KEY, ticketId],
            (existing) => {
              if (!existing) return existing; // not loaded yet; the mount fetch will bring it
              if (existing.some((c) => c.id === record.id)) return existing; // dedup echo / repeat
              return [...existing, record].sort((a, b) =>
                a.created_at.localeCompare(b.created_at),
              );
            },
          );

          // Os anexos do comentário nascem alguns milissegundos depois dele — a
          // linha precisa do `comment_id`, então o comentário é anunciado
          // primeiro. Se este refetch ganhar a corrida, o anexo aparece na
          // próxima busca: chega tarde, não se perde. Publicar a tabela de
          // anexos no realtime custaria uma segunda assinatura por thread aberta
          // para fechar uma janela de milissegundos (ADR-0022).
          void queryClient.invalidateQueries({ queryKey: [ATTACHMENTS_KEY, ticketId] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ticketId, queryClient]);
}
