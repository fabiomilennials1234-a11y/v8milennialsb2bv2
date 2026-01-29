import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  MessageSquare,
  Send,
  Search,
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
  Pause,
  Play,
  X,
  FileImage,
  FileText,
  FileVideo,
  Download,
  File,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useToggleLeadAI } from "@/hooks/useLeads";
import {
  useWhatsAppContacts,
  useWhatsAppMessages,
  useSendWhatsAppMessage,
  useSendWhatsAppMedia,
  useWhatsAppMessagesRealtime,
  useActiveWhatsAppInstance,
  ChatContact,
  WhatsAppMessage,
} from "@/hooks/useWhatsAppChat";
import { useCanReplyOnInstanceByName } from "@/hooks/useWhatsAppInstanceAllowedMembers";
import { useLeadByPhone } from "@/hooks/useWhatsAppLeadIntegration";
import { LeadDetailContent } from "./LeadDetailContent";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

function formatMessageTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (isToday(date)) {
    return format(date, "HH:mm");
  }
  if (isYesterday(date)) {
    return "Ontem " + format(date, "HH:mm");
  }
  return format(date, "dd/MM HH:mm");
}

function formatContactTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (isToday(date)) {
    return format(date, "HH:mm");
  }
  if (isYesterday(date)) {
    return "Ontem";
  }
  return format(date, "dd/MM", { locale: ptBR });
}

function MessageStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return <Clock className="w-3 h-3 text-muted-foreground" />;
    case "sent":
      return <Check className="w-3 h-3 text-muted-foreground" />;
    case "delivered":
      return <CheckCheck className="w-3 h-3 text-muted-foreground" />;
    case "read":
      return <CheckCheck className="w-3 h-3 text-blue-500" />;
    default:
      return null;
  }
}

/** Nome de exibição do contato: prioriza lead (CRM) para evitar troca de nomes */
function contactDisplayName(c: ChatContact): string {
  return c.lead_name || c.push_name || c.phone_number;
}

