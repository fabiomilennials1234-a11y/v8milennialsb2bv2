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
import { chatQueryKeys, MULTI_KEY_PREFIX } from "./shared/queryKeys";
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
      //
      // A CAIXA entra na condição, e não só o telefone. Com duas caixas
      // marcadas, o mesmo número pode ter thread aberta numa e receber mensagem
      // na outra — comparar só o telefone anexaria a mensagem da caixa B na
      // thread da caixa A, e o vendedor leria como resposta dele algo que o
      // cliente mandou para outro número nosso.
      //
      // Mensagem sem `instance_id` (a coluna é nulável) continua caindo na
      // thread aberta, que é a suposição de sempre: recusá-la faria a tela parar
      // de receber mensagem em vez de recebê-la no lugar errado, e parar é pior.
      const mesmaCaixaDaThread =
        !message.instance_id ||
        !currentInstanceId ||
        message.instance_id === currentInstanceId;

      if (
        currentPhone &&
        mesmaCaixaDaThread &&
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
      //
      // A lista deixou de ser sempre "a de uma caixa": a caixa unificada guarda
      // o conjunto marcado em `multi:<ids>` na mesma raiz. Alcançar só a chave
      // da caixa aberta deixaria a lista real sem patch nenhum — e a tela
      // congelaria até o próximo refetch, para TODA organização, porque o /chat
      // usa a chave de conjunto mesmo com uma caixa só.
      //
      // Então o alvo é a RAIZ, e cada entrada de cache é avaliada pela caixa da
      // MENSAGEM: só entra a lista cujo conjunto contém aquela caixa. Sem esse
      // recorte, uma mensagem de outro número invalidaria listas que não a
      // mostram — refetch a cada mensagem, em toda org com mais de um número.
      // A caixa da mensagem, com queda para a caixa ABERTA.
      //
      // `whatsapp_messages.instance_id` é nulável, e um payload sem ela deixaria
      // a lista inteira sem patch — a conversa não subiria e a tela pareceria
      // congelada, que é exatamente o chamado "o chat não atualiza". Quando o
      // payload não diz de qual caixa veio, a caixa aberta é a única resposta
      // disponível, e é a mesma suposição que o patch fazia antes da caixa
      // unificada.
      const caixaDaMensagem = message.instance_id ?? instanceIdRef.current ?? null;
      if (caixaDaMensagem && (eventType === "INSERT" || eventType === "UPDATE")) {
        const raiz = ["whatsapp_contacts", organizationId ?? null] as const;
        const normPhone = normalizePhone(messagePhone);

        const contemACaixa = (key: readonly unknown[]): boolean => {
          const eixo = key[2];
          if (typeof eixo !== "string") return false;
          if (!eixo.startsWith(MULTI_KEY_PREFIX)) return eixo === caixaDaMensagem;
          return eixo
            .slice(MULTI_KEY_PREFIX.length)
            .split(",")
            .includes(caixaDaMensagem);
        };

        for (const query of queryClient.getQueryCache().findAll({ queryKey: raiz })) {
          if (!contemACaixa(query.queryKey)) continue;

          const prev = query.state.data as ChatContact[] | undefined;
          if (!prev) continue;

          // A linha é `(caixa, telefone)` desde a caixa unificada: casar só pelo
          // telefone acertaria a linha da caixa errada quando o mesmo contato
          // fala pelos dois números — 10 contatos na Chique, 21% na Alamaster.
          const existingIdx = prev.findIndex(
            (c) =>
              normalizePhone(c.phone_number) === normPhone &&
              (c.instance_id == null || c.instance_id === caixaDaMensagem),
          );

          if (existingIdx === -1) {
            queryClient.invalidateQueries({ queryKey: query.queryKey });
            continue;
          }

          queryClient.setQueryData<ChatContact[]>(query.queryKey, (atual) => {
            if (!atual) return atual;
            const patched = atual.map((contact, idx) => {
              if (idx !== existingIdx) return contact;

              const msgTime = new Date(message.timestamp).getTime();
              const existingTime = new Date(contact.last_message_time).getTime();

              if (msgTime <= existingTime) return contact;

              const isIncoming = message.direction === "incoming";
              // "Está aberta" agora inclui a CAIXA: a mesma conversa aberta na
              // outra caixa não pode zerar a não-lida desta.
              const isCurrentConversation =
                !!phoneNumberRef.current &&
                normalizePhone(messagePhone) === normalizePhone(phoneNumberRef.current) &&
                (instanceIdRef.current == null ||
                  instanceIdRef.current === caixaDaMensagem);

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
