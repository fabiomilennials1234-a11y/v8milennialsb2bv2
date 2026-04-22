/**
 * useWhatsAppMessagesRealtime — subscrição realtime em whatsapp_messages.
 * Extraído de src/hooks/useWhatsAppChat.ts (C12).
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import type { WhatsAppMessage } from "./types";

/**
 * Hook para subscrição em tempo real de mensagens.
 * Invalida/refetch de queries de contatos e mensagens ao receber eventos.
 */
export function useWhatsAppMessagesRealtime(phoneNumber: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!organizationId) return;

    // Nome único do canal baseado na org e telefone
    const channelName = `whatsapp-messages-${organizationId}${phoneNumber ? `-${phoneNumber}` : ""}`;

    const normalizePhone = (p: string) => {
      let c = p.replace(/\D/g, "");
      if (!c) return p;
      if (c.length >= 12 && c.startsWith("55")) c = c.slice(2);
      if (c.length === 10) c = c.slice(0, 2) + "9" + c.slice(2);
      return c;
    };

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whatsapp_messages",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          const message = (payload.new || payload.old) as WhatsAppMessage | undefined;
          const messagePhone = message?.phone_number;

          // Forçar refetch imediato da lista de contatos (sidebar e inbox)
          queryClient.refetchQueries({ queryKey: ["whatsapp_contacts", organizationId] });

          // Atualizar mensagens do chat aberto se o evento for do contato selecionado
          if (phoneNumber && messagePhone) {
            if (normalizePhone(messagePhone) === normalizePhone(phoneNumber)) {
              queryClient.refetchQueries({
                queryKey: ["whatsapp_messages", organizationId, phoneNumber],
              });
            }
          } else {
            queryClient.invalidateQueries({ queryKey: ["whatsapp_messages", organizationId] });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, phoneNumber, queryClient]);
}
