/**
 * MessagePrimitives — componentes de mensagem extraídos de WhatsAppChat.tsx (legacy).
 *
 * Exports:
 *   - MessagesAreaErrorBoundary — error boundary para a área de mensagens
 *   - formatMessageTime — formata timestamp para exibição no bubble
 *   - MessageStatusIcon — ícone de status (pending/sent/delivered/read/failed)
 *   - MessageBubble — bubble individual de mensagem
 */
import { useState, Component } from "react";
import { motion } from "framer-motion";
import {
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  Bot,
  Zap,
  RotateCw,
  Sticker,
  MapPin,
  Contact,
  BarChart3,
  FileText,
  LayoutList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { lerBolha, TIPOS_NORMALIZADOS } from "@/modules/communication/lib/inbound-metadata";
import { BolhaNormalizada } from "./bubbles/BolhaNormalizada";
import { format, isToday, isYesterday } from "date-fns";
import { AudioPlayer, getAudioPlaybackUrl } from "./media/AudioPlayer";
import { MessageImage, MessageVideo, MessageDocument, ExpiredMedia, resolveExpiredMediaKind } from "./media/MessageMedia";
import {
  MessageBubbleActions,
  MessageMetaBadges,
  DeletedPlaceholder,
  EditMessageInline,
} from "@/modules/communication/components/chat/actions";
import { useEditMessage, isFeatureUnavailable } from "@/modules/communication/hooks/useMessageActions";
import { toast } from "sonner";
import type { WhatsAppMessage, FailedMessage } from "@/modules/communication/hooks/useWhatsAppChat";

// ---------------------------------------------------------------------------
// MessagesAreaErrorBoundary
// ---------------------------------------------------------------------------

/** Error boundary só para a área de mensagens; evita "fewer hooks" ao não desmontar o ChatWindow */
export class MessagesAreaErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("[Chat] Error rendering messages:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[200px] text-center p-6 gap-2">
          <AlertCircle className="w-10 h-10 text-destructive" />
          <p className="text-sm text-muted-foreground">Erro ao carregar mensagens.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// formatMessageTime
// ---------------------------------------------------------------------------

export function formatMessageTime(timestamp: string): string {
  if (!timestamp) return "--:--";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--:--";
  if (isToday(date)) {
    return format(date, "HH:mm");
  }
  if (isYesterday(date)) {
    return "Ontem " + format(date, "HH:mm");
  }
  return format(date, "dd/MM HH:mm");
}

// ---------------------------------------------------------------------------
// MessageStatusIcon
// ---------------------------------------------------------------------------

export function MessageStatusIcon({ status, onInk = false }: { status: string; onInk?: boolean }) {
  // onInk → ícone está sobre o gradiente laranja (bubble manual outgoing): usa
  // tinta escura para legibilidade. Caso contrário, mantém os tons originais.
  const muted = onInk ? "text-[#1c1c1c]/45" : "text-muted-foreground/40";
  const readTone = onInk ? "text-[#1c1c1c]/70" : "text-blue-500/70";
  switch (status) {
    case "pending":
      return <Clock className={cn("w-2.5 h-2.5", muted)} />;
    case "sent":
      return <Check className={cn("w-2.5 h-2.5", muted)} />;
    case "delivered":
      return <CheckCheck className={cn("w-2.5 h-2.5", muted)} />;
    case "read":
      return <CheckCheck className={cn("w-2.5 h-2.5", readTone)} />;
    case "failed":
      return <AlertCircle className="w-3 h-3 text-destructive" title="Falha no envio" />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

export function MessageBubble({
  message,
  onImagePreview,
  isFirstInGroup = true,
  isLastInGroup = true,
  mountTime,
  onRetry,
  instanceId,
  enableActions = false,
}: {
  message: WhatsAppMessage | FailedMessage;
  onImagePreview: (url: string) => void;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  mountTime?: number;
  onRetry?: (message: FailedMessage) => void;
  /** When set + enableActions=true, reveals S1 action bar on hover */
  instanceId?: string;
  enableActions?: boolean;
}) {
  const isOutgoing = message.direction === "outgoing";
  const isFailed = message.status === "failed";
  const sentSource: "manual" | "copilot" | "workflow" =
    isOutgoing
      ? ((message as any).sent_source ?? (message.sent_by_ai ? "copilot" : "manual"))
      : "manual";
  const isWhatsAppMsg = "message_type" in message;
  const mediaUrl = isWhatsAppMsg ? (message as WhatsAppMessage).media_url : null;
  const messageType = isWhatsAppMsg ? (message as WhatsAppMessage).message_type : null;
  const isAudio = messageType === "audio" || messageType === "ptt";
  const isImage = messageType === "image" || messageType === "album" || messageType === "motion_photo";
  const isVideo = messageType === "video" || messageType === "ptv" || messageType === "gif" || messageType === "motion_video";
  const isDocument = messageType === "document";
  const isSticker = messageType === "sticker" || messageType === "1p_sticker" || messageType === "user_created_sticker" || messageType === "avatar_sticker";
  // Media purged by the 30-day retention job. media_url is NULL by now; show a
  // graceful "expired" state instead of the "[Mídia indisponível]" fallback.
  const isMediaExpired = isWhatsAppMsg && (message as WhatsAppMessage).media_expired === true;
  const isLocation = messageType === "location" || messageType === "LocationMessage" || messageType === "livelocation";
  const isContact = messageType === "contact" || messageType === "ContactMessage" || messageType === "ContactsArrayMessage" || messageType === "vcard" || messageType === "contact_array";
  const isReaction = messageType === "reaction" || messageType === "ReactionMessage";
  const isPoll = messageType === "poll";
  const isSystem = messageType === "system" || messageType === "PinInChatMessage";
  const isTemplate = messageType === "template";
  // A LEITURA NORMALIZADA, quando a linha tem uma.
  //
  // `metadata` só existe em `channel_messages` — o chat da Uazapi lê
  // `whatsapp_messages`, que não tem a coluna, e portanto NUNCA entra por aqui.
  // A guarda é estrutural, não um cuidado: não há como este caminho alcançar as
  // ~30 orgs que usam o outro eixo.
  const bolhaNormalizada = lerBolha({
    content: message.content ?? null,
    media_url: message.media_url ?? null,
    message_type: messageType,
    metadata: (message as { metadata?: unknown }).metadata ?? null,
  });
  // Só assume os quatro casos que o caminho antigo desenha errado ou não
  // desenha. Áudio, imagem, vídeo e documento seguem nos ramos de sempre.
  const usaBolhaNormalizada = TIPOS_NORMALIZADOS.has(bolhaNormalizada.tipo);

  const isInteractive = messageType === "interactive" || messageType === "collection" || messageType === "list" || isTemplate || messageType === "url";
  const hasMedia = isAudio || isImage || isVideo || isDocument || isSticker;

  const meta = message as unknown as {
    edited?: boolean | null;
    pinned_at?: string | null;
    deleted_at?: string | null;
    reactions?: unknown;
    remote_jid?: string | null;
  };
  const isDeleted = !!meta.deleted_at;
  const [isEditing, setIsEditing] = useState(false);
  const editMut = useEditMessage();

  const showActions =
    enableActions &&
    !!instanceId &&
    !!message.message_id &&
    !isDeleted;

  const phone = (meta.remote_jid ?? "").split("@")[0] ?? "";
  const canEdit = isOutgoing && !!message.content && !hasMedia;
  const canDelete = isOutgoing;

  const handleEditSave = async (newText: string) => {
    if (!instanceId || !message.message_id || !phone) return;
    try {
      await editMut.mutateAsync({
        instanceId,
        messageId: message.message_id,
        number: phone,
        text: newText,
      });
      setIsEditing(false);
      toast.success("Mensagem editada");
    } catch (e) {
      if (isFeatureUnavailable(e)) {
        toast.error("Disponível apenas em instâncias Uazapi");
      } else {
        toast.error(`Erro ao editar: ${(e as Error).message}`);
      }
    }
  };

  // Bubble color tokens — C9.
  // Manual/humano outgoing recebe o tratamento laranja da marca (gradient gold +
  // texto ink + sombra). Copilot/workflow preservam as cores semânticas (IA/automação).
  const isManualOutgoing = isOutgoing && sentSource === "manual";
  const bubbleColorClass =
    sentSource === "copilot"
      ? "bg-bubble-ai text-bubble-ai-foreground border border-bubble-ai-border/30 border-l-[3px] border-l-bubble-ai-border"
      : sentSource === "workflow"
        ? "bg-bubble-workflow text-bubble-workflow-foreground border border-bubble-workflow-border/30 border-l-[3px] border-l-bubble-workflow-border"
        : isManualOutgoing
          ? "gradient-gold text-primary-foreground border-0 shadow-[0_4px_12px_hsl(var(--primary)/0.25)]"
          : "bg-bubble-incoming text-bubble-incoming-foreground border border-bubble-incoming-border";

  const radiusClass = isOutgoing
    ? (isFirstInGroup && isLastInGroup
        ? "rounded-2xl rounded-br-sm"
        : isFirstInGroup
          ? "rounded-t-2xl rounded-bl-2xl rounded-br-md rounded-tr-2xl"
          : isLastInGroup
            ? "rounded-b-2xl rounded-bl-2xl rounded-br-sm rounded-tr-md"
            : "rounded-l-2xl rounded-r-md")
    : (isFirstInGroup && isLastInGroup
        ? "rounded-2xl rounded-bl-sm"
        : isFirstInGroup
          ? "rounded-t-2xl rounded-br-2xl rounded-bl-md"
          : isLastInGroup
            ? "rounded-b-2xl rounded-br-2xl rounded-bl-sm"
            : "rounded-r-2xl rounded-l-md");

  const shouldAnimate = mountTime !== undefined && new Date(message.timestamp).getTime() > mountTime;
  const prefersReduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animInitial = shouldAnimate && !prefersReduced ? { opacity: 0, y: 8 } : false as const;
  const animAnimate = shouldAnimate && !prefersReduced ? { opacity: 1, y: 0 } : false as const;

  return (
    <motion.div
      initial={animInitial}
      animate={animAnimate}
      transition={shouldAnimate && !prefersReduced ? { duration: 0.18, ease: "easeOut" } : undefined}
      className={cn(
        "flex gap-2 group min-w-0 w-full",
        isOutgoing ? "justify-end" : "justify-start",
        isFirstInGroup ? "mt-3" : "mt-0.5"
      )}
    >
      {/* Action bar — hover reveal, outgoing only appears on left; incoming on right */}
      {showActions && isOutgoing && !isEditing && (
        <div className="self-center shrink-0">
          <MessageBubbleActions
            instanceId={instanceId!}
            messageId={message.message_id!}
            number={phone}
            direction="outgoing"
            canEdit={canEdit}
            canDelete={canDelete}
            isPinned={!!meta.pinned_at}
            hasMedia={hasMedia}
            onRequestEdit={() => setIsEditing(true)}
          />
        </div>
      )}

      <div
        className={cn(
          "max-w-[75%] min-w-0 px-4 py-2.5 overflow-hidden",
          radiusClass,
          bubbleColorClass,
          isFailed && "border-destructive/40",
          !!meta.pinned_at && "ring-1 ring-primary/30"
        )}
      >
        {/* Sender label for AI messages — only on first in group */}
        {isFirstInGroup && sentSource !== "manual" && (
          <div className="flex items-center gap-1 mb-1">
            {sentSource === "workflow" ? (
              <>
                <Zap className="h-3 w-3 text-[#a78bfa]/60" />
                <span className="text-[10px] text-[#a78bfa]/70 font-medium">Automação</span>
              </>
            ) : (
              <>
                <Bot className="h-3 w-3 text-bubble-ai-foreground/60" />
                <span className="text-[10px] text-bubble-ai-foreground/70 font-medium">Copilot</span>
              </>
            )}
          </div>
        )}

        {isDeleted ? (
          <DeletedPlaceholder deletedAt={meta.deleted_at} />
        ) : isEditing ? (
          <EditMessageInline
            initialText={message.content ?? ""}
            onSave={handleEditSave}
            onCancel={() => setIsEditing(false)}
            isPending={editMut.isPending}
          />
        ) : (
          <>
{usaBolhaNormalizada ? (
              <BolhaNormalizada bolha={bolhaNormalizada} />
            ) : (
              <>
            {/* Texto / Legenda */}
            {message.content && (
              <p className={cn(
                "text-sm whitespace-pre-wrap break-words",
                hasMedia && "mt-2"
              )}>
                {message.content}
              </p>
            )}

            {/* Mídia expirada (retenção 30 dias) — estado gracioso por tipo */}
            {isMediaExpired && (
              <ExpiredMedia kind={resolveExpiredMediaKind(messageType)} />
            )}

            {/* Áudio */}
            {!isMediaExpired && isAudio && message.media_url && (
              <div>
                <AudioPlayer
                  src={getAudioPlaybackUrl(message.media_url) ?? message.media_url}
                  isOutgoing={isOutgoing}
                  instanceId={isWhatsAppMsg ? (message as WhatsAppMessage).instance_id : undefined}
                  whatsappMessageId={isWhatsAppMsg ? (message as WhatsAppMessage).message_id : undefined}
                />
              </div>
            )}

            {/* Imagem */}
            {isImage && message.media_url && (
              <MessageImage
                src={message.media_url}
                onPreview={() => onImagePreview(message.media_url!)}
              />
            )}

            {/* Vídeo */}
            {isVideo && message.media_url && (
              <MessageVideo src={message.media_url} />
            )}

            {/* Documento */}
            {isDocument && message.media_url && (
              <MessageDocument
                src={message.media_url}
                isOutgoing={isOutgoing}
              />
            )}

            {/* Sticker */}
            {!isMediaExpired && isSticker && (
              message.media_url && !["https://a.whatsapp.net", "https://web.whatsapp.net"].includes(message.media_url)
                ? <img
                    src={message.media_url}
                    alt="Sticker"
                    className="w-32 h-32 max-w-full object-contain rounded"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                : <span className="inline-block w-20 h-20 rounded bg-muted/40 text-3xl flex items-center justify-center" title="Figurinha">🏷️</span>
            )}

            {/* Location */}
            {isLocation && !message.content && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="w-4 h-4 shrink-0" />
                <span className="italic">Localização compartilhada</span>
              </div>
            )}

            {/* Contact card */}
            {isContact && !message.content && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Contact className="w-4 h-4 shrink-0" />
                <span className="italic">Contato compartilhado</span>
              </div>
            )}

            {/* Poll */}
            {isPoll && !message.content && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <BarChart3 className="w-4 h-4 shrink-0" />
                <span className="italic">Enquete</span>
              </div>
            )}

            {/* System message (pin, etc) */}
            {isSystem && !message.content && (
              <p className="text-xs italic text-muted-foreground/60 text-center">
                Mensagem do sistema
              </p>
            )}

            {/* TEMPLATE — mensagem aprovada pela Meta.
                O selo fica ACIMA do texto, e não no lugar dele: quem lê a
                conversa precisa ver o que o cliente recebeu, e saber que aquilo
                saiu por template é contexto (explica por que foi possível enviar
                fora da janela de 24h), não a informação principal. */}
            {isTemplate && (
              <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide opacity-70">
                <FileText className="h-3 w-3 shrink-0" />
                <span>Template</span>
              </div>
            )}

            {/* Template SEM texto: as linhas gravadas antes de o texto
                renderizado passar a viajar junto. Dizer "template" é honesto;
                "Mensagem interativa" não era nem isso. */}
            {isTemplate && !message.content && (
              <p className="text-sm italic text-muted-foreground">
                Template enviado
              </p>
            )}

            {/* Interactive / catalog / list */}
            {isInteractive && !isTemplate && !message.content && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LayoutList className="w-4 h-4 shrink-0" />
                <span className="italic">Mensagem interativa</span>
              </div>
            )}
              </>
            )}

            {/* O MOTIVO DA RECUSA, quando ele existe.
                "Tentar novamente" sozinho não diz o que consertar: a Meta recusa
                por formato de parâmetro, janela fechada, template inexistente —
                cada um pede uma ação diferente, e o texto dela é o que
                distingue. */}
            {isFailed && (message as { failure_reason?: string | null }).failure_reason && (
              <p className="mt-1 text-[11px] leading-snug text-destructive/90">
                {(message as { failure_reason?: string | null }).failure_reason}
                {/* O código fica, pequeno: é ele que encontra a mensagem nos
                    eventos do fornecedor quando alguém for investigar. */}
                {(message as { failure_code?: string | null }).failure_code && (
                  <span className="ml-1 opacity-60">
                    ({(message as { failure_code?: string | null }).failure_code})
                  </span>
                )}
              </p>
            )}

{!usaBolhaNormalizada && (
              <>
            {/* Media without media_url — empty bubble guard (expired handled above) */}
            {hasMedia && !mediaUrl && !message.content && !isMediaExpired && (
              <p className="text-sm italic text-muted-foreground">
                [Mídia indisponível]
              </p>
            )}

            {/* Unknown type with media_url — render based on URL extension */}
            {!hasMedia && !isLocation && !isContact && !isPoll && !isReaction && !isSystem && !isInteractive && mediaUrl && !message.content && (
              (() => {
                const ext = mediaUrl.split(".").pop()?.split("?")[0]?.toLowerCase();
                if (ext && ["jpg","jpeg","png","webp","gif"].includes(ext))
                  return <MessageImage src={mediaUrl} onPreview={() => onImagePreview(mediaUrl)} />;
                if (ext && ["mp4","webm","mov"].includes(ext))
                  return <MessageVideo src={mediaUrl} />;
                if (ext && ["mp3","ogg","opus","m4a","aac","wav","webm"].includes(ext))
                  return <AudioPlayer src={getAudioPlaybackUrl(mediaUrl) ?? mediaUrl} isOutgoing={isOutgoing} />;
                return <MessageDocument src={mediaUrl} isOutgoing={isOutgoing} />;
              })()
            )}

            {/* Truly unsupported — only for types we don't handle */}
            {!message.content && !hasMedia && !isLocation && !isContact && !isPoll && !isReaction && !isSystem && !isInteractive && !mediaUrl && (
              <p className="text-sm italic text-muted-foreground">
                [Mensagem não suportada]
              </p>
            )}
              </>
            )}

                        <MessageMetaBadges
              edited={meta.edited}
              pinnedAt={meta.pinned_at}
              deletedAt={meta.deleted_at}
              reactions={meta.reactions}
            />
          </>
        )}

        {/* Retry button for failed messages */}
        {isFailed && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(message as FailedMessage)}
            className="text-[11px] text-destructive hover:text-destructive/80 mt-1 font-medium flex items-center gap-1 focus-visible:outline-none focus-visible:underline"
          >
            <RotateCw className="w-3 h-3" />
            Tentar novamente
          </button>
        )}

        {/* Linha: data/hora e status — only on last in group */}
        {isLastInGroup && (
          <div className="flex items-center justify-end gap-1.5 mt-1.5">
            <time
              dateTime={message.timestamp}
              className={cn(
                "text-[10px] tabular-nums",
                isManualOutgoing ? "text-primary-foreground/60" : "text-muted-foreground/50",
              )}
            >
              {formatMessageTime(message.timestamp)}
            </time>
            {isOutgoing && <MessageStatusIcon status={message.status} onInk={isManualOutgoing} />}
          </div>
        )}
      </div>

      {/* Incoming action bar — right side */}
      {showActions && !isOutgoing && !isEditing && (
        <div className="self-center shrink-0">
          <MessageBubbleActions
            instanceId={instanceId!}
            messageId={message.message_id!}
            number={phone}
            direction="incoming"
            canEdit={false}
            canDelete={false}
            isPinned={!!meta.pinned_at}
            hasMedia={hasMedia}
            onRequestEdit={() => {}}
          />
        </div>
      )}
    </motion.div>
  );
}
