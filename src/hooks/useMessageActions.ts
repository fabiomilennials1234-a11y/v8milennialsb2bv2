/**
 * useMessageActions — hooks para 5 ações de mensagem Uazapi via whatsapp-api-proxy.
 *
 * Evolution instances retornam erro (provider does not support ...) — caller
 * deve traduzir em toast "Disponível apenas em instâncias Uazapi".
 *
 * Cada mutation invalida `["whatsapp_messages", organization_id]` pra refresh
 * do chat após sucesso.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  reactToMessage,
  editMessage,
  pinMessage,
  deleteMessage,
  markMessageRead,
  downloadMedia,
} from "@/lib/whatsappApi";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";

type ActionArgs = {
  instanceId: string;
  messageId: string;
  number: string;
};

type ReactArgs = ActionArgs & { emoji: string };
type EditArgs = ActionArgs & { text: string };

function useInvalidateMessages() {
  const qc = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const orgId = teamMember?.organization_id;
  return () => {
    if (orgId) qc.invalidateQueries({ queryKey: ["whatsapp_messages", orgId] });
    qc.invalidateQueries({ queryKey: ["whatsapp_messages"] });
  };
}

export function useReactMessage() {
  const invalidate = useInvalidateMessages();
  return useMutation({
    mutationFn: async ({ instanceId, messageId, number, emoji }: ReactArgs) => {
      await reactToMessage(instanceId, messageId, number, emoji);
    },
    onSuccess: invalidate,
  });
}

export function useEditMessage() {
  const invalidate = useInvalidateMessages();
  return useMutation({
    mutationFn: async ({ instanceId, messageId, number, text }: EditArgs) => {
      await editMessage(instanceId, messageId, number, text);
    },
    onSuccess: invalidate,
  });
}

export function usePinMessage() {
  const invalidate = useInvalidateMessages();
  return useMutation({
    mutationFn: async ({ instanceId, messageId, number }: ActionArgs) => {
      await pinMessage(instanceId, messageId, number);
    },
    onSuccess: invalidate,
  });
}

export function useDeleteMessage() {
  const invalidate = useInvalidateMessages();
  return useMutation({
    mutationFn: async ({ instanceId, messageId, number }: ActionArgs) => {
      await deleteMessage(instanceId, messageId, number);
    },
    onSuccess: invalidate,
  });
}

export function useMarkMessageRead() {
  const invalidate = useInvalidateMessages();
  return useMutation({
    mutationFn: async ({ instanceId, messageId, number }: ActionArgs) => {
      await markMessageRead(instanceId, messageId, number);
    },
    onSuccess: invalidate,
  });
}

export function useDownloadMedia() {
  return useMutation({
    mutationFn: async ({ instanceId, messageId }: { instanceId: string; messageId: string }) => {
      return downloadMedia(instanceId, messageId);
    },
  });
}

/**
 * Helper — verifica se error vem do adapter Evolution (NotSupported) para
 * surfaced como toast "Disponível apenas em instâncias Uazapi".
 */
export function isFeatureUnavailable(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes("does not support") ||
    msg.includes("NotSupportedError") ||
    msg.includes("only \"uazapi\" is supported")
  );
}
