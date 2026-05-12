/**
 * useChatBubbleContactsRealtime — patch realtime de whatsapp_contacts cross-instâncias
 * (Chat Bubble Kanban / PR3).
 *
 * Por que existir:
 *   `useWhatsAppMessagesRealtime` (canônico do /chat) só patcheia contacts
 *   da `currentInstanceId` selecionada. No Bubble, queremos ver convs de TODAS
 *   instâncias permitidas (badge unread agrega cross-instâncias). Modificar o
 *   hook canônico aumentaria o risco de regressão em /chat. Solução: canal
 *   próprio, dedicado ao Bubble, que recebe os mesmos eventos da org e patcheia
 *   o queryKey de cada instância presente em `instanceIds`.
 *
 * Channel name: `chat-bubble-contacts-${organizationId}` (separado do /chat).
 *
 * Comportamento:
 *   - INSERT/UPDATE em whatsapp_messages cuja `instance_id` ∈ `instanceIds` →
 *     patcheia `chatQueryKeys.contacts(orgId, instance_id)` no cache:
 *       * Atualiza last_message + last_message_time + last_message_direction
 *       * Incrementa unread_count quando direction='incoming'
 *       * Se phone não existe no cache, invalida queryKey pra refetch
 *   - DELETE: ignorado (lógica fora de escopo PR3)
 *   - Mensagem cuja instance_id ∉ instanceIds: ignorada (segurança)
 *
 * Multi-tenant:
 *   Filtro postgres-side por `organization_id` garante que payload nunca chega
 *   de outra org. RLS de whatsapp_messages cobre defesa em profundidade.
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { normalizePhone as canonicalNormalizePhone } from "@/lib/normalizePhone";
import { chatQueryKeys } from "./shared/queryKeys";
import type { ChatContact, WhatsAppMessage } from "./types";

const normalizePhone = (p: string): string => canonicalNormalizePhone(p) ?? "";

export interface ChatBubbleRealtimeStatus {
  /** True quando channel está em CHANNEL_ERROR ou TIMED_OUT (rede/Supabase down). */
  isReconnecting: boolean;
}

export function useChatBubbleContactsRealtime(
  instanceIds: string[],
  /** Phone da conversa atualmente aberta — não incrementa unread quando recebe msg dessa conv. */
  activePhone: string | null,
): ChatBubbleRealtimeStatus {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;
  const queryClient = useQueryClient();
  const [isReconnecting, setIsReconnecting] = useState(false);

  // Refs estáveis pra acesso dentro do handler sem recriar a subscription.
  const instanceIdsRef = useRef(instanceIds);
  instanceIdsRef.current = instanceIds;
  const activePhoneRef = useRef(activePhone);
  activePhoneRef.current = activePhone;

  useEffect(() => {
    if (!organizationId || instanceIds.length === 0) return;

    const channelName = `chat-bubble-contacts-${organizationId}`;
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
        (payload: RealtimePostgresChangesPayload<WhatsAppMessage>) => {
          const { eventType } = payload;
          if (eventType === "DELETE") return;

          const message = (payload.new || payload.old) as WhatsAppMessage | undefined;
          if (!message) return;

          const msgInstanceId = message.instance_id;
          if (!msgInstanceId) return;

          const allowedIds = instanceIdsRef.current;
          if (!allowedIds.includes(msgInstanceId)) return;

          const messagePhone = message.phone_number ?? "";
          const normPhone = normalizePhone(messagePhone);
          const isIncoming = message.direction === "incoming";
          const currentActive = activePhoneRef.current;
          const isCurrentConversation =
            !!currentActive && normalizePhone(currentActive) === normPhone;

          const contactsQueryKey = chatQueryKeys.contacts(organizationId, msgInstanceId);

          queryClient.setQueryData<ChatContact[]>(contactsQueryKey, (prev) => {
            if (!prev) return prev;

            const existingIdx = prev.findIndex(
              (c) => normalizePhone(c.phone_number) === normPhone,
            );

            if (existingIdx === -1) {
              queryClient.invalidateQueries({ queryKey: contactsQueryKey });
              return prev;
            }

            return prev.map((contact, idx) => {
              if (idx !== existingIdx) return contact;

              const msgTime = new Date(message.timestamp).getTime();
              const existingTime = new Date(contact.last_message_time).getTime();
              if (msgTime <= existingTime) return contact;

              return {
                ...contact,
                last_message: message.content ?? contact.last_message,
                last_message_time: message.timestamp,
                last_message_direction: message.direction as "incoming" | "outgoing",
                unread_count:
                  isIncoming && !isCurrentConversation
                    ? contact.unread_count + 1
                    : contact.unread_count,
              };
            });
          });

          queryClient.invalidateQueries({
            queryKey: chatQueryKeys.unreadBadge(organizationId, msgInstanceId),
          });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setIsReconnecting(false);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setIsReconnecting(true);
          setTimeout(() => setIsReconnecting(false), 8000);
        }
      });

    return () => {
      setIsReconnecting(false);
      supabase.removeChannel(channel);
    };
    // organizationId muda raramente; instance count importa só pra short-circuit
    // (não reassina por mudança individual de instanceId — refs cobrem).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, queryClient, instanceIds.length]);

  return { isReconnecting };
}
