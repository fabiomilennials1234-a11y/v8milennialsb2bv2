/**
 * ChatBubbleThread — wrapper do MessageList canônico (zero divergência visual /chat).
 *
 * Composer + permission banner ficam no rodapé. Realtime patches já vêm via
 * provider singleton — Thread só consome os queryKeys correspondentes.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageList } from "@/components/chat/view/MessageList";
import { ImagePreviewModal } from "@/components/chat/media/ImagePreviewModal";
import { useWhatsAppMessages } from "@/hooks/chat/useWhatsAppMessages";
import { useFailedMessages, useRetryMessage } from "@/hooks/chat/useWhatsAppSend";
import { useCanReplyOnInstanceByName } from "@/hooks/useWhatsAppInstanceAllowedMembers";
import { ChatBubbleComposer } from "./ChatBubbleComposer";
import { ChatBubblePermissionBanner } from "./ChatBubblePermissionBanner";
import { normalizePhone } from "@/lib/normalizePhone";

interface ChatBubbleThreadProps {
  phoneNumber: string;
  instanceId: string;
  instanceName: string;
  contactName: string;
  onMarkAsRead: (phone: string, instanceId: string) => void;
}

export function ChatBubbleThread({
  phoneNumber,
  instanceId,
  instanceName,
  contactName,
  onMarkAsRead,
}: ChatBubbleThreadProps) {
  const messagesQuery = useWhatsAppMessages(phoneNumber, instanceId);
  const failedMessages = useFailedMessages(phoneNumber, instanceId);
  const retryMessage = useRetryMessage();
  const { canReply } = useCanReplyOnInstanceByName(instanceName);
  const queryClient = useQueryClient();

  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const mountTime = useMemo(() => Date.now(), []);

  // Marca como lida ao montar a thread (atualiza last_seen → zera unread no badge)
  useEffect(() => {
    if (phoneNumber && instanceId) {
      onMarkAsRead(phoneNumber, instanceId);
      // Zera unread_count no cache de contacts da instância (reflete imediato)
      const norm = normalizePhone(phoneNumber);
      const queryKey = ["whatsapp_contacts"]; // partial match invalida todas
      queryClient.setQueriesData(
        { queryKey },
        (
          prev: Array<{ phone_number: string; unread_count: number }> | undefined,
        ) => {
          if (!prev) return prev;
          return prev.map((c) =>
            normalizePhone(c.phone_number) === norm ? { ...c, unread_count: 0 } : c,
          );
        },
      );
    }
  }, [phoneNumber, instanceId, onMarkAsRead, queryClient]);

  const lastReadAt = Date.now(); // Bubble: sempre considera "lida" ao abrir

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <MessageList
        messages={messagesQuery.data ?? []}
        transferEvents={[]}
        failedMessages={failedMessages}
        isLoading={messagesQuery.isLoading}
        contactName={contactName}
        instanceName={instanceName}
        lastReadAt={lastReadAt}
        mountTime={mountTime}
        density="compact"
        instanceId={instanceId}
        enableActions={false}
        onImagePreview={(url) => setImagePreview(url)}
        onRetry={(failed) => retryMessage(failed)}
        onOpenTemplates={() => {
          /* templates fora de escopo no Bubble compact */
        }}
      />

      {canReply ? (
        <ChatBubbleComposer
          phoneNumber={phoneNumber}
          instanceId={instanceId}
          instanceName={instanceName}
          canReply
        />
      ) : (
        <ChatBubblePermissionBanner />
      )}

      <ImagePreviewModal
        imageUrl={imagePreview}
        isOpen={!!imagePreview}
        onClose={() => setImagePreview(null)}
      />

    </div>
  );
}
