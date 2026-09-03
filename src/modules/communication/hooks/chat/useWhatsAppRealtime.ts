/**
 * useWhatsAppMessagesRealtime — cache-patching layer for whatsapp_messages.
 *
 * Transport (channel lifecycle, circuit breaker, reconnect, visibility) is
 * fully delegated to useRealtimeChannel (#179/#180).
 *
 * This hook owns ONLY the business logic:
 *   - Patch messages cache (INSERT/UPDATE/DELETE)
 *   - Patch contacts sidebar (last_message, timestamp, unread) + REORDENAR
 *   - Dedup by message_id
 *
 * A reordenação não é detalhe: o patch da sidebar grava o `last_message_time`
 * novo no mesmo índice, e sem `sortContactsByRecency` a conversa que acabou de
 * receber mensagem não sobe — o "chat não atualiza" que o cliente relata.
 */
import { useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentTeamMember } from "@/modules/identity";
import { useRealtimeChannel } from "@/shared/realtime/useRealtimeChannel";
import type { WhatsAppMessage, ChatContact } from "./types";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { normalizePhone as canonicalNormalizePhone } from "@/lib/normalizePhone";
import { chatQueryKeys } from "./shared/queryKeys";
import { upsertRealtimeMessage } from "./shared/optimistic-messages";
import { sortContactsByRecency } from "@/modules/communication/lib/sortContactsByRecency";

const normalizePhone = (p: string): string => canonicalNormalizePhone(p) ?? "";

export function useWhatsAppMessagesRealtime(
  phoneNumber: string | null,
  instanceId: string | null,
) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;
  const queryClient = useQueryClient();

  const phoneNumberRef = useRef(phoneNumber);
  phoneNumberRef.current = phoneNumber;
  const instanceIdRef = useRef(instanceId);
  instanceIdRef.current = instanceId;

  const onEvent = useCallback(
    (payload: RealtimePostgresChangesPayload<WhatsAppMessage>) => {
      const { eventType } = payload;
      const message = (payload.new || payload.old) as WhatsAppMessage | undefined;
      if (!message) return;

      const messagePhone = message.phone_number ?? "";
      const currentPhone = phoneNumberRef.current;
      const currentInstanceId = instanceIdRef.current;

      // ── Patch messages do chat ativo ───────────────────────────────────────
      if (
        currentPhone &&
        normalizePhone(messagePhone) === normalizePhone(currentPhone)
      ) {
        const msgQueryKey = chatQueryKeys.messages(
          organizationId,
          currentPhone,
          currentInstanceId,
        );

        if (eventType === "INSERT") {
          // Dedupe por message_id + reconciliação da bolha otimista. Antes aqui
          // havia só o dedupe, e a bolha otimista (message_id sintético) nunca
          // casava com a linha real — que era anexada ao lado dela, deixando a
          // mesma mensagem duas vezes na tela até o refetch.
          queryClient.setQueryData<WhatsAppMessage[]>(msgQueryKey, (prev) =>
            upsertRealtimeMessage(prev ?? [], message),
          );
        } else if (eventType === "UPDATE") {
          queryClient.setQueryData<WhatsAppMessage[]>(msgQueryKey, (prev) => {
            if (!prev) return prev;
            return prev.map((m) => (m.id === message.id ? message : m));
          });
        } else if (eventType === "DELETE") {
          queryClient.setQueryData<WhatsAppMessage[]>(msgQueryKey, (prev) => {
            if (!prev) return prev;
            return prev.filter((m) => m.id !== message.id);
          });
        }
      }

      // ── Patch lista de contatos (sidebar) ─────────────────────────────────
      if (currentInstanceId) {
        // Prefixo: patcha todas as variantes filtradas da instância (issue #1277).
        const contactsQueryKey = chatQueryKeys.contactsPrefix(
          organizationId,
          currentInstanceId,
        );

        if (eventType === "INSERT" || eventType === "UPDATE") {
          queryClient.setQueriesData<ChatContact[]>({ queryKey: contactsQueryKey }, (prev) => {
            if (!prev) return prev;

            const normPhone = normalizePhone(messagePhone);
            const existingIdx = prev.findIndex(
              (c) => normalizePhone(c.phone_number) === normPhone,
            );

            if (existingIdx === -1) {
              queryClient.invalidateQueries({ queryKey: contactsQueryKey });
              return prev;
            }

            const patched = prev.map((contact, idx) => {
              if (idx !== existingIdx) return contact;

              const msgTime = new Date(message.timestamp).getTime();
              const existingTime = new Date(contact.last_message_time).getTime();

              if (msgTime <= existingTime) return contact;

              const isIncoming = message.direction === "incoming";
              const isCurrentConversation =
                phoneNumberRef.current &&
                normalizePhone(messagePhone) ===
                  normalizePhone(phoneNumberRef.current);

              return {
                ...contact,
                last_message: message.content ?? contact.last_message,
                last_message_time: message.timestamp,
                last_message_direction: message.direction as
                  | "incoming"
                  | "outgoing",
                unread_count:
                  isIncoming && !isCurrentConversation
                    ? contact.unread_count + 1
                    : contact.unread_count,
              };
            });

            // O patch acima grava o `last_message_time` novo NO MESMO ÍNDICE.
            // Sem reordenar, a conversa que acabou de receber mensagem fica
            // onde estava — e com a lista virtualizada (>50 conversas), fora da
            // janela visível, não muda um pixel. É o "chat não atualiza" do
            // cliente. A ordem tem que ser a mesma que a RPC devolve:
            // `ORDER BY p.last_message_time DESC`.
            return sortContactsByRecency(patched);
          });
        }
      }
    },
    [organizationId, queryClient],
  );

  useRealtimeChannel({
    table: "whatsapp_messages",
    filter: organizationId ? `organization_id=eq.${organizationId}` : undefined,
    onEvent,
    enabled: !!organizationId,
    statusKey: organizationId ? `whatsapp-messages-patched-${organizationId}` : undefined,
  });
}
