/**
 * useWhatsAppMessages — query de mensagens por conversa.
 * Extraído de src/hooks/useWhatsAppChat.ts (C12).
 *
 * C20: remove refetchInterval — realtime via usePatchedRealtime cuida da atualização.
 * Polling de 20s era o comportamento anterior; agora o canal realtime em
 * useWhatsAppMessagesRealtime aplica patches incrementais sem refetch.
 */
import { useQuery } from "@tanstack/react-query";
import { useCurrentTeamMember } from "@/modules/identity";
import { fetchConversationMessages } from "@/modules/communication/lib/whatsappMessagesQuery";
import { chatQueryKeys } from "./shared/queryKeys";
import {
  useWhatsAppRealtimeFallback,
  FALLBACK_POLL_INTERVAL_MS,
  JOINED_BACKSTOP_POLL_INTERVAL_MS,
} from "./useRealtimeFallback";

/**
 * Hook para buscar mensagens de um contato específico em uma instância (inbox).
 * Filtra por instanceId para mostrar só a conversa daquele número.
 *
 * Realtime via useWhatsAppMessagesRealtime cobre o caminho saudável. Quando o
 * canal fica offline/stale por >2min, useWhatsAppRealtimeFallback ativa
 * `refetchInterval` de 10s pra garantir progresso até reconectar.
 */
export function useWhatsAppMessages(
  phoneNumber: string | null,
  instanceId: string | null
) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;
  const { shouldPoll } = useWhatsAppRealtimeFallback(organizationId);

  return useQuery({
    queryKey: chatQueryKeys.messages(organizationId, phoneNumber, instanceId),
    queryFn: async () => {
      if (!organizationId || !phoneNumber || !instanceId) return [];
      return fetchConversationMessages({ organizationId, instanceId, phoneNumber });
    },
    enabled: !!organizationId && !!phoneNumber && !!instanceId,
    // Backstop de reconciliação: se um postgres_changes é dropado pelo apply_rls
    // sob carga (canal segue "joined"), a msg nova só apareceria no F5. Refetch
    // de segurança periódico com a aba focada garante progresso. Ver
    // JOINED_BACKSTOP_POLL_INTERVAL_MS em useRealtimeFallback.
    refetchInterval: shouldPoll
      ? FALLBACK_POLL_INTERVAL_MS
      : JOINED_BACKSTOP_POLL_INTERVAL_MS,
  });
}
