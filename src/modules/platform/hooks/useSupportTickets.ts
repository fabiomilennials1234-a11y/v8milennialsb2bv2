/**
 * useSupportTickets — Chamados (ADR-0018).
 *
 * A visibilidade é da RLS, não daqui: o autor vê os seus, o admin da org vê
 * todos da org, o master vê tudo. Este hook não filtra por autor — filtrar no
 * cliente daria a impressão de que o filtro é dele.
 *
 * O mesmo vale para `is_internal`: a policy jamais entrega uma nota interna a
 * um cliente. Nada aqui a esconde, porque nada aqui a recebe.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useAuth } from "@/modules/identity";
import type { Tables } from "@/integrations/supabase/types";
import {
  buildTicketInsert,
  type TicketDraft,
} from "@/modules/platform/lib/support-ticket-draft";

export type SupportTicket = Tables<"support_tickets">;
export type SupportTicketComment = Tables<"support_ticket_comments">;

const TICKETS_KEY = "support-tickets";
const COMMENTS_KEY = "support-ticket-comments";

/** Os chamados que a RLS deixa este usuário ver, mais recentes primeiro. */
export function useSupportTickets() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: [TICKETS_KEY, organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as SupportTicket[];
    },
    enabled: isReady,
  });
}

export function useSupportTicket(ticketId: string | null) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: [TICKETS_KEY, organizationId, ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("*")
        .eq("id", ticketId!)
        .maybeSingle();

      if (error) throw error;
      return data as SupportTicket | null;
    },
    enabled: isReady && !!ticketId,
  });
}

export function useCreateSupportTicket() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      draft,
      supportContext = {},
    }: {
      draft: TicketDraft;
      supportContext?: Record<string, unknown>;
    }) => {
      if (!organizationId) throw new Error("organizacao nao carregada");
      if (!user?.id) throw new Error("usuario nao autenticado");

      const row = buildTicketInsert(draft, {
        organizationId,
        authorUserId: user.id,
        supportContext,
      });

      const { data, error } = await supabase
        .from("support_tickets")
        .insert(row)
        .select()
        .single();

      if (error) throw error;
      return data as SupportTicket;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [TICKETS_KEY] });
    },
  });
}

/**
 * Reabrir é a única transição de status que o cliente pode fazer. O trigger no
 * banco recusa qualquer outra — inclusive `fechado`, que é terminal e chega só
 * pelo cron, 7 dias depois de `resolvido`.
 *
 * `reopen_count` é incrementado pelo banco: um Chamado reaberto três vezes é
 * evidência de que a correção nunca pegou, e esse sinal precisa somar.
 */
export function useReopenSupportTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ticketId: string) => {
      const { data, error } = await supabase
        .from("support_tickets")
        .update({ status: "aberto" })
        .eq("id", ticketId)
        .select()
        .single();

      if (error) throw error;
      return data as SupportTicket;
    },
    onSuccess: (_data, ticketId) => {
      queryClient.invalidateQueries({ queryKey: [TICKETS_KEY] });
      queryClient.invalidateQueries({ queryKey: [COMMENTS_KEY, ticketId] });
    },
  });
}

/**
 * Os comentários que a RLS entrega. Notas internas do staff nunca chegam ao
 * cliente — o filtro está na policy de SELECT, não numa cláusula daqui.
 */
export function useSupportTicketComments(ticketId: string | null) {
  const { isReady } = useOrganization();

  return useQuery({
    queryKey: [COMMENTS_KEY, ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_ticket_comments")
        .select("*")
        .eq("ticket_id", ticketId!)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data as SupportTicketComment[];
    },
    enabled: isReady && !!ticketId,
  });
}

export function useCreateSupportTicketComment() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ ticketId, body }: { ticketId: string; body: string }) => {
      if (!user?.id) throw new Error("usuario nao autenticado");

      const trimmed = body.trim();
      if (!trimmed) throw new Error("comentario vazio");

      const { data, error } = await supabase
        .from("support_ticket_comments")
        .insert({
          ticket_id: ticketId,
          author_user_id: user.id,
          body: trimmed,
          // Este é o painel do cliente: a mensagem é da Organização, nunca do
          // suporte — mesmo quando um master a escreve em shadow mode. A origem
          // é o que conta, não a identidade do autor.
          from_staff: false,
          // `is_internal` é omitido de propósito: o default do banco é false e a
          // policy recusaria `true` vindo de um cliente. Enviar o campo faria
          // parecer que ele é do cliente escolher.
        })
        .select()
        .single();

      if (error) throw error;
      return data as SupportTicketComment;
    },
    onSuccess: (_data, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: [COMMENTS_KEY, ticketId] });
      queryClient.invalidateQueries({ queryKey: [TICKETS_KEY] });
    },
  });
}
