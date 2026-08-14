/**
 * SocialChatView — coluna central do inbox quando a caixa aberta é social.
 *
 * POR QUE UM COMPONENTE PRÓPRIO, E NÃO UM RAMO DENTRO DE `ChatView`. O
 * `ChatHeader` de WhatsApp carrega TakeoverControls, VoiceCallButton,
 * SyncChatButton, limites de mensagem, toggle de Copilot e pausa humana —
 * praticamente tudo pressupõe telefone, instância uazapi e conversa em
 * `conversations`. Um Instagram sem telefone entraria ali desabilitando item por
 * item, e cada prop nova viraria uma chance de mexer no caminho quente de 30
 * orgs. Aqui o WhatsApp fica byte a byte como está e o Instagram ganha a
 * superfície que de fato tem.
 *
 * A LINHA DO TEMPO É A MESMA. `MessageList` recebe o shape de `WhatsAppMessage`;
 * as linhas de `channel_messages` são adaptadas para esse shape em vez de
 * ganharem um renderer paralelo — agrupamento por autor, separador de data,
 * divisor de não-lidas e virtualização são comportamento de CONVERSA, não de
 * WhatsApp, e duplicá-los criaria duas timelines para divergir.
 *
 * `enableActions` fica FALSO: reagir/editar/fixar/apagar são chamadas à Uazapi.
 *
 * O COMPOSER APARECE DESABILITADO, E NÃO ESCONDIDO. Esconder produz a leitura
 * "o Instagram não deixa responder"; o que é verdade é "ainda não construímos o
 * envio". A microcopy diz qual das duas.
 */
import { useMemo, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { ChannelBadge } from "@/modules/communication/components/chat/ChannelBadge";
import { MessageList } from "@/modules/communication/components/chat/view/MessageList";
import { ImagePreviewModal } from "@/modules/communication/components/chat/media/ImagePreviewModal";
import { getAvatarGradient } from "@/modules/communication/components/chat/list/avatarGradient";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSocialMessages } from "@/modules/communication/hooks/chat/useSocialMessages";
import type { WhatsAppMessage } from "@/modules/communication/hooks/chat/types";
import { contactLabel, type SocialContact } from "@/modules/communication/hooks/chat/types";
import type { DensityMode } from "@/modules/communication/hooks/chat/useChatDensity";
import type { SocialMessage } from "@/modules/communication/hooks/chat/useSocialMessages";

// ─── Adaptação para a timeline compartilhada ─────────────────────────────────

/**
 * `SocialMessage` → shape que `MessageList`/`MessageBubble` já sabem desenhar.
 *
 * Os campos que só existem no WhatsApp entram com o valor que os torna inertes,
 * nunca com um valor inventado: `phone_number` fica vazio porque não há
 * telefone, `sent_source` é `null` porque nesta fatia nada sai daqui, e
 * `message_id` reusa o `external_id` do fornecedor — que é o mesmo id que a
 * UNIQUE `(external_id, channel, organization_id)` usa como chave de
 * idempotência. Em momento nenhum um id é sintetizado a partir do relógio.
 */
function toTimelineMessage(m: SocialMessage, organizationId: string): WhatsAppMessage {
  return {
    id: m.id,
    organization_id: organizationId,
    instance_id: null,
    message_id: m.external_id,
    remote_jid: "",
    phone_number: "",
    direction: m.direction,
    message_type: m.message_type,
    content: m.content,
    media_url: m.media_url,
    push_name: m.sender_name,
    status: m.status ?? "received",
    lead_id: null,
    timestamp: m.timestamp,
    created_at: m.created_at ?? m.timestamp,
    sent_by_ai: false,
    sent_source: null,
  };
}

// ─── Header ──────────────────────────────────────────────────────────────────

