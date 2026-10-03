/**
 * A ESTRATÉGIA DE ENVIO da view social — o que a decisão Q2 do spec chama de
 * "enviador injetado por prop".
 *
 * ─── POR QUE UM OBJETO, E NÃO UM HOOK PASSADO ADIANTE ───────────────────────
 *
 * A tentativa anterior passou o próprio hook (`useSender?.(id)`) e o chamou dentro
 * do componente. Isso é chamada CONDICIONAL de hook: ao trocar de caixa a prop
 * vai de `undefined` a definida, a ordem dos hooks muda entre renders e o React
 * derruba a tela com "Rendered more hooks than during the previous render".
 * Nenhum gate do repo pega isso — só apareceria com o chat aberto, nas ~30 orgs.
 *
 * A forma correta: o shell chama OS DOIS hooks incondicionalmente e passa a
 * mutation JÁ PRONTA, embrulhada aqui numa interface que a view entende. Estas
 * funções são puras — recebem a mutation, devolvem o enviador.
 *
 * ─── POR QUE DUAS ROTAS ─────────────────────────────────────────────────────
 *
 * `notificame-send-social` RECUSA WhatsApp por modelo (`SOCIAIS =
 * {instagram, facebook}` ⇒ `channel_not_social`). O canal oficial envia pelo
 * caminho normal de WhatsApp — `whatsapp-api-proxy`, que resolve o provider a
 * partir da instância e passa por governor, janela e templates. Reusar a view
 * sem reusar o envio é o ponto inteiro da fatia.
 */
import type { SendSocialMessageInput } from "./useSendSocialMessage";
import type { NotificameWhatsAppSendInput } from "./useNotificameWhatsAppSend";

export interface SocialSender {
  isPending: boolean;
  send: (input: SendSocialMessageInput) => Promise<unknown>;
}

/** O formato mínimo de uma mutation do TanStack que nos interessa aqui. */
interface MutationLike<TInput> {
  isPending: boolean;
  mutateAsync: (input: TInput) => Promise<unknown>;
}

/** Instagram e Facebook: a rota social, que já recebe este mesmo input. */
export function directSender(
  m: MutationLike<SendSocialMessageInput>,
): SocialSender {
  return { isPending: m.isPending, send: (input) => m.mutateAsync(input) };
}

/**
 * Canal oficial: a rota de WhatsApp.
 *
 * ⚠️ O interlocutor muda de NOME entre os dois contratos —
 * `contactExternalId` na rota social, `to` na de WhatsApp. É o mesmo telefone, e
 * é justamente o tipo de renomeação que passa despercebida: os dois são `string`,
 * então trocá-los não é erro de tipo, é mensagem entregue a ninguém.
 */
export function officialWhatsAppSender(
  m: MutationLike<NotificameWhatsAppSendInput>,
): SocialSender {
  return {
    isPending: m.isPending,
    send: ({ contactExternalId, text, media, citandoProviderMessageId }) =>
      m.mutateAsync({ to: contactExternalId, text, media, citandoProviderMessageId }),
  };
}
