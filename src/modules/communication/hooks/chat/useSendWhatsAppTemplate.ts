/**
 * Envio de TEMPLATE pela caixa de WhatsApp oficial.
 *
 * Irmão de `useNotificameWhatsAppSend`, mesma rota (`whatsapp-api-proxy`), outra
 * ação (`sendTemplate`) — e existe separado porque o CONTRATO é outro: template
 * não tem texto livre, tem nome, idioma e parâmetros posicionais.
 *
 * ─── QUANDO ISTO É A ÚNICA SAÍDA ────────────────────────────────────────────
 *
 * Passadas 24 horas da última mensagem do cliente, a Meta recusa texto livre.
 * Template aprovado é o único envelope que ela aceita — então a mensagem que
 * depende deste hook é justamente a que não pode ser mandada de outro jeito.
 *
 * Sem escrita otimista, como o irmão: a linha autoritativa é a que o provider
 * grava em `channel_messages`. O corpo renderizado é montado pela META a partir
 * do nome e dos parâmetros; inventar um texto aqui faria o histórico do chat
 * mentir sobre o que o cliente recebeu.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";

import { SOCIAL_CONTACTS_KEY_ROOT, SOCIAL_MESSAGES_KEY_ROOT } from "./shared/queryKeys";

export interface SendWhatsAppTemplateInput {
  /** Telefone do interlocutor — é ele que agrupa a conversa. */
  to: string;
  /** Nome canônico do template. É ele que a Meta referencia, não o id. */
  templateName: string;
  /** `pt_BR`, `en_US`… O template é aprovado POR IDIOMA. */
  language: string;
  /** Componentes no formato da Graph. Ver `lib/template-send.ts`. */
  components?: unknown[];
  /**
   * O texto renderizado — corpo aprovado com os parâmetros aplicados.
   *
   * Vai junto porque só o cliente tem as duas metades. Sem ele a linha nasce sem
   * texto e a conversa exibe "Mensagem interativa" no lugar da mensagem.
   */
  previewText?: string;
}

export class SendWhatsAppTemplateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SendWhatsAppTemplateError";
    this.code = code;
  }
}

export function useSendWhatsAppTemplate(instanceId: string | null) {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;

  return useMutation({
    mutationFn: async (input: SendWhatsAppTemplateInput) => {
      if (!instanceId) {
        throw new SendWhatsAppTemplateError("no_instance", "Nenhum canal selecionado");
      }
      if (!organizationId) {
        throw new SendWhatsAppTemplateError(
          "no_org",
          "Sua organização ainda está carregando",
        );
      }
      if (!input.templateName || !input.language) {
        throw new SendWhatsAppTemplateError(
          "template_incompleto",
          "Escolha um template aprovado antes de enviar",
        );
      }

      const { data, error } = await supabase.functions.invoke("whatsapp-api-proxy", {
        body: {
          action: "sendTemplate",
          instance_id: instanceId,
          organization_id: organizationId,
          payload: {
            number: input.to,
            templateName: input.templateName,
            language: input.language,
            ...(input.components?.length ? { components: input.components } : {}),
            ...(input.previewText?.trim() ? { previewText: input.previewText.trim() } : {}),
          },
        },
      });

      if (error) {
        throw new SendWhatsAppTemplateError(
          "send_failed",
          "Não foi possível enviar o template",
        );
      }
      return data as { result?: { message_id?: string; status?: string } };
    },

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
