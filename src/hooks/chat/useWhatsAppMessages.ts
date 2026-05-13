/**
 * useWhatsAppMessages — query de mensagens por conversa.
 * Extraído de src/hooks/useWhatsAppChat.ts (C12).
 *
 * C20: remove refetchInterval — realtime via usePatchedRealtime cuida da atualização.
 * Polling de 20s era o comportamento anterior; agora o canal realtime em
 * useWhatsAppMessagesRealtime aplica patches incrementais sem refetch.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import type { WhatsAppMessage } from "./types";
import { chatQueryKeys } from "./shared/queryKeys";

/**
 * Hook para buscar mensagens de um contato específico em uma instância (inbox).
 * Filtra por instanceId para mostrar só a conversa daquele número.
 */
export function useWhatsAppMessages(
  phoneNumber: string | null,
  instanceId: string | null
) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: chatQueryKeys.messages(organizationId, phoneNumber, instanceId),
    queryFn: async () => {
      if (!organizationId || !phoneNumber || !instanceId) return [];

      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select("id, organization_id, instance_id, message_id, remote_jid, phone_number, direction, message_type, content, media_url, push_name, status, lead_id, timestamp, created_at, sent_by_ai, sent_source")
        .eq("organization_id", organizationId)
        .eq("instance_id", instanceId)
        .eq("phone_number", phoneNumber)
        .order("timestamp", { ascending: true });

      if (error) throw error;
      return data as WhatsAppMessage[];
    },
    enabled: !!organizationId && !!phoneNumber && !!instanceId,
    // Sem refetchInterval — realtime via useWhatsAppMessagesRealtime cuida da atualização.
    // Fallback de staleTime padrão (5min) garante que dados sejam refetched em edge cases.
  });
}
