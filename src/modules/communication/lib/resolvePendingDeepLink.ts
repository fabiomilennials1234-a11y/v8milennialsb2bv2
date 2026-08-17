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

export interface ResolvePendingDeepLinkArgs {
  /** Telefone que veio no deep-link, ainda não casado com um contato. */
  pendingPhone: string | null;
  /** Contatos já carregados para a caixa selecionada. */
  contacts: ReadonlyArray<{ phone_number: string }>;
  /** `true` enquanto a query de contatos ainda não respondeu. */
  contactsLoading: boolean;
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
}: ResolvePendingDeepLinkArgs): ResolvePendingDeepLinkResult {
  if (contactsLoading) return { action: "wait" };

  const target = normalizePhone(pendingPhone);
  if (!target) return { action: "abort" };

  const match = contacts.find((c) => normalizePhone(c.phone_number) === target);
  return { action: "select", contactKey: match?.phone_number ?? target };
}
