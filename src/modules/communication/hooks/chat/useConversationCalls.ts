/**
 * Ligações da conversa aberta, para a linha do tempo do chat.
 *
 * ── Custo ──
 * O chat é o caminho mais quente do produto, então este hook é deliberadamente
 * barato: UMA requisição por conversa aberta, resolvida pelo cache do TanStack
 * Query. Não é por render (é `useQuery`, com key estável) e não é por mensagem
 * (a lista inteira vem numa consulta só).
 *
 * E, ao contrário de `useWhatsAppMessages`, NÃO tem `refetchInterval`. Mensagem
 * chega sozinha o tempo todo e precisa de backstop; ligação só nasce quando
 * alguém desliga o telefone — pendurar um poll de 10s/20s nisso seria custo
 * contínuo para um evento raro. Quem acabou de ligar recebe a linha nova pela
 * invalidação em `invalidateConversationCalls`, chamada quando a chamada de voz
 * termina.
 */
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo, useCallback } from "react";
import { normalizePhone } from "@/lib/normalizePhone";
import { useCurrentTeamMember } from "@/modules/identity";
import { chatQueryKeys } from "@/modules/communication/hooks/chat/shared/queryKeys";
import {
  fetchConversationCalls,
  type ConversationCall,
} from "@/modules/communication/lib/conversationCallsQuery";

export function useConversationCalls(
  phoneNumber: string | null,
  leadId: string | null,
) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  // Normaliza uma vez e usa o MESMO valor na key e no filtro — dois formatos
  // do mesmo número não podem virar duas entradas de cache.
  const normalized = useMemo(() => normalizePhone(phoneNumber), [phoneNumber]);

  return useQuery({
    queryKey: chatQueryKeys.calls(organizationId, normalized, leadId),
    queryFn: async (): Promise<ConversationCall[]> => {
      if (!organizationId) return [];
      return fetchConversationCalls({
        organizationId,
        phoneNumber: normalized,
        leadId,
      });
    },
    // Sem telefone E sem lead não há conversa a consultar.
    enabled: !!organizationId && (!!normalized || !!leadId),
    // A projeção da ligação acontece no banco quando a chamada termina; nada
    // reescreve uma linha já projetada. Um minuto de frescor evita refetch a
    // cada volta para a mesma conversa.
    staleTime: 60_000,
  });
}

/**
 * Marca as ligações da conversa como obsoletas. Chamado quando uma chamada de
 * voz termina — é o único momento em que `call_logs` ganha linha nova sem que o
 * usuário troque de conversa.
 */
export function invalidateConversationCalls(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: ["call_logs_conversation"] });
}

/** Versão hook do invalidador, para uso dentro de componentes. */
export function useInvalidateConversationCalls() {
  const queryClient = useQueryClient();
  return useCallback(
    () => invalidateConversationCalls(queryClient),
    [queryClient],
  );
}
