import { useState, useRef, useEffect, useCallback, Component } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  MessageSquare,
  Send,
  Check,
  CheckCheck,
  Clock,
  Loader2,
  AlertCircle,
  Image as ImageIcon,
  Mic,
  X,
  Bot,
  Settings,
  RotateCw,
  Sticker,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useCopilotToggle } from "@/hooks/useCopilotToggle";
import {
  useWhatsAppContacts,
  useWhatsAppMessages,
  useSendWhatsAppMessage,
  useSendWhatsAppMedia,
  useWhatsAppMessagesRealtime,
  useWhatsAppInstancesForUser,
  useTransferToSzChatDepartment,
  useActiveSzChatSession,
  useFailedMessages,
  useRetryMessage,
  type WhatsAppInstanceForUser,
  ChatContact,
  WhatsAppMessage,
  type FailedMessage,
} from "@/hooks/useWhatsAppChat";
import { convertAudioBlobToMp3, preloadLamejs } from "@/lib/audioToMp3";
import { useCanReplyOnInstanceByName } from "@/hooks/useWhatsAppInstanceAllowedMembers";
import { useLeadByPhone, useCreateLeadFromWhatsApp } from "@/hooks/useWhatsAppLeadIntegration";
import {
  useArchiveConversation,
  useUnarchiveConversation,
  useDeleteConversation,
  useAddConversationTag,
  useRemoveConversationTag,
  useWhatsAppConversationTags,
  useWhatsAppConversationsMeta,
} from "@/hooks/useWhatsAppConversations";
import { useTags } from "@/hooks/useTags";
import {
  MessageBubbleActions,
  MessageMetaBadges,
  DeletedPlaceholder,
  EditMessageInline,
} from "@/components/chat/actions";
import { useEditMessage, isFeatureUnavailable } from "@/hooks/useMessageActions";
import { ChatComposerShell } from "@/components/chat/composer/ChatComposerShell";
import { InstanceOwnerModal } from "@/components/chat/admin/InstanceOwnerModal";
import { useLeadWriteInstance } from "@/hooks/useLeadWriteInstance";
import { toast } from "sonner";
import { useIsAdmin } from "@/hooks/useUserRole";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
// ChannelBadge movido para view/ChatHeader.tsx (C6).
import { LeadDetailContent } from "./LeadDetailContent";
import { ScheduleMessageModal } from "./ScheduleMessageModal";
import { SlashCommandPopover } from "@/components/chat/SlashCommandPopover";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { resolveVariables } from "@/lib/template-variables";
import type { LeadContext, AttendantContext } from "@/lib/template-variables";
import type { MessageTemplate } from "@/hooks/useMessageTemplates";
import { useConversationDraft } from "@/hooks/useConversationDraft";
import { useAuth } from "@/contexts/AuthContext";
// ChatEmptyState, UnreadDivider, ScrollToBottomFab usados em view/MessageList.tsx (C7).
import { ScheduledMessagesBanner } from "./ScheduledMessagesBanner";
import ConversationNotes from "@/components/chat/ConversationNotes";
import { WhatsAppSettings } from "@/components/settings/WhatsAppSettings";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
// AlertDialog extraído para list/ConversationListItem.tsx (C5).
// DropdownMenu para SZ.chat transfer movido para view/ChatHeader.tsx (C6).
// Select extraído para list/ConversationList.tsx (C5).
import { format, isToday, isYesterday } from "date-fns";
// ptBR movido para view/MessageList.tsx (C7).
import { AudioPlayer, getAudioPlaybackUrl } from "./media/AudioPlayer";
import { AudioRecorder as AudioRecorderMedia } from "./media/AudioRecorder";
import { ImagePreviewModal as ImagePreviewModalMedia } from "./media/ImagePreviewModal";
import { MessageImage, MessageVideo, MessageDocument } from "./media/MessageMedia";
import { ConversationList } from "./list/ConversationList";
import { contactDisplayName } from "./list/ConversationListItem";
import { ChatHeader } from "./view/ChatHeader";
import type { SzChatSession } from "./view/ChatHeader";
import { MessageList } from "./view/MessageList";
import type { TransferEvent } from "./view/MessageList";

/**
 * Re-export para backwards-compat — movido para media/AudioPlayer.tsx (C2).
 * Consumidores externos devem migrar para @/components/chat (barrel).
 */
export { getAudioPlaybackUrl } from "./media/AudioPlayer";

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

// formatContactTime extraído para list/ConversationListItem.tsx (C5).

export function MessageStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return <Clock className="w-2.5 h-2.5 text-muted-foreground/40" />;
    case "sent":
      return <Check className="w-2.5 h-2.5 text-muted-foreground/40" />;
    case "delivered":
      return <CheckCheck className="w-2.5 h-2.5 text-muted-foreground/40" />;
    case "read":
      return <CheckCheck className="w-2.5 h-2.5 text-blue-500/70" />;
    case "failed":
      return <AlertCircle className="w-3 h-3 text-destructive" title="Falha no envio" />;
    default:
      return null;
  }
}

// contactDisplayName extraído para list/ConversationListItem.tsx (C5), importado acima.
// ContactList extraído para list/ConversationList.tsx (C5).

