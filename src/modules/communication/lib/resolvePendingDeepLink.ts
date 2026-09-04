/**
 * `resolvePendingDeepLink` — decide o que fazer com o telefone pendente de um
 * deep-link de chat depois que a lista de contatos da caixa carrega.
 *
 * Duas coisas o chamador não conseguia distinguir sozinho:
 *
 * 1. **Contato ausente da lista** não significa conversa inexistente. O inbox
 *    deriva das 8000 mensagens mais recentes da instância, então uma conversa
 *    antiga fica de fora. Abrir pelo telefone é o certo — a thread carrega por
 *    telefone, não por contato.
 * 2. **Lista vazia** não significa "não achei": durante o load ela também está
 *    vazia. Cair no fallback cedo perderia o `phone_number` canônico do
 *    contato, que é a forma gravada em `whatsapp_messages`.
 */
import { normalizePhone } from "@/lib/normalizePhone";
import { buildWhatsAppConversationKey } from "@/modules/communication/hooks/chat/types";

export interface ResolvePendingDeepLinkArgs {
  /** Telefone que veio no deep-link, ainda não casado com um contato. */
  pendingPhone: string | null;
  /** Contatos já carregados para as caixas marcadas. */
  contacts: ReadonlyArray<{ phone_number: string; instance_id?: string | null }>;
  /** `true` enquanto a query de contatos ainda não respondeu. */
  contactsLoading: boolean;
  /**
   * A caixa que o deep-link abriu. Só é usada quando o telefone NÃO está na
   * lista: sem contato não há `instance_id` para compor a chave, e a caixa
   * aberta é a única resposta possível para "por qual número esta conversa
   * abre?".
   */
  caixaSelecionada?: string | null;
}

export type ResolvePendingDeepLinkResult =
  | { action: "wait" }
  | { action: "abort" }
  /** `contactKey` segue a identidade de conversa do ChatShell (`selectedKey`). */
  | { action: "select"; contactKey: string };

export function resolvePendingDeepLink({
  pendingPhone,
  contacts,
  contactsLoading,
  caixaSelecionada = null,
}: ResolvePendingDeepLinkArgs): ResolvePendingDeepLinkResult {
  if (contactsLoading) return { action: "wait" };

  const target = normalizePhone(pendingPhone);
  if (!target) return { action: "abort" };

  const match = contacts.find((c) => normalizePhone(c.phone_number) === target);
  // A chave da conversa é `(caixa, telefone)` desde a caixa unificada: devolver
  // o telefone sozinho selecionaria uma linha que não existe quando duas caixas
  // estão marcadas — e nenhuma quando o mesmo número fala pelas duas.
  return {
    action: "select",
    contactKey: buildWhatsAppConversationKey(
      match?.instance_id ?? caixaSelecionada,
      match?.phone_number ?? target,
    ),
  };
}
