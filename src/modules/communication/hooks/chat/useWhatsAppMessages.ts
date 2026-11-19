import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WhatsAppMessage } from './types';
import { useCurrentTeamMember } from '@/modules/identity';
import { fetchConversationMessages, isPersistedMessage, MESSAGE_PAGE_SIZE } from '@/modules/communication/lib/whatsappMessagesQuery';
import { compareMessages, mergeConcurrentMessages, mergeMessagePages } from '@/modules/communication/lib/whatsappReconciliation';
import { chatQueryKeys } from './shared/queryKeys';
import { buscarThread, chavesAuxiliaresDaThread, THREAD_STALE_TIME_MS } from '@/modules/communication/lib/threadDaConversa';
import { useReconcileInterval } from './useRealtimeFallback';

export function useWhatsAppMessages(phoneNumber: string | null, instanceId: string | null) {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;
  const refetchInterval = useReconcileInterval('thread', organizationId);
  const key = chatQueryKeys.messages(organizationId, phoneNumber, instanceId);
  const { pageKey } = chavesAuxiliaresDaThread(key);
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      if (!organizationId || !phoneNumber || !instanceId) return [];
      return buscarThread(queryClient, organizationId, phoneNumber, instanceId);
    },
    enabled: !!organizationId && !!phoneNumber && !!instanceId,
    // Rede final contra evento realtime perdido: 120 s saudável, degraus de
    // 30→60→120 s em fallback (reconcilePolicy.ts). A latência baixa vem de
    // reconexão e foco (chatReconcile.ts), não do polling.
    refetchInterval,
    // Volta de foco reconcilia; staleTime 30 s impede que trocar de aba dez
    // vezes vire dez RPCs. Cada refetch é 1 `whatsapp_thread_manifest`, com
    // atalho `unchanged` por fingerprint.
    staleTime: THREAD_STALE_TIME_MS,
    refetchOnWindowFocus: true,
  });
  const older = useMutation({
    mutationFn: async () => {
      if (!organizationId || !phoneNumber || !instanceId) throw new Error('Conversa indisponível');
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      const current = queryClient.getQueryData<WhatsAppMessage[]>(key) ?? [];
      const first = current.filter(isPersistedMessage).sort(compareMessages)[0];
      const page = await fetchConversationMessages({ organizationId, instanceId, phoneNumber,
        ...(first ? { before: { timestamp: first.timestamp, id: first.id } } : {}) });
      queryClient.setQueryData(pageKey, page.length === MESSAGE_PAGE_SIZE);
      queryClient.setQueryData<WhatsAppMessage[]>(key, rows => mergeConcurrentMessages(current, mergeMessagePages(current, page), rows ?? current));
    },
  });
  return { ...query,
    hasOlderMessages: queryClient.getQueryData<boolean>(pageKey) ?? (query.data?.length ?? 0) >= MESSAGE_PAGE_SIZE,
    loadOlderMessages: older.mutateAsync,
    isLoadingOlder: older.isPending,
    olderError: older.error,
  };
}
