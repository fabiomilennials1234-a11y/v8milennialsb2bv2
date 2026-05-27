/**
 * useTransferToSzChatDepartment + useActiveSzChatSession
 * Extraídos de src/hooks/useWhatsAppChat.ts (C12).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook to transfer a conversation back to an SZ.chat department.
 */
export function useTransferToSzChatDepartment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      organizationId,
      sessionId,
      targetTeamName,
      targetTeamId,
    }: {
      organizationId: string;
      sessionId: string;
      targetTeamName?: string;
      targetTeamId?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("sz-chat-send", {
        body: {
          action: "transfer_back",
          organization_id: organizationId,
          session_id: sessionId,
          target_team_name: targetTeamName,
          target_team_id: targetTeamId,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Falha ao transferir");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
      queryClient.invalidateQueries({ queryKey: ["sz_chat_session"] });
    },
  });
}

/**
 * Hook to check if a phone number has an active SZ.chat session.
 * Returns session data including available teams for transfer.
 */
export function useActiveSzChatSession(phoneNumber: string | null, organizationId: string | null) {
  return useQuery({
    queryKey: ["sz_chat_session", organizationId, phoneNumber],
    queryFn: async () => {
      if (!phoneNumber || !organizationId) return null;

      const { data, error } = await supabase.functions.invoke("sz-chat-send", {
        body: {
          action: "get_active_session",
          organization_id: organizationId,
          phone_number: phoneNumber,
        },
      });

      if (error || !data?.session) return null;
      return data.session as {
        sz_chat_session_id: string;
        team_mappings: Record<string, string>;
      };
    },
    enabled: !!phoneNumber && !!organizationId,
    staleTime: 30_000,
  });
}
