import { useState, useRef, useEffect, useCallback, Component } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  MessageSquare,
  Send,
  Phone,
  Check,
  CheckCheck,
  Clock,
  Loader2,
  ArrowLeft,
  AlertCircle,
  UserCircle,
  Image as ImageIcon,
  Mic,
  MicOff,
  X,
  Bot,
  Plus,
  Users,
  Settings,
  UserPlus,
  ArrowRightLeft,
  RotateCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useToggleLeadAI, useToggleConversationAI, useLeadAiStatus } from "@/hooks/useLeads";
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
import { useIsAdmin } from "@/hooks/useUserRole";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { ChannelBadge, type ChannelType } from "./ChannelBadge";
import { LeadDetailContent } from "./LeadDetailContent";
import { ScheduleMessageModal } from "./ScheduleMessageModal";
import { SlashCommandPopover } from "@/components/chat/SlashCommandPopover";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { resolveVariables } from "@/lib/template-variables";
import type { LeadContext, AttendantContext } from "@/lib/template-variables";
import type { MessageTemplate } from "@/hooks/useMessageTemplates";
import { useConversationDraft } from "@/hooks/useConversationDraft";
import { useAuth } from "@/contexts/AuthContext";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { UnreadDivider } from "@/components/chat/UnreadDivider";
import { ScrollToBottomFab } from "@/components/chat/ScrollToBottomFab";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
// DropdownMenuSeparator/Sub/SubContent/SubTrigger extraídos para list/ConversationListItem.tsx (C5).
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { AudioPlayer, getAudioPlaybackUrl } from "./media/AudioPlayer";
import { AudioRecorder as AudioRecorderMedia } from "./media/AudioRecorder";
import { ImagePreviewModal as ImagePreviewModalMedia } from "./media/ImagePreviewModal";
import { MessageImage, MessageVideo, MessageDocument } from "./media/MessageMedia";
import { ConversationList } from "./list/ConversationList";
import { contactDisplayName } from "./list/ConversationListItem";

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
}: {
  message: WhatsAppMessage | import("@/hooks/useWhatsAppChat").FailedMessage;
  onImagePreview: (url: string) => void;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  mountTime?: number;
  onRetry?: (message: import("@/hooks/useWhatsAppChat").FailedMessage) => void;
}) {
  const isOutgoing = message.direction === "outgoing";
  const isFailed = message.status === "failed";
  const isWhatsAppMsg = "message_type" in message;
  const mediaUrl = isWhatsAppMsg ? (message as WhatsAppMessage).media_url : null;
  const messageType = isWhatsAppMsg ? (message as WhatsAppMessage).message_type : null;
  const isAudio = messageType === "audio" || messageType === "ptt";
  const isImage = messageType === "image";
  const isVideo = messageType === "video";
  const isDocument = messageType === "document";
  const isSticker = messageType === "sticker";
  const hasMedia = isAudio || isImage || isVideo || isDocument || isSticker;

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
      className={cn(
        "flex gap-2",
        isOutgoing ? "justify-end" : "justify-start",
        isFirstInGroup ? "mt-3" : "mt-0.5"
      )}
    >
      <div
        className={cn(
          "max-w-[75%] px-4 py-2.5",
          radiusClass,
          isOutgoing
            ? "bg-muted/80 border border-border/60"
            : "bg-card border border-border/40",
          isFailed && "border-destructive/40"
        )}
      >
        {/* Sender label for AI messages — only on first in group */}
        {isFirstInGroup && isOutgoing && message.sent_by_ai && (
          <div className="flex items-center gap-1 mb-1">
            <Bot className="h-3 w-3 text-primary/60" />
            <span className="text-[10px] text-primary/60 font-medium">Copilot</span>
          </div>
        )}

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
        {isAudio && mediaUrl && (
          <div>
            <AudioPlayer src={getAudioPlaybackUrl(mediaUrl) ?? mediaUrl} isOutgoing={isOutgoing} />
          </div>
        )}

        {/* Imagem */}
        {isImage && mediaUrl && (
          <MessageImage
            src={mediaUrl}
            onPreview={() => onImagePreview(mediaUrl)}
          />
        )}

        {/* Vídeo */}
        {isVideo && mediaUrl && (
          <MessageVideo src={mediaUrl} />
        )}

        {/* Documento */}
        {isDocument && mediaUrl && (
          <MessageDocument
            src={mediaUrl}
            isOutgoing={isOutgoing}
          />
        )}

        {/* Sticker */}
        {isSticker && mediaUrl && (
          <img
            src={mediaUrl}
            alt="Sticker"
            className="w-32 h-32 object-contain"
          />
        )}

        {/* Mensagem sem conteúdo e sem mídia */}
        {!message.content && !hasMedia && (
          <p className="text-sm italic text-muted-foreground">
            [Mensagem não suportada]
          </p>
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
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const toggleAIMutation = useToggleLeadAI();
  const toggleConversationAIMutation = useToggleConversationAI();

  // Ler ai_disabled via RPC dedicado (bypass RLS) — fonte de verdade
  const { data: aiStatus } = useLeadAiStatus(leadId);
  const currentAiDisabled = aiStatus?.ai_disabled ?? false;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mountTimeRef = useRef<number>(Date.now());
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newMessagesCount, setNewMessagesCount] = useState(0);

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
  const { canReply: canReplyOnThisNumber } = useCanReplyOnInstanceByName(instanceName);
  const failedMessages = useFailedMessages(phoneNumber, instanceId);
  const retryMessage = useRetryMessage();

  // SZ.chat transfer-back: check if this contact has an active SZ.chat session
  const { data: teamMemberCW } = useCurrentTeamMember();
  const organizationIdCW = teamMemberCW?.organization_id ?? null;
  const { data: szChatSession } = useActiveSzChatSession(phoneNumber, organizationIdCW);
  const transferToSzChat = useTransferToSzChatDepartment();

  // Ativar realtime
  useWhatsAppMessagesRealtime(phoneNumber);

  // Scroll listener for FAB visibility
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (!viewport) return;
    const handler = () => {
      const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      const atBottom = distance < 80;
      setIsAtBottom(atBottom);
      if (atBottom) setNewMessagesCount(0);
    };
    viewport.addEventListener("scroll", handler, { passive: true });
    handler();
    return () => viewport.removeEventListener("scroll", handler);
  }, [phoneNumber]);

  // Reset FAB state on conversation change
  useEffect(() => {
    setIsAtBottom(true);
    setNewMessagesCount(0);
  }, [phoneNumber]);

  // Smart auto-scroll: always scroll on own messages, only scroll if at bottom for incoming
  useEffect(() => {
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (lastMsg?.direction === "outgoing") {
      // Own message: always scroll to bottom
      if (viewport) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    } else if (isAtBottom) {
      // Incoming: only scroll if already at bottom
      if (viewport) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    } else {
      // Incoming while scrolled up: increment counter
      setNewMessagesCount((n) => n + 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || !instanceName) return;

    try {
      await sendMessage.mutateAsync({
        phoneNumber,
        message: newMessage.trim(),
        instanceName,
        instanceId,
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
        mediaType: "image",
        media: base64,
        caption: imageCaption || undefined,
        fileName: selectedImage.name,
        mimetype: selectedImage.type,
      });

      setSelectedImage(null);
      setImagePreview(null);
      setImageCaption("");
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
      {/* Header - Clicável para abrir painel do lead */}
      <div className="flex items-center gap-3 p-3 border-b border-border/60 bg-background shrink-0">
        <Button variant="ghost" size="icon" onClick={onBack} className="md:hidden shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        
        {/* Área clicável do contato */}
        <div
          role="button"
          tabIndex={0}
          className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer hover:bg-muted/50 -m-2 p-2 rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenLeadModal(); }}
          onPointerDown={(e) => { e.stopPropagation(); onOpenLeadModal(); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenLeadModal(); } }}
        >
          <div className="relative shrink-0">
            <Avatar className="w-10 h-10 border-2 border-background shadow-sm">
              <AvatarFallback className={cn(
                "font-medium text-primary",
                hasLead ? "bg-primary/15 text-primary" : "bg-primary/10"
              )}>
                {(contactName.charAt(0) || "?").toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <ChannelBadge channel="whatsapp" size={16} overlay />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold truncate text-foreground">{contactName}</h3>
              {!hasLead && (
                <Badge variant="secondary" className="text-xs shrink-0 text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/40 border-0">
                  Sem lead
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground flex items-center gap-1 truncate">
              <Phone className="w-3 h-3 shrink-0" />
              {phoneNumber}
            </p>
          </div>
        </div>

        {/* Botão para ver ou criar lead */}
        <Button
          type="button"
          variant={hasLead ? "ghost" : "outline"}
          size="sm"
          className={cn("shrink-0", !hasLead && "border-primary text-primary hover:bg-primary/10")}
          onClick={(e) => { e.stopPropagation(); onOpenLeadModal(); }}
          onPointerDown={(e) => e.stopPropagation()}
          title={hasLead ? "Ver dados do lead e pipeline" : "Criar lead para este contato"}
        >
          {hasLead ? (
            <>
              <UserCircle className="w-4 h-4 mr-1.5" />
              Ver lead
            </>
          ) : (
            <>
              <Plus className="w-4 h-4 mr-1.5" />
              Criar Lead
            </>
          )}
        </Button>

        {/* AI Toggle */}
        <div
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-full border border-border/40 shrink-0",
            currentAiDisabled ? "bg-muted/30" : "bg-primary/8"
          )}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Bot className={cn("w-3.5 h-3.5", currentAiDisabled ? "text-muted-foreground/50" : "text-primary/70")} />
          <span className="text-[11px] text-muted-foreground/70 hidden sm:inline">IA</span>
          <div onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={!currentAiDisabled}
                onCheckedChange={(checked) => {
                  if (leadId) {
                    toggleAIMutation.mutate(
                      { leadId, disabled: !checked },
                      {
                        onSuccess: () => {
                          toast.success(checked ? "IA ativada" : "IA desativada");
                        },
                        onError: (err: any) => {
                          const msg = err?.message || "Erro desconhecido";
                          toast.error(`Erro ao alterar Copilot: ${msg}`);
                          console.error("[toggleAI] Error:", err);
                        },
                      }
                    );
                  } else {
                    toggleConversationAIMutation.mutate(
                      { phone: phoneNumber, disabled: !checked },
                      {
                        onSuccess: () => {
                          toast.success(checked ? "IA ativada" : "IA desativada");
                        },
                        onError: (err: any) => {
                          const msg = err?.message || "Erro desconhecido";
                          toast.error(`Erro ao alterar Copilot: ${msg}`);
                          console.error("[toggleAI] Error:", err);
                        },
                      }
                    );
                  }
                }}
                disabled={toggleAIMutation.isPending || toggleConversationAIMutation.isPending}
              />
          </div>
        </div>

        {/* Transfer / AI state badge */}
        {hasLead && leadId && isWaitingHuman && (
          <Badge variant="outline" className="border-amber-400 text-amber-600 gap-1.5 text-xs">
            <UserPlus className="h-3 w-3" />
            Aguardando humano
          </Badge>
        )}
        {currentAiDisabled && !isWaitingHuman && (
          <Badge variant="outline" className="text-muted-foreground gap-1.5 text-xs">
            IA desativada
          </Badge>
        )}

        {/* SZ.chat transfer-back button: only visible when there is an active SZ.chat session */}
        {szChatSession && Object.keys(szChatSession.team_mappings).length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5 text-xs"
                disabled={transferToSzChat.isPending}
              >
                {transferToSzChat.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                )}
                Transferir setor
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {Object.entries(szChatSession.team_mappings).map(([teamName, teamId]) => (
                <DropdownMenuItem
                  key={teamId}
                  onClick={() => {
                    if (!organizationIdCW) return;
                    transferToSzChat.mutate(
                      {
                        organizationId: organizationIdCW,
                        sessionId: szChatSession.sz_chat_session_id,
                        targetTeamName: teamName,
                        targetTeamId: teamId,
                      },
                      {
                        onSuccess: () => {
                          toast.success(`Conversa transferida para ${teamName}`);
                        },
                        onError: (err) => {
                          toast.error(
                            err instanceof Error
                              ? err.message
                              : "Erro ao transferir conversa"
                          );
                        },
                      }
                    );
                  }}
                >
                  {teamName}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

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

      {/* Área de mensagens: altura limitada com scroll interno; boundary evita "fewer hooks" ao isolar erros */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col relative">
        <ScrollArea ref={scrollAreaRef} className="flex-1 h-full">
          <div className="p-4 min-h-full">
            <MessagesAreaErrorBoundary>
            {isLoading ? (
              <div className="flex items-center justify-center min-h-[200px]">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <ChatEmptyState
                contactName={contactName}
                instanceName={instanceName}
                onOpenTemplates={() => {
                  setNewMessage("/");
                  setShowSlashPopover(true);
                  inputRef.current?.focus();
                }}
              />
            ) : (
              <div className="space-y-1 pb-4">
                {(() => {
                  // Merge messages + transfer events + failed messages, sorted by timestamp
                  const timeline = [
                    ...messages.map(m => ({ ...m, _type: 'message' as const })),
                    ...transferEvents.map(e => ({ ...e, _type: 'transfer' as const })),
                    ...failedMessages.map(f => ({ ...f, _type: 'message' as const, message_type: 'text', content: f.message, media_url: f.mediaUrl })),
                  ].sort((a, b) => {
                    const timeA = new Date(a.timestamp).getTime();
                    const timeB = new Date(b.timestamp).getTime();
                    return timeA - timeB;
                  });

                  // Compute unread divider position
                  let firstUnreadIndex = -1;
                  let unreadCount = 0;
                  const lastReadAt = lastReadAtRef.current;
                  if (lastReadAt > 0) {
                    timeline.forEach((item, idx) => {
                      if (item._type === 'message' && item.direction === 'incoming') {
                        const msgTime = new Date(item.timestamp).getTime();
                        if (msgTime > lastReadAt) {
                          unreadCount++;
                          if (firstUnreadIndex === -1) firstUnreadIndex = idx;
                        }
                      }
                    });
                  }

                  let lastDate = "";
                  return timeline.map((item, index) => {
                    // Transfer event card
                    if (item._type === 'transfer') {
                      return (
                        <div key={`transfer-${item.id}`} className="flex items-start gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-950/20 border-l-2 border-amber-400 mx-4 my-2 rounded-r">
                          <UserPlus className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs font-medium text-amber-800 dark:text-amber-200">Transferido para humano</p>
                            {item.reason && (
                              <p className="text-xs text-amber-700 dark:text-amber-300">{item.reason}</p>
                            )}
                            <time dateTime={item.timestamp} className="text-xs text-amber-500 mt-0.5 tabular-nums">
                              {new Date(item.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </time>
                          </div>
                        </div>
                      );
                    }

                    // Normal message (preserve existing date separator + MessageBubble logic)
                    const message = item;
                    const ts = message?.timestamp;
                    const date = ts ? new Date(ts) : new Date();
                    const validDate = !Number.isNaN(date.getTime());
                    const msgDate = validDate ? format(date, "dd/MM/yyyy", { locale: ptBR }) : "";
                    const showDateSeparator = msgDate !== lastDate;
                    if (showDateSeparator) lastDate = msgDate;
                    const dateLabel = validDate
                      ? isToday(date)
                        ? "Hoje"
                        : isYesterday(date)
                          ? "Ontem"
                          : format(date, "dd/MM/yyyy", { locale: ptBR })
                      : "";
                    const safeKey = message?.id || `msg-${index}-${ts || index}`;

                    // Grouping: compare with adjacent message-type items
                    const prevItem = index > 0 ? timeline[index - 1] : null;
                    const nextItem = index < timeline.length - 1 ? timeline[index + 1] : null;
                    const prevMsg = prevItem && prevItem._type === 'message' ? prevItem : null;
                    const nextMsg = nextItem && nextItem._type === 'message' ? nextItem : null;
                    const sameAuthorPrev = prevMsg && prevMsg.direction === message.direction && prevMsg.sent_by_ai === message.sent_by_ai;
                    const sameAuthorNext = nextMsg && nextMsg.direction === message.direction && nextMsg.sent_by_ai === message.sent_by_ai;
                    const deltaPrev = prevMsg ? Math.abs(new Date(message.timestamp).getTime() - new Date(prevMsg.timestamp).getTime()) : Infinity;
                    const deltaNext = nextMsg ? Math.abs(new Date(nextMsg.timestamp).getTime() - new Date(message.timestamp).getTime()) : Infinity;
                    const isFirstInGroup = !(sameAuthorPrev && deltaPrev < 120_000);
                    const isLastInGroup = !(sameAuthorNext && deltaNext < 120_000);

                    return (
                      <div key={safeKey}>
                        {showDateSeparator && (
                          <div className="flex justify-center py-3">
                            <time dateTime={validDate ? format(date, "yyyy-MM-dd") : ""} className="text-[11px] font-medium tracking-wider uppercase text-muted-foreground/40 bg-muted/30 px-3 py-1 rounded-full">
                              {dateLabel}
                            </time>
                          </div>
                        )}
                        {index === firstUnreadIndex && unreadCount > 0 && (
                          <UnreadDivider count={unreadCount} />
                        )}
                        <MessageBubble
                          message={message}
                          onImagePreview={setPreviewImageUrl}
                          isFirstInGroup={isFirstInGroup}
                          isLastInGroup={isLastInGroup}
                          mountTime={mountTimeRef.current}
                          onRetry={message.status === 'failed' ? retryMessage : undefined}
                        />
                      </div>
                    );
                  });
                })()}
                <div ref={messagesEndRef} />
              </div>
            )}
            </MessagesAreaErrorBoundary>
          </div>
        </ScrollArea>
        <ScrollToBottomFab
          visible={!isAtBottom}
          count={newMessagesCount}
          onClick={() => {
            const viewport = scrollAreaRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
            if (viewport) {
              viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
            } else {
              messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
            }
            setNewMessagesCount(0);
          }}
        />
      </div>

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
                }}
                className="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 space-y-2">
              <Input
                placeholder="Adicionar legenda (opcional)..."
                value={imageCaption}
                onChange={(e) => setImageCaption(e.target.value)}
              />
              <Button
                onClick={handleSendImage}
                disabled={sendMedia.isPending}
                className="w-full"
              >
                {sendMedia.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                Enviar Imagem
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Input - sempre visível no rodapé (shrink-0) */}
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
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, setSearchParams]);

  // Ativar realtime para lista de contatos
  useWhatsAppMessagesRealtime(null);

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
      <div className="flex flex-1 min-h-0 h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] rounded-lg border bg-background overflow-hidden">
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

        {/* Chat Window - min-h-0 para scroll interno na área de mensagens */}
        <div className={cn("flex-1 min-h-0 overflow-hidden flex flex-col", !selectedPhone && "hidden md:flex")}>
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
          ) : selectedPhone ? null : (
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
