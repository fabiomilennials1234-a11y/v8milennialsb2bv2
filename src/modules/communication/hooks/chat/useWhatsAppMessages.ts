import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WhatsAppMessage } from './types';
import { useCurrentTeamMember } from '@/modules/identity';
import { fetchConversationMessages, isPersistedMessage, MESSAGE_PAGE_SIZE } from '@/modules/communication/lib/whatsappMessagesQuery';
import { compareMessages, mergeConcurrentMessages, mergeMessagePages, reconcileConversation, type ThreadSnapshot } from '@/modules/communication/lib/whatsappReconciliation';
import { chatQueryKeys } from './shared/queryKeys';
import { useWhatsAppRealtimeFallback, FALLBACK_POLL_INTERVAL_MS, JOINED_BACKSTOP_POLL_INTERVAL_MS } from './useRealtimeFallback';

export function useWhatsAppMessages(phoneNumber: string | null, instanceId: string | null) {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;
  const { shouldPoll } = useWhatsAppRealtimeFallback(organizationId);
  const key = chatQueryKeys.messages(organizationId, phoneNumber, instanceId);
  const snapshotKey = ['whatsapp_thread_snapshot', ...key];
  const pageKey = ['whatsapp_thread_pagination', ...key];
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      if (!organizationId || !phoneNumber || !instanceId) return [];
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
    },
    enabled: !!organizationId && !!phoneNumber && !!instanceId,
    refetchInterval: shouldPoll ? FALLBACK_POLL_INTERVAL_MS : JOINED_BACKSTOP_POLL_INTERVAL_MS,
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
