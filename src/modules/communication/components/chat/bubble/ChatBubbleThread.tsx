/**
 * ChatBubbleThread — wrapper do MessageList canônico (zero divergência visual /chat).
 *
 * Composer + permission banner ficam no rodapé. Realtime patches já vêm via
 * provider singleton — Thread só consome os queryKeys correspondentes.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageList } from "@/modules/communication/components/chat/view/MessageList";
import { ImagePreviewModal } from "@/modules/communication/components/chat/media/ImagePreviewModal";
import { useWhatsAppMessages } from "@/modules/communication/hooks/chat/useWhatsAppMessages";
import { useAutoReadReceipt } from "@/modules/communication/hooks/chat/useAutoReadReceipt";
import { useFailedMessages, useRetryMessage } from "@/modules/communication/hooks/chat/useWhatsAppSend";
import { useConversationCalls } from "@/modules/communication/hooks/chat/useConversationCalls";
// TODO Etapa D: deprecate after rollout — substituído por useLeadWriteInstance
import { useCanReplyOnInstanceByName } from "@/modules/communication/hooks/useWhatsAppInstanceAllowedMembers";
import { ChatBubbleComposer } from "./ChatBubbleComposer";
import { ChatBubblePermissionBanner } from "./ChatBubblePermissionBanner";
import { normalizePhone } from "@/lib/normalizePhone";
import { zerarNaoLidas } from "@/modules/communication/hooks/chat/shared/cacheDeContatos";
import { useLeadByPhone } from "@/modules/communication/hooks/useWhatsAppLeadIntegration";
import { resolveEffectiveLead } from "@/modules/communication/lib/resolveEffectiveLead";
import { ChatComposerShell } from "@/modules/communication/components/chat/composer/ChatComposerShell";
import { InstanceOwnerModal } from "@/modules/communication/components/chat/admin/InstanceOwnerModal";
import { useLeadWriteInstance } from "@/modules/leads";

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

  // Tique azul também pela bolha: `onMarkAsRead` abaixo só zera o badge interno
  // do CRM. A guarda de grupo é por mensagem (is_group), então não depende de a
  // bolha saber o tipo da conversa.
  useAutoReadReceipt({
    instanceId,
    phone: phoneNumber,
    messages: messagesQuery.data,
  });
  const retryMessage = useRetryMessage();
  const { canReply } = useCanReplyOnInstanceByName(instanceName);
  const queryClient = useQueryClient();
  const { data: lead } = useLeadByPhone(phoneNumber);
  const leadId = lead?.id ?? null;
  const { state: writeInstanceState } = useLeadWriteInstance(leadId);
  // Mesma linha do tempo da tela cheia — a bolha não conta outra história.
  //
  // O lead passa pelo MESMO resolvedor que o `ChatShellWithContext` usa. Antes
  // cada tela resolvia do seu jeito, e as duas produziam `queryKey` diferente
  // para a mesma conversa: duas entradas de cache e duas requisições para a
  // mesma resposta. A bolha não tem `ChatContact`, então entra com `null` — o
  // resolvedor cai no lead por telefone, que é exatamente o que ela tem.
  const { leadId: effectiveLeadId } = resolveEffectiveLead(null, lead);
  const { data: calls = [] } = useConversationCalls(phoneNumber, effectiveLeadId);
  const [isLinkInstanceOpen, setIsLinkInstanceOpen] = useState(false);

  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const mountTime = useMemo(() => Date.now(), []);

  // Marca como lida ao montar a thread (atualiza last_seen → zera unread no badge)
  useEffect(() => {
    if (phoneNumber && instanceId) {
      onMarkAsRead(phoneNumber, instanceId);
      // Zera unread_count no cache de contacts da instância (reflete imediato).
      //
      // ⚠️ A raiz casa por PREFIXO e guarda DUAS formas: o array da lista de uma
      // caixa e o envelope `{ contatos, cheia }` da lista por conjunto — que é a
      // que esta bolha renderiza desde a SCRUM-668. Chamar `.map` no valor cru
      // derrubava a tela inteira ao abrir a thread (`.map is not a function` no
      // ErrorBoundary, 04/09). Ver `shared/cacheDeContatos.ts`.
      const norm = normalizePhone(phoneNumber);
      zerarNaoLidas(
        queryClient,
        ["whatsapp_contacts"], // partial match alcança todas as variantes
        (c) => normalizePhone(c.phone_number) === norm,
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
        calls={calls}
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

      {leadId ? (
        <ChatComposerShell
          leadId={leadId}
          variant="compact"
          onLinkInstance={() => setIsLinkInstanceOpen(true)}
          innerComposer={
            canReply ? (
              <ChatBubbleComposer
                phoneNumber={phoneNumber}
                instanceId={instanceId}
                instanceName={instanceName}
                canReply
                leadId={leadId}
              />
            ) : (
              <ChatBubblePermissionBanner />
            )
          }
        />
      ) : canReply ? (
        <ChatBubbleComposer
          phoneNumber={phoneNumber}
          instanceId={instanceId}
          instanceName={instanceName}
          canReply
        />
      ) : (
        <ChatBubblePermissionBanner />
      )}

      {leadId && writeInstanceState.status === "error" && writeInstanceState.responsibleUserId && (
        <InstanceOwnerModal
          open={isLinkInstanceOpen}
          onOpenChange={setIsLinkInstanceOpen}
          targetTeamMemberId={writeInstanceState.responsibleUserId}
          targetTeamMemberName={writeInstanceState.responsibleName ?? null}
        />
      )}

      <ImagePreviewModal
        imageUrl={imagePreview}
        isOpen={!!imagePreview}
        onClose={() => setImagePreview(null)}
      />

    </div>
  );
}
