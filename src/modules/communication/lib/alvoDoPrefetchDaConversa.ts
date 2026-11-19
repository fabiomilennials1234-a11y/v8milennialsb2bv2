/**
 * Alvo do prefetch de uma linha da lista de conversas.
 *
 * Arquivo próprio, fora de `chatPrefetch.ts`, por dependência: aquele é
 * importado por `lib/whatsapp.ts` (funil, ficha, disparo), e este precisa do
 * modelo da caixa unificada — puxá-lo de lá fecharia ciclos estáticos entre
 * módulos. Só o shell do /chat usa isto.
 */
import {
  contactKey,
  isWhatsAppContact,
  type InboxBox,
  type InboxContact,
} from "@/modules/communication/hooks/chat/types";
import { regimeDaConversaAberta } from "@/modules/communication/lib/regimeDaConversaAberta";
import type { PrefetchChatDataParams } from "@/modules/communication/lib/chatPrefetch";

/**
 * O que a tela vai ler se a pessoa clicar nesta linha — ou `null` se a linha
 * não abre uma thread de WhatsApp por QR (Instagram, canal oficial).
 *
 * Deriva pelo MESMO caminho do clique: `contactKey` → `regimeDaConversaAberta`
 * dá a caixa (`instanciaDeChip`), e o telefone é o `phone_number` da linha, que
 * é o que o `ChatView` passa para `useWhatsAppMessages`. Derivar de outro jeito
 * (a caixa "selecionada", o telefone normalizado) acertaria uma chave vizinha.
 */
export function alvoDoPrefetchDaConversa(
  contato: InboxContact,
  caixas: readonly InboxBox[],
  marcadas: readonly InboxBox[],
  organizationId: string | null | undefined,
): Required<PrefetchChatDataParams> | null {
  if (!organizationId || !isWhatsAppContact(contato)) return null;
  const { instanciaDeChip } = regimeDaConversaAberta({ chave: contactKey(contato), caixas, marcadas });
  if (!instanciaDeChip) return null;
  return { organizationId, phoneNumber: contato.phone_number, instanceId: instanciaDeChip };
}
