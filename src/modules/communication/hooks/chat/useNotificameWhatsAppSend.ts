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

import { isVoiceNoteMime } from "@/modules/communication/lib/social-attachment";

import { SOCIAL_CONTACTS_KEY_ROOT, SOCIAL_MESSAGES_KEY_ROOT } from "./shared/queryKeys";

/**
 * Mídia do canal oficial.
 *
 * ⚠️ `url` PÚBLICA, nunca base64: o provider recusa arquivo embutido com
 * `NotSupportedError` ("o canal oficial exige URL pública"). O composer já
 * publica no bucket antes de enviar, então a URL é o que ele tem em mãos.
 */
export interface NotificameWhatsAppMedia {
  /**
   * `sticker` só existe no canal oficial, e só em WebP — é o formato exclusivo
   * de figurinha do WhatsApp.
   */
  type: "image" | "video" | "document" | "audio" | "sticker";
  url: string;
  filename?: string;
  caption?: string;
  /**
   * O MIME real do arquivo. Só o áudio o usa, e para uma decisão só: nota de voz
   * (`sendAudio` → `ptt` → `voice: true`) exige ogg/opus. Marcar `voice` sobre
   * m4a fez a Meta recusar com 131053 em produção.
   */
  mime?: string;
}

export interface NotificameWhatsAppSendInput {
  /**
   * O id ESTÁVEL da mensagem citada. Vai como `replyid` — o nome que o contrato
   * já usa no eixo da Uazapi —, e o provider o põe na RAIZ do envelope, que é
   * onde o fornecedor espera a citação.
   */
  citandoProviderMessageId?: string | null;
  /** Telefone do interlocutor — é ele que agrupa a conversa. */
  to: string;
  text?: string;
  media?: NotificameWhatsAppMedia;
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
    mutationFn: async ({ to, text, media, citandoProviderMessageId }: NotificameWhatsAppSendInput) => {
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
      const texto = text?.trim() ?? "";
      if (!texto && !media) {
        throw new NotificameWhatsAppSendError(
          "empty_message",
          "Escreva a mensagem ou anexe um arquivo",
        );
      }

      // ─── A AÇÃO ────────────────────────────────────────────────────────────
      //
      // Áudio vai por `sendAudio` e NÃO por `sendMedia({type:'audio'})`: é a
      // ação que o proxy traduz para `type: 'ptt'`, a mensagem de voz. Com
      // `sendMedia(audio)` o cliente recebe um anexo de arquivo — outro objeto,
      // sem o balão de voz e sem a forma de onda.
      // ─── NOTA DE VOZ vs ÁUDIO COMUM ───────────────────────────────────────
      //
      // `sendAudio` vira `type: 'ptt'` no proxy e `voice: true` no provider — e a
      // Cloud API documenta que `voice` EXIGE .ogg/OPUS ("Voice messages require
      // .ogg files encoded with the OPUS codec"). Um m4a marcado como voz é o que
      // produziu, em prod, o 131053 "Media upload error".
      //
      // Quando o navegador não deu ogg/opus, o arquivo vai como ÁUDIO COMUM. O
      // destinatário recebe um anexo de áudio em vez de um balão de voz — que é a
      // degradação honesta, e infinitamente melhor que a mensagem sumir.
      const ehNotaDeVoz = media?.type === "audio" && isVoiceNoteMime(media.mime);

      const body = !media
        ? {
          action: "sendText",
          payload: {
            number: to,
            text: texto,
            // Citação só quando há alvo: `reply: true` sem `messageId` é um
            // corpo que a Meta recusa.
            ...(citandoProviderMessageId ? { replyid: citandoProviderMessageId } : {}),
          },
        }
        : ehNotaDeVoz
          ? {
            action: "sendAudio",
            payload: { number: to, file: media.url },
          }
          : {
            action: "sendMedia",
            payload: {
              number: to,
              type: media.type,
              file: media.url,
              ...(media.filename ? { filename: media.filename } : {}),
              // A legenda é o texto do composer quando há anexo: é assim que o
              // envio pelo Direct já se comporta, e duas regras diferentes fariam
              // a mesma tela mandar coisas distintas conforme a caixa.
              ...(media.caption ?? texto ? { caption: media.caption ?? texto } : {}),
            },
          };

      const { data, error } = await supabase.functions.invoke("whatsapp-api-proxy", {
        body: {
          ...body,
          instance_id: instanceId,
          organization_id: organizationId,
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
