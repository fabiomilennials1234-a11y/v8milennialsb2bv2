/**
 * Participantes de um grupo do WhatsApp (Uazapi) — fonte do seletor de menção
 * do composer e da derivação de `mentions` no envio.
 *
 * Chave sem org: o `instanceId` é UUID de uma única org e o proxy recusa a
 * instância de outra (403), então `(instância, grupo)` já é único por tenant.
 * O envio lê o MESMO cache (`readCachedMentionablePhones`) — retry incluso —
 * em vez de carregar estado do seletor junto da mensagem.
 */
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { groupParticipants } from "@/modules/communication/lib/whatsappApi";
import type { GroupParticipant } from "@/modules/communication/lib/groupMentionComposer";

export const GROUP_PARTICIPANTS_STALE_MS = 5 * 60_000;

export function groupParticipantsQueryKey(instanceId: string | null | undefined, groupJid: string | null | undefined) {
  return ["group-participants", instanceId ?? null, groupJid ?? null] as const;
}

export function useGroupParticipants(
  instanceId: string | null | undefined,
  groupJid: string | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: groupParticipantsQueryKey(instanceId, groupJid),
    queryFn: () => groupParticipants(instanceId as string, groupJid as string),
    enabled: enabled && !!instanceId && !!groupJid,
    staleTime: GROUP_PARTICIPANTS_STALE_MS,
    // 400/403 são definitivos; o seletor ainda oferece "Todos".
    retry: 1,
  });
}

/** Telefones mencionáveis do grupo, do cache (vazio se ainda não carregou). */
export function readCachedMentionablePhones(
  queryClient: QueryClient,
  instanceId: string | null | undefined,
  groupJid: string | null | undefined,
): string[] {
  if (!instanceId || !groupJid) return [];
  const list = queryClient.getQueryData<GroupParticipant[]>(groupParticipantsQueryKey(instanceId, groupJid));
  return (list ?? []).flatMap((p) => (p.phone ? [p.phone] : []));
}
