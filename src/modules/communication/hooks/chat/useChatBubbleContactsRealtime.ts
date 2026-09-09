/**
 * useChatBubbleContactsRealtime — patch realtime de whatsapp_contacts cross-instancias
 * (Chat Bubble Kanban / PR3).
 *
 * Delegated transport: uses useRealtimeChannel which provides circuit breaker +
 * exponential backoff + visibility/online reconnect for free. This hook only
 * contains business logic for patching the contacts cache.
 *
 * Channel listens to: whatsapp_messages WHERE organization_id = orgId
 *
 * Behavior:
 *   - INSERT/UPDATE whose instance_id is in instanceIds ->
 *     patches chatQueryKeys.bubbleContacts(orgId, instance_id):
 *       * Updates last_message + last_message_time + last_message_direction
 *       * Increments unread_count when direction='incoming' and not active conv
 *       * If phone not in cache, invalidates queryKey for refetch
 *   - DELETE: ignored
 *   - Message whose instance_id not in instanceIds: ignored (security)
 */
import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { useRealtimeChannel } from "@/shared/realtime/useRealtimeChannel";
import { useCurrentTeamMember } from "@/modules/identity";
import { normalizePhone as canonicalNormalizePhone } from "@/lib/normalizePhone";
import { chatQueryKeys } from "./shared/queryKeys";
import type { ChatContact, WhatsAppMessage } from "./types";

const normalizePhone = (p: string): string => canonicalNormalizePhone(p) ?? "";

export interface ChatBubbleRealtimeStatus {
  /** True quando channel esta em CHANNEL_ERROR ou TIMED_OUT (rede/Supabase down). */
  isReconnecting: boolean;
}

export function useChatBubbleContactsRealtime(
  instanceIds: string[],
  /** Phone da conversa atualmente aberta — nao incrementa unread quando recebe msg dessa conv. */
  activePhone: string | null,
): ChatBubbleRealtimeStatus {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;
  const queryClient = useQueryClient();

  // Refs for stable closure access without re-subscribing
  const instanceIdsRef = useRef(instanceIds);
  instanceIdsRef.current = instanceIds;
  const activePhoneRef = useRef(activePhone);
  activePhoneRef.current = activePhone;

  const onEvent = useCallback(
    (payload: RealtimePostgresChangesPayload<any>) => {
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

      // A chave da BOLHA, que desde a W4 tem raiz própria. Antes ela era a mesma
      // da lista do `/chat`, e o patcher escrevia nas duas — o que só não
      // quebrava porque as duas guardavam `ChatContact`. Com origens de dado
      // diferentes, a colisão vira lista misturada e o sintoma aparece longe da
      // causa.
      const contactsQueryKey = chatQueryKeys.bubbleContacts(organizationId, msgInstanceId);

      queryClient.setQueriesData<ChatContact[]>({ queryKey: contactsQueryKey }, (prev) => {
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
    [organizationId, queryClient],
  );

  const { state } = useRealtimeChannel({
    table: "whatsapp_messages",
    filter: organizationId ? `organization_id=eq.${organizationId}` : undefined,
    onEvent,
    enabled: !!organizationId && instanceIds.length > 0,
  });

  const isReconnecting = state === "errored" || state === "polling";

  return { isReconnecting };
}