function ContactList({
  contacts,
  selectedPhone,
  onSelectContact,
  searchQuery,
  onSearchChange,
  isLoading,
}: {
  contacts: ChatContact[];
  selectedPhone: string | null;
  onSelectContact: (phone: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isLoading: boolean;
}) {
  const filteredContacts = contacts.filter(
    (c) =>
      c.phone_number.includes(searchQuery) ||
      c.push_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.lead_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full min-h-0 border-r border-border/60 bg-muted/20">
      <div className="p-3 border-b bg-background shrink-0">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Inbox
        </p>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar conversa..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 h-9 bg-background"
          />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Total: {filteredContacts.length}
        </p>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <MessageSquare className="w-12 h-12 text-muted-foreground/50 mb-4" />
            <p className="text-sm text-muted-foreground">
              {searchQuery ? "Nenhuma conversa encontrada" : "Nenhuma conversa ainda"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {filteredContacts.map((contact) => {
              const displayName = contactDisplayName(contact);
              const isSelected = selectedPhone === contact.phone_number;
              return (
                <motion.button
                  key={contact.phone_number}
                  onClick={() => onSelectContact(contact.phone_number)}
                  className={cn(
                    "w-full px-3 py-3 text-left transition-colors rounded-none border-l-2",
                    isSelected
                      ? "bg-primary/15 border-l-primary"
                      : contact.unread_count > 0
                        ? "bg-amber-50 dark:bg-amber-950/30 border-l-amber-500 hover:bg-amber-100 dark:hover:bg-amber-950/50"
                        : "hover:bg-muted/50 border-l-transparent"
                  )}
                  whileTap={{ scale: 0.99 }}
                >
                  <div className="flex items-start gap-3">
                    <Avatar className="w-11 h-11 shrink-0 rounded-full border-2 border-background shadow-sm">
                      <AvatarFallback className="bg-primary/10 text-primary font-medium text-sm">
                        {displayName[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground truncate text-sm">
                          {displayName}
                        </span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                          {formatContactTime(contact.last_message_time)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <p className="text-sm text-muted-foreground truncate flex-1 min-w-0 flex items-center gap-1.5">
                          {contact.last_message_direction === "outgoing" && (
                            <span className="text-primary shrink-0 font-medium" title="Você enviou">Você:</span>
                          )}
                          {contact.last_message_direction === "incoming" && (
                            <span className="text-muted-foreground shrink-0 italic" title="Contato enviou">Contato:</span>
                          )}
                          <span className="truncate min-w-0">{contact.last_message || "Sem mensagens"}</span>
                        </p>
                        {contact.unread_count > 0 && !isSelected && (
                          <Badge
                            className="h-5 min-w-5 px-1.5 shrink-0 text-xs bg-amber-500 text-white border-0 hover:bg-amber-600"
                            title="Mensagens não lidas"
                          >
                            {contact.unread_count > 99 ? "99+" : contact.unread_count}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// Componente de player de áudio - usando controles nativos para máxima compatibilidade
function AudioPlayer({ src, isOutgoing }: { src: string; isOutgoing: boolean }) {
  return (
    <div className="flex items-center gap-2 min-w-[200px]">
      <audio 
        controls 
        controlsList="nodownload"
        src={src}
        className="h-10 max-w-[250px]"
        preload="metadata"
      />
    </div>
  );
}

// Componente para exibir imagem na mensagem
function MessageImage({
  src,
  onPreview,
}: {
  src: string;
  onPreview: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="w-48 h-32 bg-muted/50 rounded flex items-center justify-center">
        <FileImage className="w-8 h-8 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="relative cursor-pointer" onClick={onPreview}>
      {!loaded && (
        <div className="w-48 h-32 bg-muted/50 rounded flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <img
        src={src}
        alt="Imagem"
        className={cn(
          "max-w-[240px] max-h-[300px] rounded object-cover",
          !loaded && "hidden"
        )}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />
    </div>
  );
}

// Componente para exibir vídeo na mensagem
function MessageVideo({ src }: { src: string }) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="w-48 h-32 bg-muted/50 rounded flex flex-col items-center justify-center gap-2">
        <FileVideo className="w-8 h-8 text-muted-foreground" />
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <Download className="w-3 h-3" />
          Baixar vídeo
        </a>
      </div>
    );
  }

  return (
    <video
      src={src}
      controls
      className="max-w-[240px] max-h-[300px] rounded"
      onError={() => setError(true)}
    >
      Seu navegador não suporta vídeos.
    </video>
  );
}

// Componente para exibir documento na mensagem
function MessageDocument({
  src,
  fileName,
  isOutgoing,
}: {
  src: string;
  fileName?: string;
  isOutgoing: boolean;
}) {
  // Tentar extrair nome do arquivo da URL se não fornecido
  const displayName = fileName || src.split("/").pop() || "Documento";
  
  // Detectar tipo de arquivo pelo nome
  const getFileIcon = () => {
    const ext = displayName.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "pdf":
        return <FileText className="w-8 h-8" />;
      case "doc":
      case "docx":
        return <FileText className="w-8 h-8" />;
      case "xls":
      case "xlsx":
        return <FileText className="w-8 h-8" />;
      default:
        return <File className="w-8 h-8" />;
    }
  };

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg transition-colors min-w-[200px]",
        isOutgoing
          ? "bg-primary-foreground/10 hover:bg-primary-foreground/20"
          : "bg-primary/10 hover:bg-primary/20"
      )}
    >
      <div className={cn(
        "p-2 rounded",
        isOutgoing ? "bg-primary-foreground/20" : "bg-primary/20"
      )}>
        {getFileIcon()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{displayName}</p>
        <p className="text-xs opacity-70 flex items-center gap-1">
          <Download className="w-3 h-3" />
          Clique para baixar
        </p>
      </div>
    </a>
  );
}

function MessageBubble({
  message,
  onImagePreview,
}: {
  message: WhatsAppMessage;
  onImagePreview: (url: string) => void;
}) {
  const isOutgoing = message.direction === "outgoing";
  const isAudio = message.message_type === "audio" || message.message_type === "ptt";
  const isImage = message.message_type === "image";
  const isVideo = message.message_type === "video";
  const isDocument = message.message_type === "document";
  const isSticker = message.message_type === "sticker";
  const hasMedia = isAudio || isImage || isVideo || isDocument || isSticker;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex gap-2", isOutgoing ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm border border-border/40",
          isOutgoing
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted/80 rounded-bl-md"
        )}
      >
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
          <AudioPlayer src={message.media_url} isOutgoing={isOutgoing} />
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
        {isSticker && message.media_url && (
          <img
            src={message.media_url}
            alt="Sticker"
            className="w-32 h-32 object-contain"
          />
        )}

        {/* Mensagem sem conteúdo e sem mídia */}
        {!message.content && !hasMedia && (
          <p className="text-sm italic opacity-70">
            [Mensagem não suportada]
          </p>
        )}

        {/* Linha: data/hora e status */}
        <div
          className={cn(
            "flex items-center justify-end gap-2 mt-1.5 flex-wrap",
            isOutgoing ? "text-primary-foreground/80" : "text-muted-foreground"
          )}
        >
          <span className="text-xs">{formatMessageTime(message.timestamp)}</span>
          {isOutgoing && <MessageStatusIcon status={message.status} />}
        </div>
      </div>
    </motion.div>
  );
}

// Componente de gravação de áudio
function AudioRecorder({
  onRecorded,
  onCancel,
}: {
  onRecorded: (audioBlob: Blob) => void;
  onCancel: () => void;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Tentar usar formato compatível com WhatsApp
      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/webm";
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = "audio/ogg;codecs=opus";
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = ""; // Usar padrão do browser
          }
        }
      }
      
      console.log("[AudioRecorder] Using mimeType:", mimeType || "default");
      
      const mediaRecorder = mimeType 
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { 
          type: mediaRecorder.mimeType || "audio/webm" 
        });
        console.log("[AudioRecorder] Recording finished:", {
          chunks: chunksRef.current.length,
          blobSize: audioBlob.size,
          mimeType: audioBlob.type,
        });
        onRecorded(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start(100); // Coletar dados a cada 100ms
      setIsRecording(true);
      
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      console.error("[AudioRecorder] Error:", error);
      toast.error("Não foi possível acessar o microfone");
      onCancel();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }
    setIsRecording(false);
    setRecordingTime(0);
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    onCancel();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    startRecording();
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  return (
    <div className="flex items-center gap-3 w-full bg-red-50 dark:bg-red-950/30 p-3 rounded-lg">
      <Button variant="ghost" size="icon" onClick={cancelRecording}>
        <X className="w-5 h-5 text-red-500" />
      </Button>
      
      <div className="flex-1 flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
        <span className="text-sm font-medium">{formatTime(recordingTime)}</span>
        <span className="text-sm text-muted-foreground">Gravando...</span>
      </div>

      <Button
        variant="default"
        size="icon"
        onClick={stopRecording}
        className="bg-green-500 hover:bg-green-600"
      >
        <Send className="w-4 h-4" />
      </Button>
    </div>
  );
}

// Modal de preview de imagem
function ImagePreviewModal({
  imageUrl,
  isOpen,
  onClose,
}: {
  imageUrl: string | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen || !imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 text-white hover:text-gray-300"
        onClick={onClose}
      >
        <X className="w-8 h-8" />
      </button>
      <img
        src={imageUrl}
        alt="Preview"
        className="max-w-full max-h-full object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function ChatWindow({
  phoneNumber,
  onBack,
  instanceName,
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
  onOpenLeadModal: () => void;
  hasLead: boolean;
  leadId?: string;
  leadAiDisabled?: boolean;
  selectedContact: ChatContact | undefined;
  selectedLeadName?: string | null;
}) {
  const [newMessage, setNewMessage] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imageCaption, setImageCaption] = useState("");
  const toggleAIMutation = useToggleLeadAI();
  // Estado local otimista para feedback visual imediato
  const [optimisticAiDisabled, setOptimisticAiDisabled] = useState<boolean | null>(null);
  
  // Usar estado otimista se disponível, senão usar o valor da prop
  const currentAiDisabled = optimisticAiDisabled !== null ? optimisticAiDisabled : (leadAiDisabled ?? false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { data: messages = [], isLoading } = useWhatsAppMessages(phoneNumber);
  const sendMessage = useSendWhatsAppMessage();
  const sendMedia = useSendWhatsAppMedia();
  const { canReply: canReplyOnThisNumber } = useCanReplyOnInstanceByName(instanceName);

  // Ativar realtime
  useWhatsAppMessagesRealtime(phoneNumber);

  // Auto-scroll para última mensagem
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || !instanceName) return;

    try {
      await sendMessage.mutateAsync({
        phoneNumber,
        message: newMessage.trim(),
        instanceName,
      });
      setNewMessage("");
    } catch (error: any) {
      toast.error(error.message || "Erro ao enviar mensagem");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
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

  // Enviar áudio
  const handleAudioRecorded = async (audioBlob: Blob) => {
    setIsRecording(false);
    
    try {
      // Converter blob para base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(audioBlob);
      });

      console.log("[Audio] Sending audio:", {
        blobType: audioBlob.type,
        blobSize: audioBlob.size,
        base64Length: base64.length,
      });

      await sendMedia.mutateAsync({
        phoneNumber,
        instanceName,
        mediaType: "audio",
        media: base64,
        mimetype: audioBlob.type || "audio/ogg",
      });
      
      toast.success("Áudio enviado!");
    } catch (error: any) {
      console.error("[Audio] Error sending:", error);
      toast.error(error.message || "Erro ao enviar áudio");
    }
  };

  // Nome do contato: priorizar lead (CRM) para evitar nomes trocados
  const contactName =
    selectedLeadName ??
    selectedContact?.lead_name ??
    selectedContact?.push_name ??
    messages.find((m) => m.push_name)?.push_name ??
    phoneNumber;

  // Estado para preview de imagem em modal
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header - Clicável para abrir painel do lead */}
      <div className="flex items-center gap-3 p-3 border-b border-border/60 bg-background shrink-0">
        <Button variant="ghost" size="icon" onClick={onBack} className="md:hidden shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        
        {/* Área clicável do contato */}
        <button
          onClick={onOpenLeadModal}
          className="flex items-center gap-3 flex-1 text-left hover:bg-muted/50 -m-2 p-2 rounded-lg transition-colors min-w-0"
        >
          <Avatar className="w-10 h-10 shrink-0 border-2 border-background shadow-sm">
            <AvatarFallback className={cn(
              "font-medium text-primary",
              hasLead ? "bg-primary/15 text-primary" : "bg-primary/10"
            )}>
              {contactName[0].toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold truncate text-foreground">{contactName}</h3>
              {!hasLead && (
                <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">
                  + Criar Lead
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground flex items-center gap-1 truncate">
              <Phone className="w-3 h-3 shrink-0" />
              {phoneNumber}
            </p>
          </div>
          <UserCircle className="w-5 h-5 text-muted-foreground shrink-0" />
        </button>

        {/* AI Toggle - sempre visível quando há lead; vendedores com acesso ao lead podem ativar/desativar o Copilot nesta conversa */}
        {hasLead && leadId && (
          <motion.div 
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors duration-200",
              currentAiDisabled ? "bg-muted/50" : "bg-primary/10"
            )}
            title="Ativar ou desativar o Copilot nesta conversa. Quem pode editar o lead pode alterar."
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <motion.div
              animate={{
                scale: toggleAIMutation.isPending ? [1, 1.2, 1] : 1,
                rotate: toggleAIMutation.isPending ? [0, 10, -10, 0] : 0,
              }}
              transition={{ 
                duration: 0.5,
                repeat: toggleAIMutation.isPending ? Infinity : 0,
              }}
            >
              <Bot className={cn(
                "w-4 h-4 transition-colors duration-200",
                currentAiDisabled ? "text-muted-foreground" : "text-primary"
              )} />
            </motion.div>
            <motion.span 
              className="text-xs text-muted-foreground hidden sm:inline"
              animate={{
                opacity: currentAiDisabled ? 0.5 : 1,
              }}
              transition={{ duration: 0.2 }}
            >
              IA
            </motion.span>
            <div onClick={(e) => e.stopPropagation()}>
              <motion.div
                animate={{
                  scale: toggleAIMutation.isPending ? 0.95 : 1,
                }}
                transition={{ duration: 0.15 }}
              >
                <Switch
                  checked={!currentAiDisabled}
                  onCheckedChange={(checked) => {
                    // Atualização otimista local imediata
                    setOptimisticAiDisabled(!checked);
                    toggleAIMutation.mutate(
                      { leadId, disabled: !checked },
                      {
                        onSuccess: () => {
                          toast.success(checked ? "IA ativada" : "IA desativada");
                          // Resetar estado otimista após sucesso
                          setOptimisticAiDisabled(null);
                        },
                        onError: () => {
                          // Reverter estado otimista em caso de erro
                          setOptimisticAiDisabled(null);
                        },
                      }
                    );
                  }}
                  disabled={toggleAIMutation.isPending}
                />
              </motion.div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Área de mensagens: altura limitada com scroll interno */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <ScrollArea className="flex-1 h-full">
          <div className="p-4 min-h-full">
            {isLoading ? (
              <div className="flex items-center justify-center min-h-[200px]">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[200px] text-center">
                <MessageSquare className="w-12 h-12 text-muted-foreground/50 mb-4" />
                <p className="text-sm text-muted-foreground">
                  Nenhuma mensagem ainda. Envie uma mensagem para iniciar a conversa.
                </p>
              </div>
            ) : (
              <div className="space-y-1 pb-4">
                {(() => {
                  let lastDate = "";
                  return messages.map((message) => {
                    const msgDate = format(new Date(message.timestamp), "dd/MM/yyyy", { locale: ptBR });
                    const showDateSeparator = msgDate !== lastDate;
                    if (showDateSeparator) lastDate = msgDate;
                    const dateLabel =
                      isToday(new Date(message.timestamp))
                        ? "Hoje"
                        : isYesterday(new Date(message.timestamp))
                          ? "Ontem"
                          : format(new Date(message.timestamp), "dd/MM/yyyy", { locale: ptBR });
                    return (
                      <div key={message.id}>
                        {showDateSeparator && (
                          <div className="flex justify-center py-3">
                            <span className="text-xs text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
                              {dateLabel}
                            </span>
                          </div>
                        )}
                        <MessageBubble
                          message={message}
                          onImagePreview={setPreviewImageUrl}
                        />
                      </div>
                    );
                  });
                })()}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </ScrollArea>
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
          <div className="flex items-center gap-2">
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
            >
              <ImageIcon className="w-5 h-5 text-muted-foreground" />
            </Button>

            {/* Input de texto */}
            <Input
              placeholder={`Bate-papo com ${contactName}: escreva uma mensagem...`}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sendMessage.isPending || sendMedia.isPending}
              className="flex-1 rounded-full border-border/60 bg-muted/30 focus:bg-background"
            />

            {/* Botão de enviar ou gravar */}
            {newMessage.trim() ? (
              <Button
                onClick={handleSend}
                disabled={sendMessage.isPending}
                size="icon"
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
    </div>
  );
}

const LAST_SEEN_KEY = "whatsapp_last_seen_";

function normalizePhoneForStorage(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10) || phone;
}

export function WhatsAppChat() {
  const queryClient = useQueryClient();
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLeadPanelOpen, setIsLeadPanelOpen] = useState(false);
  
  const { data: contacts = [], isLoading: contactsLoading } = useWhatsAppContacts();
  const { data: activeInstance, isLoading: instanceLoading } = useActiveWhatsAppInstance();
  const { data: selectedLead } = useLeadByPhone(selectedPhone);

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

  if (instanceLoading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!activeInstance) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center p-8">
        <AlertCircle className="w-16 h-16 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium mb-2">WhatsApp não conectado</h3>
        <p className="text-muted-foreground mb-4">
          Para usar o chat, você precisa ter uma instância do WhatsApp conectada.
        </p>
        <Button variant="outline" asChild>
          <a href="/configuracoes">Ir para Configurações</a>
        </Button>
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
          />
        </div>

        {/* Chat Window - min-h-0 para scroll interno na área de mensagens */}
        <div className={cn("flex-1 min-h-0 overflow-hidden flex flex-col", !selectedPhone && "hidden md:flex")}>
          {selectedPhone ? (
            <ChatWindow
              phoneNumber={selectedPhone}
              onBack={() => setSelectedPhone(null)}
              instanceName={activeInstance.instance_name}
              onOpenLeadModal={() => setIsLeadPanelOpen(true)}
              hasLead={!!(selectedLead || selectedContact?.lead_id)}
              leadId={selectedLead?.id ?? selectedContact?.lead_id ?? undefined}
              leadAiDisabled={selectedLead?.ai_disabled}
              selectedContact={selectedContact}
              selectedLeadName={selectedLead?.name}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full w-full text-center p-8">
              <MessageSquare className="w-16 h-16 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">Selecione uma conversa</h3>
              <p className="text-muted-foreground">
                Escolha um contato na lista para ver as mensagens
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Painel lateral (abre/fecha) com dados do cliente e etapas/funis */}
      {selectedPhone && (
        <Sheet open={isLeadPanelOpen} onOpenChange={setIsLeadPanelOpen}>
          <SheetContent
            side="right"
            className="sm:max-w-md w-full flex flex-col overflow-hidden"
          >
            <LeadDetailContent
              phoneNumber={selectedPhone}
              pushName={selectedContact?.push_name}
              onClose={() => setIsLeadPanelOpen(false)}
              showHeader={true}
            />
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
