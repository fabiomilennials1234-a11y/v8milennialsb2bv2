/**
 * Chamados da Área do Gestor (ADR-0021 §9).
 *
 * O Gestor de Portfólio abre e lê Chamados de dentro do hub `/gestor`, SEMPRE
 * ancorados a uma das orgs vinculadas — nunca um chamado org-less. Estes hooks
 * são explícitos na org (não dependem de `useOrganization`/org selecionada),
 * porque o Gestor pode chegar ao hub sem nenhuma org ativa.
 *
 * A visibilidade continua sendo da RLS: `get_my_admin_organization_ids()` passa
 * a incluir as orgs do gestor (swap HITL-gated de S1), então a lista devolve os
 * chamados de todo o portfólio vinculado. O marcador `author_gestor_id` é o que
 * diz ao staff da Torque que o autor é um Gestor, não um Team Member da org.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { buildTicketInsert, type TicketDraft } from "@/modules/platform";
import { useAuth } from "../../auth/contexts/AuthContext";
import { useGestor } from "./useGestor";

/** Chamado do portfólio do gestor, com o nome da org para a lista. */
export type GestorSupportTicket = Tables<"support_tickets"> & {
  organization: { name: string } | null;
  /** Ausente do types.ts gerado (drift repo↔prod). Ver gestor/types.ts. */
  author_gestor_id?: string | null;
};

const GESTOR_TICKETS_KEY = "gestor-support-tickets";

/** Os chamados que a RLS entrega ao gestor — todo o portfólio vinculado. */
export function useGestorSupportTickets() {
  const { isGestor } = useGestor();

  return useQuery({
    queryKey: [GESTOR_TICKETS_KEY],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("*, organization:organizations(name)")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as unknown as GestorSupportTicket[];
    },
    enabled: isGestor,
    staleTime: 30_000,
  });
}

/**
 * Abre um Chamado como Gestor: ancorado a uma org vinculada + marcador de
 * autor-gestor. Reutiliza `buildTicketInsert` (a mesma linha canônica do fluxo
 * do cliente) e só acrescenta `author_gestor_id`.
 *
 * `boundOrgIds` é a whitelist de vínculos vinda do hub — o frontend nunca
 * inventa uma org fora dela. O trigger `enforce_support_ticket_gestor_author`
 * reforça o mesmo no banco.
 */
export function useCreateGestorSupportTicket() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { gestorId } = useGestor();

  return useMutation({
    mutationFn: async ({
      draft,
      organizationId,
      boundOrgIds,
      supportContext = {},
    }: {
      draft: TicketDraft;
      organizationId: string;
      boundOrgIds: string[];
      supportContext?: Record<string, unknown>;
    }) => {
      if (!user?.id) throw new Error("usuario nao autenticado");
      if (!gestorId) throw new Error("gestor nao carregado");
      if (!organizationId) throw new Error("selecione a organizacao do chamado");
      if (!boundOrgIds.includes(organizationId)) {
        throw new Error("organizacao fora dos vinculos do gestor");
      }

      // Mesma linha canônica do cliente + marcador. Enumerado, sem spread do
      // rascunho: o builder recusa qualquer campo que o cliente não deva emitir.
      const base = buildTicketInsert(draft, {
        organizationId,
        authorUserId: user.id,
        supportContext,
      });
      const row = { ...base, author_gestor_id: gestorId };

      const { data, error } = await supabase
        .from("support_tickets")
        .insert(row as never)
        .select()
        .single();

      if (error) throw error;
      return data as Tables<"support_tickets">;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [GESTOR_TICKETS_KEY] });
    },
  });
}
