/**
 * useSupportUnread — o loop de volta (ADR-0018, decisão 7).
 *
 * Toda feature de suporte constrói a caixa de entrada e esquece que ninguém
 * volta para olhar. Aqui o badge acende no instante em que a resposta entra:
 * um trigger no banco insere a notificação, `notifications` está publicada no
 * Realtime, e a subscription invalida a query.
 *
 * Notificação é do usuário, não da organização — a RLS de `notifications` é
 * `user_id = auth.uid()`. Não há filtro de autor aqui pelo mesmo motivo de
 * sempre: filtrar no cliente daria a impressão de que o isolamento é dele.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/modules/identity";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import {
  SUPPORT_REPLY_TYPE,
  summarizeUnreadReplies,
  type UnreadSummary,
} from "@/modules/platform/lib/support-unread";

const UNREAD_KEY = "support-unread-replies";

/**
 * Respostas do suporte que este usuário ainda não viu, agregadas por Chamado.
 *
 * O polling de 60s do `AlertsDropdown` continua existindo como rede de
 * segurança; o Realtime é o mecanismo.
 */
export function useSupportUnread(): UnreadSummary & { isLoading: boolean } {
  const { user } = useAuth();

  // `notifications` entrou na publicação do Realtime na migration 20270118.
  // A invalidação também toca `user-alerts` — o sino do topo lê a mesma tabela.
  useRealtimeSubscription("notifications", [UNREAD_KEY, "user-alerts"]);

  const { data, isLoading } = useQuery({
    queryKey: [UNREAD_KEY, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("type, entity_id")
        .eq("type", SUPPORT_REPLY_TYPE)
        .is("read_at", null);

      if (error) throw error;
      return summarizeUnreadReplies(data ?? []);
    },
    enabled: !!user?.id,
  });

  return { byTicket: data?.byTicket ?? {}, total: data?.total ?? 0, isLoading };
}

/**
 * Abrir o thread é o ato de ler. Marcar como lido em outro lugar seria pedir ao
 * usuário que confirmasse que leu o que já está na tela dele.
 */
export function useMarkSupportRepliesRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ticketId: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("type", SUPPORT_REPLY_TYPE)
        .eq("entity_id", ticketId)
        .is("read_at", null);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [UNREAD_KEY] });
      queryClient.invalidateQueries({ queryKey: ["user-alerts"] });
    },
  });
}
