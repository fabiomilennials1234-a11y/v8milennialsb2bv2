/**
 * A busca da thread de uma conversa — a ÚNICA, compartilhada por
 * `useWhatsAppMessages` (a tela) e `prefetchChatData` (hover na lista).
 *
 * Mora em `lib/` e não no hook por dependência: `chatPrefetch.ts` é importado
 * por `lib/whatsapp.ts`, que meio produto usa (funil, ficha, disparo). Puxar o
 * hook dali arrastaria identity/realtime para todos eles e fecharia ciclos
 * estáticos entre módulos (dep-cruiser `no-circular`).
 */
import type { QueryClient } from "@tanstack/react-query";
import type { WhatsAppMessage } from "@/modules/communication/hooks/chat/types";
import { chatQueryKeys } from "@/modules/communication/hooks/chat/shared/queryKeys";
import { MESSAGE_PAGE_SIZE } from "@/modules/communication/lib/whatsappMessagesQuery";
import {
  mergeConcurrentMessages,
  mergeMessagePages,
  reconcileConversation,
  type ThreadSnapshot,
} from "@/modules/communication/lib/whatsappReconciliation";

/**
 * staleTime da thread. O prefetch precisa do MESMO valor: com um menor, a
 * conversa pré-carregada refaria a busca ao abrir — o prefetch viraria
 * desperdício.
 */
export const THREAD_STALE_TIME_MS = 30_000;

export function chavesAuxiliaresDaThread(key: ReturnType<typeof chatQueryKeys.messages>) {
  return {
    snapshotKey: ["whatsapp_thread_snapshot", ...key],
    pageKey: ["whatsapp_thread_pagination", ...key],
  };
}

/**
 * Prefetch com outra busca (a "chave legada") gravava no cache um formato que
 * a tela não produz, sem snapshot nem paginação.
 */
export async function buscarThread(
  queryClient: QueryClient,
  organizationId: string,
  phoneNumber: string,
  instanceId: string,
): Promise<WhatsAppMessage[]> {
  const key = chatQueryKeys.messages(organizationId, phoneNumber, instanceId);
  const { snapshotKey, pageKey } = chavesAuxiliaresDaThread(key);
  const params = { organizationId, instanceId, phoneNumber };
  const before = queryClient.getQueryData<WhatsAppMessage[]>(key);
  if (!before) {
    const initial = await reconcileConversation(params, []);
    const page = initial.messages;
    queryClient.setQueryData(snapshotKey, initial.snapshot);
    queryClient.setQueryData(pageKey, page.length === MESSAGE_PAGE_SIZE);
    const live = queryClient.getQueryData<WhatsAppMessage[]>(key) ?? [];
    return mergeMessagePages(page, live);
  }
  const result = await reconcileConversation(params, before, queryClient.getQueryData<ThreadSnapshot>(snapshotKey));
  queryClient.setQueryData(snapshotKey, result.snapshot);
  // Realtime can update the cache while the HTTP request is in flight.
  // Only those new patches supersede the snapshot; unchanged rows cannot
  // resurrect server deletions found by reconciliation.
  const live = queryClient.getQueryData<WhatsAppMessage[]>(key) ?? before;
  return mergeConcurrentMessages(before, result.messages, live);
}
