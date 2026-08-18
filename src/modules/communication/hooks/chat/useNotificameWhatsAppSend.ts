/**
 * Enviar pela caixa do WhatsApp oficial (NotificaMe).
 *
 * ─── POR QUE UM HOOK PRÓPRIO, E NÃO `useWhatsAppSend` ───────────────────────
 *
 * Aquele faz um upsert OTIMISTA em `whatsapp_messages` logo após invocar o proxy.
 * O canal oficial grava a entrada em `channel_messages`, e o `NotificameProvider`
 * grava a SAÍDA na mesma tabela — herdar o upsert partiria a conversa em duas
 * fontes, com a pergunta do cliente de um lado e a resposta do outro.
 *
 * Aqui a ÚNICA escrita é a do servidor. O feedback imediato vem de invalidar as
 * chaves no `onSuccess`, com o id real que o provider devolveu; inventar linha no
 * cliente recriaria a segunda verdade que esta fatia inteira existe para evitar.
 *
 * ─── A ROTA É A MESMA DO WHATSAPP COMUM ─────────────────────────────────────
 *
 * `whatsapp-api-proxy` com `action: "sendText"`. É ela que resolve o provider a
 * partir da instância e que passa por governor, janela e templates — e ela atende
 * o canal oficial desde o PR #1640. NÃO usar `notificame-send-social`: aquela
 * rota recusa WhatsApp por modelo (`channel_not_social`), porque foi desenhada
 * para os canais que moram em `messaging_channels`.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";

import { SOCIAL_CONTACTS_KEY_ROOT, SOCIAL_MESSAGES_KEY_ROOT } from "./shared/queryKeys";

export interface NotificameWhatsAppSendInput {
  /** Telefone do interlocutor — é ele que agrupa a conversa. */
  to: string;
  text: string;
}

export class NotificameWhatsAppSendError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "NotificameWhatsAppSendError";
    this.code = code;
  }
}

export function useNotificameWhatsAppSend(instanceId: string | null) {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;

  return useMutation({
    mutationFn: async ({ to, text }: NotificameWhatsAppSendInput) => {
      if (!instanceId) {
        throw new NotificameWhatsAppSendError("no_instance", "Nenhum canal selecionado");
      }
      // A org é exigida ANTES da chamada, e não deixada para o servidor recusar:
      // o proxy é org-scoped e devolveria um erro genérico que o vendedor não
      // saberia interpretar. Mesma lição do envio pelo Direct (PR #1626).
      if (!organizationId) {
        throw new NotificameWhatsAppSendError(
          "no_org",
          "Sua organização ainda está carregando",
        );
      }
      if (!text.trim()) {
        throw new NotificameWhatsAppSendError("empty_message", "Escreva a mensagem");
      }

      const { data, error } = await supabase.functions.invoke("whatsapp-api-proxy", {
        body: {
          action: "sendText",
          instance_id: instanceId,
          organization_id: organizationId,
          payload: { number: to, text: text.trim() },
        },
      });

      if (error) {
        throw new NotificameWhatsAppSendError("send_failed", "Não foi possível enviar");
      }
      return data as { result?: { message_id?: string; status?: string } };
    },

    // Sem escrita otimista: a linha autoritativa é a que o provider grava em
    // `channel_messages`. Invalidar é o que a traz — e a thread e a lista mudam
    // juntas, porque a mensagem enviada também é o novo "última mensagem".
    onSuccess: (_data, { to }) => {
      queryClient.invalidateQueries({
        queryKey: [SOCIAL_MESSAGES_KEY_ROOT, organizationId, instanceId, to],
      });
      queryClient.invalidateQueries({
        queryKey: [SOCIAL_CONTACTS_KEY_ROOT, organizationId, instanceId],
      });
    },
  });
}
