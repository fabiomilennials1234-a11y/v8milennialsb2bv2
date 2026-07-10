/**
 * Chamados, do lado do suporte da Torque (ADR-0018).
 *
 * Cross-org por desenho: nenhuma query filtra `organization_id`. Quem restringe
 * é a RLS — `is_master_user()` abre a fila inteira, e só para o staff.
 *
 * O que o staff escreve aqui é o que o trigger no banco permite: `tipo`,
 * `severidade`, `status`, atribuição. Os carimbos de tempo (`first_response_at`,
 * `resolved_at`, `awaiting_customer_ms`, `reopen_count`) são do banco, e uma
 * tentativa de escrevê-los daqui levanta exceção — de propósito.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import type {
  TicketSeveridade,
  TicketStatus,
  TicketTipo,
} from "@/modules/platform/lib/support-ticket-draft";
import { useMasterAuth } from "./useMasterAuth";

export type MasterSupportTicket = Tables<"support_tickets"> & {
  organization: { name: string } | null;
};

export interface MasterTicketFilters {
  status?: TicketStatus;
  tipo?: TicketTipo;
  severidade?: TicketSeveridade;
  organizationId?: string;
  /** `true` mostra só os que ninguém pegou. */
  unassigned?: boolean;
  /** Todos os chamados de um mesmo defeito — o link da issue do GitHub. */
  defectUrl?: string;
}

const QUEUE_KEY = "master-support-tickets";
const QUEUE_LIMIT = 200;

export function useMasterSupportTickets(filters: MasterTicketFilters = {}) {
  const { isMaster } = useMasterAuth();

  return useQuery({
    queryKey: [QUEUE_KEY, filters],
    queryFn: async () => {
      let query = supabase
        .from("support_tickets")
        .select("*, organization:organizations(name)")
        .order("created_at", { ascending: false })
        .limit(QUEUE_LIMIT);

      if (filters.status) query = query.eq("status", filters.status);
      if (filters.tipo) query = query.eq("tipo", filters.tipo);
      if (filters.severidade) query = query.eq("severidade", filters.severidade);
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.unassigned) query = query.is("assigned_master_user_id", null);
      if (filters.defectUrl) query = query.eq("defect_url", filters.defectUrl);

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as MasterSupportTicket[];
    },
    enabled: isMaster,
    staleTime: 30_000,
  });
}

/**
 * Os comentários de um Chamado, incluindo as notas internas — a RLS as entrega
 * só ao master.
 *
 * Hook próprio, e não o `useSupportTicketComments` do cliente: aquele espera a
 * organização carregar (`isReady`), e um master pode não pertencer a nenhuma.
 * O console ficaria eternamente sem thread.
 */
export function useMasterTicketComments(ticketId: string | null) {
  const { isMaster } = useMasterAuth();

  return useQuery({
    queryKey: ["support-ticket-comments", ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_ticket_comments")
        .select("*")
        .eq("ticket_id", ticketId!)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data as Tables<"support_ticket_comments">[];
    },
    enabled: isMaster && !!ticketId,
  });
}

/**
 * Triagem. Descobrir se é bug ou configuração *é* o trabalho do suporte, então
 * `tipo` é editável aqui e em lugar nenhum mais.
 */
export function useTriageSupportTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ticketId,
      ...patch
    }: {
      ticketId: string;
      tipo?: TicketTipo;
      severidade?: TicketSeveridade;
      status?: TicketStatus;
      /** `null` desvincula. O trigger recusa `defect_url` vinda do cliente. */
      defect_url?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("support_tickets")
        .update(patch)
        .eq("id", ticketId)
        .select()
        .single();

      if (error) throw error;
      return data as Tables<"support_tickets">;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUEUE_KEY] });
    },
  });
}

/**
 * Reivindicação, não despacho: quem for cuidar clica e assume. Serve para dois
 * atendentes não responderem o mesmo cliente — não para modelar uma fila de
 * trabalho. `null` devolve o chamado para a fila.
 */
export function useClaimSupportTicket() {
  const queryClient = useQueryClient();
  const { masterUser } = useMasterAuth();

  return useMutation({
    mutationFn: async ({
      ticketId,
      masterUserId,
    }: {
      ticketId: string;
      /** Omitido, assume o próprio. `null` devolve à fila. */
      masterUserId?: string | null;
    }) => {
      const assignee = masterUserId === undefined ? masterUser?.id : masterUserId;
      if (assignee === undefined) throw new Error("usuario master nao carregado");

      const { data, error } = await supabase
        .from("support_tickets")
        .update({ assigned_master_user_id: assignee })
        .eq("id", ticketId)
        .select()
        .single();

      if (error) throw error;
      return data as Tables<"support_tickets">;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUEUE_KEY] });
    },
  });
}

/**
 * Resposta ao cliente, ou nota interna.
 *
 * `first_response_at` NÃO é carimbado aqui: um trigger o faz quando o primeiro
 * comentário público de um master entra. Carimbar do cliente seria uma promessa
 * que o console pode esquecer de cumprir.
 */
export function useCreateStaffComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ticketId,
      body,
      isInternal,
      authorUserId,
    }: {
      ticketId: string;
      body: string;
      isInternal: boolean;
      authorUserId: string;
    }) => {
      const trimmed = body.trim();
      if (!trimmed) throw new Error("comentario vazio");

      const { data, error } = await supabase
        .from("support_ticket_comments")
        .insert({
          ticket_id: ticketId,
          author_user_id: authorUserId,
          body: trimmed,
          is_internal: isInternal,
        })
        .select()
        .single();

      if (error) throw error;
      return data as Tables<"support_ticket_comments">;
    },
    onSuccess: (_data, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: ["support-ticket-comments", ticketId] });
      queryClient.invalidateQueries({ queryKey: [QUEUE_KEY] });
    },
  });
}