// Alias local para garantir uso interno sem quebrar referências na ChatWindow
const ContactList = ConversationList;

// ContactList e ContactContextMenu extraídos para list/ (C5).
// ContactList importado como ConversationList, alias ContactList criado acima.

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
  message: WhatsAppMessage | import("@/hooks/useWhatsAppChat").FailedMessage;
  onImagePreview: (url: string) => void;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  mountTime?: number;
  onRetry?: (message: import("@/hooks/useWhatsAppChat").FailedMessage) => void;
  /** When set + enableActions=true, reveals S1 action bar on hover */
  instanceId?: string;
  enableActions?: boolean;
}) {
  const isOutgoing = message.direction === "outgoing";
  const isFailed = message.status === "failed";
  const isAi = isOutgoing && !!message.sent_by_ai;
  const isWhatsAppMsg = "message_type" in message;
  const mediaUrl = isWhatsAppMsg ? (message as WhatsAppMessage).media_url : null;
  const messageType = isWhatsAppMsg ? (message as WhatsAppMessage).message_type : null;
  const isAudio = messageType === "audio" || messageType === "ptt";
  const isImage = messageType === "image";
  const isVideo = messageType === "video";
  const isDocument = messageType === "document";
  const isSticker = messageType === "sticker";
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

  // Bubble color tokens — C9
  const bubbleColorClass = isAi
    ? "bg-bubble-ai text-bubble-ai-foreground border border-bubble-ai-border/30 border-l-[3px] border-l-bubble-ai-border"
    : isOutgoing
      ? "bg-bubble-outgoing text-bubble-outgoing-foreground border border-bubble-outgoing-border"
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
        {isFirstInGroup && isAi && (
          <div className="flex items-center gap-1 mb-1">
            <Bot className="h-3 w-3 text-bubble-ai-foreground/60" />
            <span className="text-[10px] text-bubble-ai-foreground/70 font-medium">Copilot</span>
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
            {/* Texto / Legenda */}
            {message.content && (
              <p className={cn(
                "text-sm whitespace-pre-wrap break-words",
                hasMedia && "mt-2"
              )}>
                {message.content}
              </p>
            )}

            {/* Áudio */}
            {isAudio && message.media_url && (
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
            {isSticker && (
              message.media_url && !["https://a.whatsapp.net", "https://web.whatsapp.net"].includes(message.media_url)
                ? <img
                    src={message.media_url}
                    alt="Sticker"
                    className="w-32 h-32 max-w-full object-contain rounded"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                : <span className="inline-block w-20 h-20 rounded bg-muted/40 text-3xl flex items-center justify-center" title="Figurinha">🏷️</span>
            )}

            {/* Mensagem sem conteúdo e sem mídia */}
            {!message.content && !hasMedia && (
              <p className="text-sm italic text-muted-foreground">
                [Mensagem não suportada]
              </p>
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
            onClick={() => onRetry(message as import("@/hooks/useWhatsAppChat").FailedMessage)}
            className="text-[11px] text-destructive hover:text-destructive/80 mt-1 font-medium flex items-center gap-1 focus-visible:outline-none focus-visible:underline"
          >
            <RotateCw className="w-3 h-3" />
            Tentar novamente
          </button>
        )}

        {/* Linha: data/hora e status — only on last in group */}
        {isLastInGroup && (
          <div className="flex items-center justify-end gap-1.5 mt-1.5">
            <time dateTime={message.timestamp} className="text-[10px] text-muted-foreground/50 tabular-nums">{formatMessageTime(message.timestamp)}</time>
            {isOutgoing && <MessageStatusIcon status={message.status} />}
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

// Componente de gravação de áudio
// AudioRecorder e ImagePreviewModal extraídos para media/ (C3).
// Re-exportados via barrel src/components/chat/index.ts.
// Aliases locais para uso interno neste arquivo.
const AudioRecorder = AudioRecorderMedia;
const ImagePreviewModal = ImagePreviewModalMedia;

function ChatWindow({
  phoneNumber,
  onBack,
  instanceName,
  instanceId,
  onOpenLeadModal,
  hasLead,
  leadId,
  leadAiDisabled,
  selectedContact,
  selectedLeadName,
}: {
  phoneNumber: string;
  onBack: () => void;
  instanceName: string;
  instanceId: string;
  onOpenLeadModal: () => void;
  hasLead: boolean;
  leadId?: string;
  leadAiDisabled?: boolean;
  selectedContact: ChatContact | undefined;
  selectedLeadName?: string | null;
}) {
  const conversationKey = `${instanceId}:${phoneNumber}`;
  const { user } = useAuth();
  const { draft: newMessage, setDraft: setNewMessage } = useConversationDraft(conversationKey, user?.id);
  const [showSlashPopover, setShowSlashPopover] = useState(false);
  const { data: templates } = useMessageTemplates();

  // Lead data for template variable resolution
  const { data: leadForTemplates } = useQuery({
    queryKey: ["lead-for-templates", leadId],
    queryFn: async () => {
      if (!leadId) return null;
      const { data } = await supabase
        .from("leads")
        .select("name, company, email, phone, source, interest, segment, campaign_name")
        .eq("id", leadId)
        .maybeSingle();
      return data;
    },
    enabled: !!leadId,
    staleTime: 1000 * 60 * 5,
  });
  const [isRecording, setIsRecording] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imageCaption, setImageCaption] = useState("");
  const [sendAsSticker, setSendAsSticker] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  // Onda 2 U4 (2026-04-26): hook único — phone+leadId, query key unificada,
  // realtime via MainLayout, optimistic, rota master automática.
  const copilotToggle = useCopilotToggle({ phone: phoneNumber, leadId });
  const currentAiDisabled = copilotToggle.aiDisabled;
  const toggleAIPending = copilotToggle.isPending;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mountTimeRef = useRef<number>(Date.now());

  // Snapshot last-seen timestamp for unread divider (read before the conversation marks as seen)
  const lastReadAtRef = useRef<number>(0);
  useEffect(() => {
    try {
      let cleaned = phoneNumber.replace(/\D/g, "");
      if (cleaned.length >= 12 && cleaned.startsWith("55")) cleaned = cleaned.slice(2);
      if (cleaned.length === 10) cleaned = cleaned.slice(0, 2) + "9" + cleaned.slice(2);
      const stored = localStorage.getItem("whatsapp_last_seen_" + cleaned);
      lastReadAtRef.current = stored ? new Date(stored).getTime() : 0;
    } catch {
      lastReadAtRef.current = 0;
    }
  }, [phoneNumber]);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Pré-carregar lamejs para conversão WebM→MP3 na gravação (evita enviar áudio em formato que Safari não reproduz)
  useEffect(() => {
    preloadLamejs();
  }, []);

  const { data: messages = [], isLoading } = useWhatsAppMessages(phoneNumber, instanceId);

  // Fetch conversation state for transfer badge
  const { data: conversationState } = useQuery({
    queryKey: ['conversation-state', leadId],
    queryFn: async () => {
      if (!leadId) return null;
      const { data } = await supabase
        .from('conversations')
        .select('state')
        .eq('lead_id', leadId)
        .maybeSingle();
      return data?.state ?? null;
    },
    enabled: !!leadId,
  });

  const isWaitingHuman = conversationState === 'WAITING_HUMAN';

  // Fetch transfer events for inline timeline cards
  const { data: transferEvents = [] } = useQuery({
    queryKey: ['transfer-events', leadId],
    queryFn: async () => {
      if (!leadId) return [];
      const { data } = await supabase
        .from('lead_history')
        .select('id, metadata, created_at')
        .eq('lead_id', leadId)
        .eq('action', 'ai_toggled')
        .not('metadata', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10);
      return (data ?? [])
        .filter((e: any) => (e.metadata as Record<string, unknown>)?.reason)
        .map((e: any) => ({
          id: e.id,
          type: 'transfer_event' as const,
          reason: ((e.metadata as Record<string, unknown>)?.reason as string) || '',
          timestamp: e.created_at,
        }));
    },
    enabled: !!leadId,
  });

  const sendMessage = useSendWhatsAppMessage();
  const sendMedia = useSendWhatsAppMedia();
  // TODO Etapa D: deprecate after rollout — substituído por useLeadWriteInstance
  const { canReply: canReplyOnThisNumber } = useCanReplyOnInstanceByName(instanceName);
  const { state: writeInstanceState } = useLeadWriteInstance(leadId ?? null);
  const [isLinkInstanceOpen, setIsLinkInstanceOpen] = useState(false);
  const failedMessages = useFailedMessages(phoneNumber, instanceId);
  const retryMessage = useRetryMessage();

  // SZ.chat transfer-back: check if this contact has an active SZ.chat session
  const { data: teamMemberCW } = useCurrentTeamMember();
  const organizationIdCW = teamMemberCW?.organization_id ?? null;
  const { data: szChatSession } = useActiveSzChatSession(phoneNumber, organizationIdCW);
  const transferToSzChat = useTransferToSzChatDepartment();

  // Ativar realtime
  useWhatsAppMessagesRealtime(phoneNumber, instanceId);

  const handleSend = async () => {
    if (!newMessage.trim() || !instanceName) return;

    try {
      await sendMessage.mutateAsync({
        phoneNumber,
        message: newMessage.trim(),
        instanceName,
        instanceId,
        leadId,
      });
      setNewMessage("");
    } catch (error: any) {
      toast.error(error.message || "Erro ao enviar mensagem");
    }
  };

  const handleSlashSelect = (template: MessageTemplate) => {
    const leadCtx: LeadContext = {
      name: leadForTemplates?.name ?? selectedContact?.lead_name ?? selectedContact?.push_name ?? undefined,
      company: leadForTemplates?.company ?? undefined,
      email: leadForTemplates?.email ?? undefined,
      phone: leadForTemplates?.phone ?? phoneNumber ?? undefined,
      source: leadForTemplates?.source ?? undefined,
      interest: leadForTemplates?.interest ?? undefined,
      segment: leadForTemplates?.segment ?? undefined,
      campaign_name: leadForTemplates?.campaign_name ?? undefined,
    };
    const attendantCtx: AttendantContext = { name: teamMemberCW?.name ?? undefined };
    const resolved = resolveVariables(template.body, leadCtx, attendantCtx);
    setNewMessage(resolved);
    setShowSlashPopover(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSlashPopover) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Enviar imagem
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        toast.error("Selecione apenas imagens");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error("Imagem muito grande (máximo 10MB)");
        return;
      }
      setSelectedImage(file);
      const reader = new FileReader();
      reader.onload = (e) => setImagePreview(e.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSendImage = async () => {
    if (!selectedImage || !instanceName) return;

    try {
      // Converter arquivo para base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(selectedImage);
      });

      console.log("[Image] Sending image:", {
        fileName: selectedImage.name,
        fileType: selectedImage.type,
        fileSize: selectedImage.size,
        base64Length: base64.length,
      });

      await sendMedia.mutateAsync({
        phoneNumber,
        instanceName,
        instanceId,
        mediaType: sendAsSticker ? "sticker" : "image",
        media: base64,
        caption: sendAsSticker ? undefined : (imageCaption || undefined),
        fileName: selectedImage.name,
        mimetype: selectedImage.type,
        leadId,
      });

      setSelectedImage(null);
      setImagePreview(null);
      setImageCaption("");
      setSendAsSticker(false);
      toast.success("Imagem enviada!");
    } catch (error: any) {
      console.error("[Image] Error sending:", error);
      toast.error(error.message || "Erro ao enviar imagem");
    }
  };

  // Enviar áudio: só envia em MP3 para reprodução em todos os navegadores (Safari não reproduz WebM/OGG)
  const handleAudioRecorded = async (audioBlob: Blob) => {
    setIsRecording(false);

    try {
      const blobToSend = await convertAudioBlobToMp3(audioBlob);
      const isMp3 = (blobToSend.type || "").toLowerCase().includes("mpeg") || (blobToSend.type || "").toLowerCase().includes("mp3");
      if (!isMp3 || blobToSend.size === 0) {
        toast.error("Não foi possível converter o áudio para MP3. Tente gravar novamente.");
        return;
      }

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blobToSend);
      });

      await sendMedia.mutateAsync({
        phoneNumber,
        instanceName,
        instanceId,
        mediaType: "audio",
        media: base64,
        mimetype: "audio/mpeg",
        leadId,
      });

      toast.success("Áudio enviado!");
    } catch (error: any) {
      console.error("[Audio] Error sending:", error);
      toast.error(error.message || "Erro ao enviar áudio");
    }
  };

  // Nome do contato: prioriza push_name (nome real do WhatsApp) — consistente com contactDisplayName na lista lateral
  const contactNameRaw =
    selectedContact?.push_name ??
    messages.find((m) => m.push_name)?.push_name ??
    selectedLeadName ??
    selectedContact?.lead_name ??
    phoneNumber;
  const contactName = (contactNameRaw && String(contactNameRaw).trim()) ? String(contactNameRaw).trim() : (phoneNumber || "?");

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header — extraído para view/ChatHeader.tsx (C6) */}
      <ChatHeader
        phoneNumber={phoneNumber}
        contactName={contactName}
        hasLead={hasLead}
        leadId={leadId}
        instanceId={instanceId}
        aiDisabled={currentAiDisabled}
        isWaitingHuman={isWaitingHuman}
        szChatSession={szChatSession as SzChatSession | null}
        organizationId={organizationIdCW}
        onBack={onBack}
        onOpenLeadModal={onOpenLeadModal}
        onToggleAi={(checked) => {
          copilotToggle.toggle(!checked);
          // Toast de sucesso é mostrado pelo realtime; erro vem via copilotToggle.error
          if (copilotToggle.error) {
            const msg = copilotToggle.error instanceof Error ? copilotToggle.error.message : "Erro desconhecido";
            toast.error(`Erro ao alterar Copilot: ${msg}`);
          } else {
            toast.success(checked ? "IA ativada" : "IA desativada");
          }
        }}
        onTransferToSzChatTeam={(teamName, teamId) => {
          if (!organizationIdCW || !szChatSession) return;
          transferToSzChat.mutate(
            {
              organizationId: organizationIdCW,
              sessionId: szChatSession.sz_chat_session_id,
              targetTeamName: teamName,
              targetTeamId: teamId,
            },
            {
              onSuccess: () => toast.success(`Conversa transferida para ${teamName}`),
              onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao transferir conversa"),
            }
          );
        }}
        toggleAiPending={toggleAIPending}
        transferPending={transferToSzChat.isPending}
      />

      {/* Banner de mensagens agendadas */}
      {selectedContact && selectedContact.lead_id && (
        <ScheduledMessagesBanner
          leadId={selectedContact.lead_id}
          leadName={selectedContact.lead_name || selectedContact.push_name || selectedContact.phone_number}
          phoneNumber={selectedContact.phone_number}
          instanceId={instanceId}
        />
      )}

      {/* Notas internas da conversa */}
      {leadId && (
        <ConversationNotes leadId={leadId} />
      )}

      {/* Área de mensagens — extraída para view/MessageList.tsx (C7) */}
      <MessageList
        messages={messages}
        transferEvents={transferEvents as TransferEvent[]}
        failedMessages={failedMessages}
        isLoading={isLoading}
        contactName={contactName}
        instanceName={instanceName}
        lastReadAt={lastReadAtRef.current}
        mountTime={mountTimeRef.current}
        onImagePreview={setPreviewImageUrl}
        onRetry={retryMessage}
        onOpenTemplates={() => {
          setNewMessage("/");
          setShowSlashPopover(true);
          inputRef.current?.focus();
        }}
        instanceId={instanceId}
        enableActions={true}
      />

      {/* Image Preview (para envio) - fixo acima do input */}
      {selectedImage && imagePreview && (
        <div className="p-4 border-t bg-muted/30 shrink-0">
          <div className="flex items-start gap-3">
            <div className="relative">
              <img
                src={imagePreview}
                alt="Preview"
                className="w-20 h-20 object-cover rounded-lg"
              />
              <button
                onClick={() => {
                  setSelectedImage(null);
                  setImagePreview(null);
                  setImageCaption("");
                  setSendAsSticker(false);
                }}
                className="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 space-y-2">
              {!sendAsSticker && (
                <Input
                  placeholder="Adicionar legenda (opcional)..."
                  value={imageCaption}
                  onChange={(e) => setImageCaption(e.target.value)}
                />
              )}
              <div className="flex gap-2">
                <Button
                  variant={sendAsSticker ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSendAsSticker(!sendAsSticker)}
                  className="shrink-0"
                >
                  <Sticker className="w-4 h-4 mr-1" />
                  Figurinha
                </Button>
                <Button
                  onClick={handleSendImage}
                  disabled={sendMedia.isPending}
                  className="flex-1"
                >
                  {sendMedia.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 mr-2" />
                  )}
                  {sendAsSticker ? "Enviar Figurinha" : "Enviar Imagem"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Input - sempre visível no rodapé (shrink-0) */}
      <ChatComposerShell
        leadId={leadId ?? null}
        variant="full"
        onAssignResponsible={onOpenLeadModal}
        onLinkInstance={() => setIsLinkInstanceOpen(true)}
        onChangeResponsible={onOpenLeadModal}
        innerComposer={
      <div className="p-3 border-t border-border/60 bg-background shrink-0">
        {!canReplyOnThisNumber ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              Apenas os vendedores selecionados para este número podem responder no chat. Peça ao admin para incluir você na configuração da instância.
            </span>
          </div>
        ) : isRecording ? (
          <AudioRecorder
            onRecorded={handleAudioRecorded}
            onCancel={() => setIsRecording(false)}
          />
        ) : (
          <div className="relative flex items-center gap-2">
            {/* Input de arquivo oculto */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              className="hidden"
            />

            {/* Botão de imagem */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={sendMessage.isPending || sendMedia.isPending}
              className="opacity-50 hover:opacity-100 transition-opacity"
            >
              <ImageIcon className="w-5 h-5 text-muted-foreground" />
            </Button>

            {showSlashPopover && templates && (
              <SlashCommandPopover
                query={newMessage}
                templates={templates}
                onSelect={handleSlashSelect}
                onClose={() => setShowSlashPopover(false)}
              />
            )}

            {/* Input de texto */}
            <Input
              ref={inputRef}
              placeholder={`Mensagem para ${contactName}...`}
              value={newMessage}
              onChange={(e) => {
                const val = e.target.value;
                setNewMessage(val);
                setShowSlashPopover(val.startsWith("/") && val.length > 0);
              }}
              onKeyDown={handleKeyDown}
              disabled={sendMessage.isPending || sendMedia.isPending}
              className="flex-1 rounded-full border border-border/60 bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            />

            {/* Botão de agendar — sempre visível */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setScheduleModalOpen(true)}
              title="Agendar mensagem"
              className="opacity-50 hover:opacity-100 hover:text-primary transition-all"
            >
              <Clock className="w-4 h-4" />
            </Button>

            {/* Botão de enviar ou gravar */}
            {newMessage.trim() ? (
              <Button
                onClick={handleSend}
                disabled={sendMessage.isPending}
                size="icon"
                className="gradient-primary text-white border-0"
              >
                {sendMessage.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsRecording(true)}
                disabled={sendMedia.isPending}
                className="opacity-50 hover:opacity-100 transition-opacity"
              >
                <Mic className="w-5 h-5 text-muted-foreground" />
              </Button>
            )}
          </div>
        )}
      </div>
        }
      />

      {/* Modal admin: vincular número ao responsável do lead */}
      {leadId && writeInstanceState.status === "error" && writeInstanceState.responsibleUserId && (
        <InstanceOwnerModal
          open={isLinkInstanceOpen}
          onOpenChange={setIsLinkInstanceOpen}
          targetTeamMemberId={writeInstanceState.responsibleUserId}
          targetTeamMemberName={writeInstanceState.responsibleName ?? null}
        />
      )}

      {/* Modal de preview de imagem */}
      <ImagePreviewModal
        imageUrl={previewImageUrl}
        isOpen={!!previewImageUrl}
        onClose={() => setPreviewImageUrl(null)}
      />

      {selectedContact && (
        <ScheduleMessageModal
          open={scheduleModalOpen}
          onOpenChange={(v) => {
            setScheduleModalOpen(v);
            if (!v) setNewMessage("");
          }}
          leadId={selectedContact.lead_id || ""}
          leadName={selectedContact.lead_name || selectedContact.push_name || selectedContact.phone_number}
          phoneNumber={selectedContact.phone_number}
          instanceId={instanceId}
          initialMessage={newMessage}
        />
      )}
    </div>
  );
}

const LAST_SEEN_KEY = "whatsapp_last_seen_";

/** Normaliza telefone com lógica canônica (remove 55, adiciona 9 se 10 dígitos). */
function normalizePhoneForStorage(phone: string): string {
  let cleaned = phone.replace(/\D/g, "");
  if (!cleaned) return phone;
  if (cleaned.length >= 12 && cleaned.startsWith("55")) cleaned = cleaned.slice(2);
  if (cleaned.length === 10) cleaned = cleaned.slice(0, 2) + "9" + cleaned.slice(2);
  return cleaned;
}

/** Normaliza telefone para URL/API: mesma lógica canônica. */
function normalizePhoneForParam(phone: string): string {
  let cleaned = phone.replace(/\D/g, "");
  if (!cleaned) return phone;
  if (cleaned.length >= 12 && cleaned.startsWith("55")) cleaned = cleaned.slice(2);
  if (cleaned.length === 10) cleaned = cleaned.slice(0, 2) + "9" + cleaned.slice(2);
  return cleaned;
}

/**
 * Builds a localStorage key scoped to user + organization.
 * This ensures instance selection never leaks between users or orgs on the same browser.
 */
function getInstanceStorageKey(userId: string | undefined, orgId: string | undefined): string | null {
  if (!userId || !orgId) return null;
  return `whatsapp_chat_instance:${userId}:${orgId}`;
}

export function WhatsAppChat() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showOnlyWithLead, setShowOnlyWithLead] = useState(false);
  const [showOnlyWaitingHuman, setShowOnlyWaitingHuman] = useState(false);
  const pendingInstanceParamRef = useRef<string | null>(null);
  const [isLeadPanelOpen, setIsLeadPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"active" | "archived">("active");
  const [isInstancesModalOpen, setIsInstancesModalOpen] = useState(false);

  const { data: instances = [], isPending: instancesPending } = useWhatsAppInstancesForUser();
  // TanStack Query v5: isLoading = isPending && isFetching, so it's false when query is disabled.
  // Use isPending to also show spinner while waiting for the team member to load (query not yet enabled).
  const instancesLoading = instancesPending;
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);

  // Track whether instance restoration has already run for this user context
  const instanceRestoredRef = useRef(false);

  // Hooks para archive/delete/tags
  const { isAdmin } = useIsAdmin();
  const { data: teamMember } = useCurrentTeamMember();

  // Resolve effective instance: only use selectedInstanceId if it's valid for this user
  const selectedInstance = selectedInstanceId
    ? instances.find((i) => i.id === selectedInstanceId) ?? null
    : null;
  const effectiveInstanceId = selectedInstance?.id ?? null;

  const { data: contacts = [], isLoading: contactsLoading } = useWhatsAppContacts(effectiveInstanceId);
  const { data: selectedLead, isLoading: selectedLeadLoading } = useLeadByPhone(selectedPhone);
  const createLeadFromWhatsApp = useCreateLeadFromWhatsApp();

  const { data: waitingHumanLeadIds } = useQuery({
    queryKey: ['waiting-human-leads', teamMember?.organization_id],
    queryFn: async () => {
      if (!teamMember?.organization_id) return new Set<string>();
      const { data } = await supabase
        .from('conversations')
        .select('lead_id')
        .eq('organization_id', teamMember.organization_id)
        .eq('state', 'WAITING_HUMAN');
      return new Set((data ?? []).map((c: any) => c.lead_id as string));
    },
    enabled: !!teamMember?.organization_id,
    refetchInterval: 30000,
  });

  const waitingHumanCount = waitingHumanLeadIds?.size ?? 0;

  const { data: allTags = [] } = useTags();
  const archiveConversation = useArchiveConversation();
  const unarchiveConversation = useUnarchiveConversation();
  const deleteConversation = useDeleteConversation();
  const addConversationTag = useAddConversationTag();
  const removeConversationTag = useRemoveConversationTag();

  const handleArchive = useCallback((phoneNumber: string) => {
    if (!effectiveInstanceId) return;
    archiveConversation.mutate(
      { instanceId: effectiveInstanceId, phoneNumber },
      {
        onSuccess: () => toast.success("Conversa arquivada"),
        onError: () => toast.error("Erro ao arquivar conversa"),
      }
    );
  }, [effectiveInstanceId, archiveConversation]);

  const handleUnarchive = useCallback((conversationId: string) => {
    unarchiveConversation.mutate(
      { conversationId },
      {
        onSuccess: () => toast.success("Conversa desarquivada"),
        onError: () => toast.error("Erro ao desarquivar conversa"),
      }
    );
  }, [unarchiveConversation]);

  const handleDelete = useCallback((phoneNumber: string) => {
    if (!effectiveInstanceId || !teamMember?.organization_id) return;
    deleteConversation.mutate(
      {
        instanceId: effectiveInstanceId,
        phoneNumber,
        organizationId: teamMember.organization_id,
      },
      {
        onSuccess: () => {
          toast.success("Conversa excluída");
          if (selectedPhone === phoneNumber) setSelectedPhone(null);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao excluir conversa"),
      }
    );
  }, [effectiveInstanceId, teamMember?.organization_id, deleteConversation, selectedPhone]);

  const handleAddTag = useCallback((phoneNumber: string, tagId: string) => {
    if (!effectiveInstanceId) return;
    addConversationTag.mutate(
      { instanceId: effectiveInstanceId, phoneNumber, tagId },
      { onError: () => toast.error("Erro ao adicionar tag") }
    );
  }, [effectiveInstanceId, addConversationTag]);

  const handleRemoveTag = useCallback((conversationId: string, tagId: string) => {
    removeConversationTag.mutate(
      { conversationId, tagId },
      { onError: () => toast.error("Erro ao remover tag") }
    );
  }, [removeConversationTag]);

  // Restore persisted instance when user context + instances become available
  useEffect(() => {
    if (instanceRestoredRef.current) return;
    if (!teamMember?.id || !teamMember?.organization_id) return;
    if (instancesLoading || instances.length === 0) return;

    instanceRestoredRef.current = true;

    const storageKey = getInstanceStorageKey(teamMember.id, teamMember.organization_id);
    const persistedId = storageKey ? localStorage.getItem(storageKey) : null;

    // Validate: persisted instance must exist in user's allowed list
    const persistedIsValid = persistedId ? instances.some((i) => i.id === persistedId) : false;

    if (persistedIsValid) {
      setSelectedInstanceId(persistedId);
    } else if (instances.length === 1) {
      // Only auto-select when there's a single option — no ambiguity
      setSelectedInstanceId(instances[0].id);
    }
    // Multiple instances + no valid persisted → stays null, user must choose
  }, [teamMember?.id, teamMember?.organization_id, instances, instancesLoading]);

  // Reset restoration flag when user context changes (login switch)
  useEffect(() => {
    instanceRestoredRef.current = false;
    setSelectedInstanceId(null);
  }, [teamMember?.id, teamMember?.organization_id]);

  // Persist selection to scoped localStorage whenever it changes
  useEffect(() => {
    const storageKey = getInstanceStorageKey(teamMember?.id, teamMember?.organization_id);
    if (!storageKey) return;

    if (effectiveInstanceId) {
      localStorage.setItem(storageKey, effectiveInstanceId);
    }
  }, [effectiveInstanceId, teamMember?.id, teamMember?.organization_id]);

  // Abrir conversa pelo parâmetro ?phone= (pipes, campanhas, etc.)
  useEffect(() => {
    const phoneParam = searchParams.get("phone");
    if (phoneParam) {
      const normalized = normalizePhoneForParam(phoneParam);
      if (normalized) {
        setSelectedPhone(normalized);
        pendingInstanceParamRef.current = searchParams.get("instance");
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, setSearchParams]);

  // Auto-select instance when phone is set from URL but no instance selected yet
  useEffect(() => {
    if (!selectedPhone) return;
    if (selectedInstanceId) return;
    if (instancesLoading || instances.length === 0) return;

    const pending = pendingInstanceParamRef.current;
    if (pending && instances.some((i) => i.id === pending)) {
      setSelectedInstanceId(pending);
      pendingInstanceParamRef.current = null;
      return;
    }
    pendingInstanceParamRef.current = null;

    if (instances.length === 1) {
      setSelectedInstanceId(instances[0].id);
    } else {
      const storageKey = getInstanceStorageKey(teamMember?.id, teamMember?.organization_id);
      const persistedId = storageKey ? localStorage.getItem(storageKey) : null;
      if (persistedId && instances.some((i) => i.id === persistedId)) {
        setSelectedInstanceId(persistedId);
      } else {
        setSelectedInstanceId(instances[0].id);
      }
    }
  }, [selectedPhone, selectedInstanceId, instances, instancesLoading, teamMember?.id, teamMember?.organization_id]);

  // Ativar realtime para lista de contatos
  useWhatsAppMessagesRealtime(null, null);

  // Ao abrir uma conversa, marcar como lida (atualizar last_seen e invalidar lista)
  useEffect(() => {
    if (!selectedPhone) return;
    const key = LAST_SEEN_KEY + normalizePhoneForStorage(selectedPhone);
    localStorage.setItem(key, new Date().toISOString());
    queryClient.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
  }, [selectedPhone, queryClient]);

  // Pegar pushName do contato selecionado
  const selectedContact = contacts.find((c) => c.phone_number === selectedPhone);

  // Lead creation is now manual — no auto-creation when selecting a conversation

  if (instancesLoading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center p-8">
        <AlertCircle className="w-16 h-16 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium mb-2">Você não está vinculado a nenhum número</h3>
        <p className="text-muted-foreground mb-4 max-w-md">
          Nenhuma conversa será exibida até que um administrador vincule você a um número/inbox.
          Peça ao administrador para incluir você na configuração da instância desejada.
        </p>
        {isAdmin ? (
          <Button onClick={() => setIsInstancesModalOpen(true)} className="gap-2">
            <Settings className="w-4 h-4" />
            Instâncias
          </Button>
        ) : (
          <Button variant="outline" asChild>
            <a href="/configuracoes">Ir para Configurações</a>
          </Button>
        )}
        <Dialog open={isInstancesModalOpen} onOpenChange={setIsInstancesModalOpen}>
          <DialogContent className="max-w-2xl w-[calc(100vw-2rem)] max-h-[90vh] flex flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Instâncias WhatsApp
              </DialogTitle>
              <DialogDescription>
                Gerencie suas conexões WhatsApp via Evolution API
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="flex-1 min-h-0 overflow-y-auto">
              <div className="pr-1 pb-4">
                <WhatsAppSettings />
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-1 min-h-0 rounded-lg border bg-background overflow-hidden">
        {/* Contact List - altura limitada com scroll interno */}
        <div
          className={cn(
            "w-full md:w-80 lg:w-96 flex-shrink-0 min-h-0 flex flex-col overflow-hidden",
            selectedPhone && "hidden md:flex md:flex-col"
          )}
        >
          <ContactList
            contacts={contacts}
            selectedPhone={selectedPhone}
            onSelectContact={setSelectedPhone}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            isLoading={contactsLoading}
            instances={instances}
            selectedInstanceId={effectiveInstanceId}
            onSelectInstance={setSelectedInstanceId}
            showOnlyWithLead={showOnlyWithLead}
            onToggleShowOnlyWithLead={() => setShowOnlyWithLead((v) => !v)}
            showOnlyWaitingHuman={showOnlyWaitingHuman}
            onToggleShowOnlyWaitingHuman={() => setShowOnlyWaitingHuman(!showOnlyWaitingHuman)}
            waitingHumanCount={waitingHumanCount}
            waitingHumanLeadIds={waitingHumanLeadIds}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onArchive={handleArchive}
            onUnarchive={handleUnarchive}
            onDelete={handleDelete}
            isAdmin={isAdmin}
            instanceId={effectiveInstanceId ?? null}
            organizationId={teamMember?.organization_id ?? null}
            allTags={allTags}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            onOpenInstances={isAdmin ? () => setIsInstancesModalOpen(true) : undefined}
          />
        </div>

        {/* Chat Window - min-w-0 evita clipping horizontal; min-h-0 para scroll interno na área de mensagens */}
        <div className={cn("flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col", !selectedPhone && "hidden md:flex")}>
          {selectedPhone && selectedInstance ? (
            <ChatWindow
              phoneNumber={selectedPhone}
              onBack={() => setSelectedPhone(null)}
              instanceName={selectedInstance.instance_name}
              instanceId={selectedInstance.id}
              onOpenLeadModal={() => {
                if (import.meta.env.DEV) console.log("[Chat] Abrindo painel do lead");
                setIsLeadPanelOpen(true);
              }}
              hasLead={!!(selectedLead || selectedContact?.lead_id)}
              leadId={selectedLead?.id ?? selectedContact?.lead_id ?? undefined}
              leadAiDisabled={selectedLead?.ai_disabled}
              selectedContact={selectedContact}
              selectedLeadName={selectedLead?.name}
            />
          ) : selectedPhone ? (
            <div className="flex flex-col items-center justify-center h-full w-full">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full w-full text-center p-8">
              <MessageSquare className="w-10 h-10 text-muted-foreground/25 mb-3" />
              <p className="text-sm font-medium text-muted-foreground/50">
                Selecione uma conversa
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Modal de Instâncias WhatsApp */}
      {isAdmin && (
        <Dialog open={isInstancesModalOpen} onOpenChange={setIsInstancesModalOpen}>
          <DialogContent className="max-w-2xl w-[calc(100vw-2rem)] max-h-[90vh] flex flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Instâncias WhatsApp
              </DialogTitle>
              <DialogDescription>
                Gerencie suas conexões WhatsApp via Evolution API
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="flex-1 min-h-0 overflow-y-auto">
              <div className="pr-1 pb-4">
                <WhatsAppSettings />
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      )}

      {/* Wizard/Modal do lead (Informações → Pipeline → Campanhas) */}
      {selectedPhone && (
        <Dialog open={isLeadPanelOpen} onOpenChange={setIsLeadPanelOpen}>
          <DialogContent
            className="max-w-2xl w-[calc(100vw-2rem)] max-h-[90vh] flex flex-col overflow-hidden p-0 gap-0"
            aria-describedby="lead-wizard-desc"
          >
            <DialogHeader className="sr-only">
              <DialogTitle>Lead — Informações, Pipeline e Campanhas</DialogTitle>
              <DialogDescription id="lead-wizard-desc">
                Dados do contato, etapa no pipe de qualificação e campanhas.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-6 pt-14">
              <LeadDetailContent
                phoneNumber={selectedPhone}
                pushName={selectedContact?.push_name}
                onClose={() => setIsLeadPanelOpen(false)}
                showHeader={true}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
