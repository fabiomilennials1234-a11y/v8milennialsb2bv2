/**
 * Responder pelo Direct.
 *
 * O envio inteiro mora no servidor (`notificame-send-social`): a credencial da
 * subconta nunca sai de lá, e o envelope do fornecedor é montado num lugar só —
 * o `NotificameProvider`, que também grava a linha em `channel_messages`. Aqui
 * não há regra de negócio nenhuma, e isso é de propósito: uma segunda montagem
 * de envelope no cliente divergiria da do servidor na primeira mudança da API.
 *
 * ⚠️ NÃO há bloqueio por janela de 24h. Ver `lib/social-window.ts`: a tela
 * INFORMA o tempo restante e deixa o operador decidir. Se o fornecedor recusar,
 * a mensagem dele sobe até o toast em vez de virar "erro ao enviar".
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";

import { chatQueryKeys } from "./shared/queryKeys";

export interface SendSocialMessageInput {
  /** IGSID do interlocutor — o `to` do envelope. */
  contactExternalId: string;
  text: string;
}

export class SocialSendError extends Error {
  readonly code: string;
  /** Texto cru do fornecedor, quando ele explica a recusa. */
  readonly detail: string | null;
  constructor(code: string, message: string, detail: string | null = null) {
    super(message);
    this.name = "SocialSendError";
    this.code = code;
    this.detail = detail;
  }
}

/** Desembrulha o corpo de erro de `functions.invoke` — sem isto todo erro vira "non-2xx". */
async function readInvokeError(error: unknown): Promise<SocialSendError> {
  const ctx = (error as { context?: unknown })?.context;
  if (ctx && typeof (ctx as Response).json === "function") {
    try {
      const body = await (ctx as Response).json();
      if (body && typeof body === "object") {
        const { code, error: msg, detail } = body as {
          code?: string;
          error?: string;
          detail?: string;
        };
        if (code || msg) {
          return new SocialSendError(
            code ?? "unknown",
            msg ?? "Não foi possível enviar",
            typeof detail === "string" ? detail : null,
          );
        }
      }
    } catch {
      // Corpo não-JSON: cai no genérico.
    }
  }
  return new SocialSendError(
    "unknown",
    error instanceof Error ? error.message : "Não foi possível enviar",
  );
}

export function useSendSocialMessage(messagingChannelId: string | null) {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;

  return useMutation({
    mutationFn: async ({ contactExternalId, text }: SendSocialMessageInput) => {
      if (!messagingChannelId) {
        throw new SocialSendError("no_channel", "Nenhum canal selecionado");
      }

      const { data, error } = await supabase.functions.invoke("notificame-send-social", {
        body: {
          messaging_channel_id: messagingChannelId,
          to: contactExternalId,
          text,
        },
      });

      if (error) throw await readInvokeError(error);
      return data as { message: { message_id: string; status: string } };
    },
    onSuccess: (_data, { contactExternalId }) => {
      // A thread e a lista mudam juntas: a mensagem enviada é também o novo
      // "última mensagem" da conversa. Invalidar só a thread deixaria a lista
      // mostrando a mensagem anterior como a mais recente.
      queryClient.invalidateQueries({
        queryKey: chatQueryKeys.socialMessages(
          organizationId,
          messagingChannelId,
          contactExternalId,
        ),
      });
      queryClient.invalidateQueries({
        queryKey: chatQueryKeys.socialContacts(organizationId, messagingChannelId),
      });
    },
  });
}
