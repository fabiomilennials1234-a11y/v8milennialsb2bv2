/**
 * Prefetch dos DADOS de uma conversa do /chat-whatsapp.
 *
 * O chunk JS da rota é responsabilidade do registro de rotas
 * (`src/core/route-prefetch.ts`, hover no trilho). O `prefetchChatRoute` que
 * morava aqui fazia um `import()` próprio da página, nunca foi chamado por
 * ninguém e foi removido na régua de espera (CP-v2, 19/11).
 *
 * Multi-tenancy: `organizationId` é OBRIGATÓRIO. Sem ele, a chave do cache
 * não bate com a do hook real e o prefetch vira desperdício (ou pior, vaza
 * dados entre orgs ao rehidratar).
 */
import type { QueryClient } from "@tanstack/react-query";
import { chatQueryKeys } from "@/modules/communication/hooks/chat/shared/queryKeys";
import { buscarThread, THREAD_STALE_TIME_MS } from "@/modules/communication/lib/threadDaConversa";

export interface PrefetchChatDataParams {
  organizationId: string;
  /** Telefone EXATAMENTE como a tela o usará na chave da thread. */
  phoneNumber: string;
  /**
   * Sem instância não há prefetch: a chave da thread inclui a caixa, e uma
   * chave incompleta seria uma entrada que a tela nunca lê.
   */
  instanceId?: string | null;
}

/**
 * Popula o cache com a thread da conversa que o usuário está prestes a abrir.
 *
 * Mesma chave (`chatQueryKeys.messages`), mesma busca (`buscarThread`) e mesmo
 * staleTime de `useWhatsAppMessages`: ao abrir, a tela lê o cache e não refaz a
 * busca. Thread já fresca no cache = nenhuma rede.
 */
export async function prefetchChatData(
  queryClient: QueryClient,
  params: PrefetchChatDataParams,
): Promise<void> {
  const { organizationId, phoneNumber, instanceId } = params;
  if (!organizationId || !phoneNumber || !instanceId) return;

  await queryClient.prefetchQuery({
    queryKey: chatQueryKeys.messages(organizationId, phoneNumber, instanceId),
    queryFn: () => buscarThread(queryClient, organizationId, phoneNumber, instanceId),
    staleTime: THREAD_STALE_TIME_MS,
  });
}
