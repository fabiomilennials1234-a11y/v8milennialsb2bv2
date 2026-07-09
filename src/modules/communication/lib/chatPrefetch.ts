/**
 * Prefetch helpers para a rota /chat-whatsapp.
 *
 * Objetivo: reduzir o tempo entre clicar no botão WhatsApp do card Kanban
 * (e outras superfícies) e a primeira pintura útil do chat. Duas camadas:
 *
 * 1. `prefetchChatRoute()` — dispara o `import()` dinâmico do chunk JS da
 *    página `ChatWhatsApp`. Deve ser chamado em `onMouseEnter`/`onFocus`.
 *
 * 2. `prefetchChatData(queryClient, { organizationId, phoneNumber, instanceId })`
 *    — usa `queryClient.prefetchQuery` com **as mesmas chaves canônicas**
 *    da `chatQueryKeys` (de `src/hooks/chat/shared/queryKeys.ts`) para que
 *    o hook `useWhatsAppMessages` consuma o cache em vez de refazer fetch.
 *
 * Multi-tenancy: `organizationId` é OBRIGATÓRIO. Sem ele, a chave do cache
 * não bate com a do hook real e o prefetch vira desperdício (ou pior, vaza
 * dados entre orgs ao rehidratar). Em call-sites onde só temos o `phone`,
 * o caller deve resolver o `organizationId` via `useOrganization()` antes
 * de chamar este helper.
 */
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chatQueryKeys } from "@/modules/communication/hooks/chat/shared/queryKeys";
import type { WhatsAppMessage } from "@/modules/communication/hooks/chat/types";

let chatChunkPromise: Promise<unknown> | null = null;

/**
 * Dispara o dynamic import do chunk da rota /chat-whatsapp.
 * Idempotente: chamadas repetidas reusam a mesma Promise.
 */
export function prefetchChatRoute(): Promise<unknown> {
  if (!chatChunkPromise) {
    chatChunkPromise = import("@/modules/communication/pages/ChatWhatsApp").catch((err) => {
      // Se falhar, deixa próxima chamada tentar de novo
      chatChunkPromise = null;
      throw err;
    });
  }
  return chatChunkPromise;
}

export interface PrefetchChatDataParams {
  organizationId: string;
  /** Telefone já normalizado (formato do hook: 55 + DDD + número). */
  phoneNumber: string;
  /**
   * `instanceId` é opcional aqui. Se não souber, o prefetch ainda popula
   * a lista de contatos; a query de mensagens é populada depois que a
   * página resolve qual instância usar.
   */
  instanceId?: string | null;
}

/**
 * Popula o cache do TanStack Query com a query de mensagens da conversa
 * que o usuário está prestes a abrir.
 *
 * Usa exatamente a mesma chave/queryFn que `useWhatsAppMessages` —
 * qualquer divergência leva a refetch duplicado e desperdício de prefetch.
 */
export async function prefetchChatData(
  queryClient: QueryClient,
  params: PrefetchChatDataParams,
): Promise<void> {
  const { organizationId, phoneNumber, instanceId } = params;
  if (!organizationId || !phoneNumber) return;

  // Só faz sentido prefetch de mensagens quando conhecemos a instância —
  // a chave inclui instanceId e seria diferente da que a página usa.
  if (!instanceId) return;

  await queryClient.prefetchQuery({
    queryKey: chatQueryKeys.messages(organizationId, phoneNumber, instanceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select(
          "id, organization_id, instance_id, message_id, remote_jid, phone_number, direction, message_type, content, media_url, media_expired, push_name, status, lead_id, timestamp, created_at, sent_by_ai, sent_source",
        )
        .eq("organization_id", organizationId)
        .eq("instance_id", instanceId)
        .eq("phone_number", phoneNumber)
        .order("timestamp", { ascending: true });

      if (error) throw error;
      return data as WhatsAppMessage[];
    },
    // mesmo staleTime padrão do QueryClient (5min) basta pra ser reaproveitado
  });
}