function SocialChatHeader({
  contact,
  channelName,
  onBack,
  isMobile,
}: {
  contact: SocialContact;
  channelName: string;
  onBack: () => void;
  isMobile: boolean;
}) {
  const name = contactLabel(contact);
  const gradient = getAvatarGradient(contact.external_user_id || name);

  return (
    <header className="flex items-center gap-3 px-4 py-3 border-b border-border/60 bg-background shrink-0">
      {isMobile && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="-ml-2 h-8 px-2 shrink-0"
          aria-label="Voltar para a lista"
        >
          ←
        </Button>
      )}
      <div className="relative shrink-0">
        {contact.avatar_url ? (
          <img
            src={contact.avatar_url}
            alt=""
            className="w-10 h-10 rounded-full border-2 border-background shadow-sm object-cover"
          />
        ) : (
          <div
            className={cn(
              "w-10 h-10 rounded-full border-2 border-background shadow-sm flex items-center justify-center font-semibold text-sm select-none",
              gradient.ink ? "text-[#1c1c1c]" : "text-white",
            )}
            style={{ background: gradient.background }}
            aria-hidden
          >
            {(name.replace("@", "").charAt(0) || "?").toUpperCase()}
          </div>
        )}
        <ChannelBadge channel="instagram" size={16} overlay />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-display font-semibold truncate text-foreground">{name}</h3>
        <p className="text-sm text-muted-foreground truncate">
          Instagram Direct · {channelName}
        </p>
      </div>
    </header>
  );
}

// ─── Composer inerte ─────────────────────────────────────────────────────────

function ReadOnlyComposer() {
  return (
    <div className="shrink-0 border-t border-border/60 bg-background px-4 py-3">
      <div
        className="flex items-center gap-2.5 rounded-xl border border-dashed border-border/70 bg-muted/30 px-3.5 py-3 text-sm text-muted-foreground"
        role="note"
      >
        <Lock className="w-4 h-4 shrink-0 opacity-60" aria-hidden />
        <span>Responder pelo Instagram chega na próxima fatia.</span>
      </div>
    </div>
  );
}

// ─── Componente ──────────────────────────────────────────────────────────────

export interface SocialChatViewProps {
  selectedContact: SocialContact | null;
  /** Nome da caixa (conta) — vai para o subtítulo do header e para o empty state. */
  channelName: string;
  organizationId: string | null;
  mountTime: number;
  onBack: () => void;
  density: DensityMode;
  isMobile: boolean;
}

export function SocialChatView({
  selectedContact,
  channelName,
  organizationId,
  mountTime,
  onBack,
  density,
  isMobile,
}: SocialChatViewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const { data: rawMessages = [], isLoading } = useSocialMessages(
    selectedContact?.messaging_channel_id ?? null,
    selectedContact?.external_user_id ?? null,
  );

  const messages = useMemo(
    () => rawMessages.map((m) => toTimelineMessage(m, organizationId ?? "")),
    [rawMessages, organizationId],
  );

  if (!selectedContact) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 text-muted-foreground bg-muted/10">
        <ChannelBadge channel="instagram" size={40} className="opacity-40" />
        <p className="text-sm">Selecione uma conversa</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0">
      <SocialChatHeader
        contact={selectedContact}
        channelName={channelName}
        onBack={onBack}
        isMobile={isMobile}
      />

      <div className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <MessageList
            messages={messages}
            transferEvents={[]}
            failedMessages={[]}
            isLoading={isLoading}
            contactName={contactLabel(selectedContact)}
            instanceName={channelName}
            lastReadAt={0}
            mountTime={mountTime}
            onImagePreview={(url) => setPreviewUrl(url)}
            onRetry={() => {
              /* não há envio nesta fatia — nada para reenviar */
            }}
            onOpenTemplates={() => {
              /* templates de Instagram são fatia própria (janela de 24h) */
            }}
            density={density}
            enableActions={false}
          />
        )}
      </div>

      <ReadOnlyComposer />

      <ImagePreviewModal
        isOpen={!!previewUrl}
        imageUrl={previewUrl}
        onClose={() => setPreviewUrl(null)}
      />
    </div>
  );
}
