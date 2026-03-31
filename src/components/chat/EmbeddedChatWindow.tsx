/**
 * EmbeddedChatWindow — compact WhatsApp chat for embedding inside modals/drawers.
 *
 * Reuses the same hooks and shared components from the main WhatsAppChat,
 * avoiding any duplication of messaging logic. Renders messages + input area
 * in a compact layout suited for the lead detail modal.
 */

import { useState, useRef, useEffect } from "react";
import {
  Send,
  Loader2,
  MessageSquare,
  Image as ImageIcon,
  Mic,
  Clock,
  X,
  AlertCircle,
  Phone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useWhatsAppMessages,
  useSendWhatsAppMessage,
  useSendWhatsAppMedia,
  useWhatsAppMessagesRealtime,
  useWhatsAppInstancesForUser,
} from "@/hooks/useWhatsAppChat";
import { useCanReplyOnInstanceByName } from "@/hooks/useWhatsAppInstanceAllowedMembers";
import { convertAudioBlobToMp3, preloadLamejs } from "@/lib/audioToMp3";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { formatPhoneForWhatsApp } from "@/lib/whatsapp";
import {
  MessageBubble,
  AudioRecorder,
  ImagePreviewModal,
  MessagesAreaErrorBoundary,
} from "./WhatsAppChat";
import { ScheduleMessageModal } from "./ScheduleMessageModal";

interface EmbeddedChatWindowProps {
  leadId: string;
  leadPhone: string;
  leadName?: string;
}

/**
 * Resolve the WhatsApp instance for a lead by finding the most recent message's instance,
 * falling back to the user's first available instance.
 */
function useLeadWhatsAppInstance(leadPhone: string) {
  const normalizedPhone = formatPhoneForWhatsApp(leadPhone) || leadPhone?.replace(/\D/g, "") || "";
  const { data: userInstances = [], isLoading: instancesLoading } = useWhatsAppInstancesForUser();

  const { data: messageInstance, isLoading: messageInstanceLoading } = useQuery({
    queryKey: ["lead-whatsapp-instance", normalizedPhone],
    queryFn: async () => {
      if (!normalizedPhone) return null;
      // Find the most recent message for this phone to determine instance
      const { data } = await supabase
        .from("whatsapp_messages")
        .select("instance_id")
        .eq("phone_number", normalizedPhone)
        .order("timestamp", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data?.instance_id) return null;
      // Get instance details
      const { data: instance } = await supabase
        .from("whatsapp_instances")
        .select("id, instance_name, status")
        .eq("id", data.instance_id)
        .maybeSingle();
      return instance;
    },
    enabled: !!normalizedPhone,
  });

  // Prefer the instance from actual messages, fallback to user's first instance
  const resolvedInstance = messageInstance
    ? { id: messageInstance.id, instanceName: messageInstance.instance_name }
    : userInstances.length > 0
      ? { id: userInstances[0].id, instanceName: userInstances[0].instance_name }
      : null;

  return {
    instance: resolvedInstance,
    phoneNumber: normalizedPhone,
    isLoading: instancesLoading || messageInstanceLoading,
    hasNoInstance: !instancesLoading && !messageInstanceLoading && !resolvedInstance,
  };
}

export function EmbeddedChatWindow({ leadId, leadPhone, leadName }: EmbeddedChatWindowProps) {
  const { instance, phoneNumber, isLoading: instanceLoading, hasNoInstance } = useLeadWhatsAppInstance(leadPhone);

  if (instanceLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (hasNoInstance || !instance) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Phone className="w-10 h-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm font-medium text-muted-foreground mb-1">
          Nenhuma instância de WhatsApp disponível
        </p>
        <p className="text-xs text-muted-foreground/70 max-w-sm">
          Para conversar com este lead, conecte uma instância de WhatsApp nas configurações.
        </p>
      </div>
    );
  }

  return (
    <EmbeddedChatContent
      phoneNumber={phoneNumber}
      instanceId={instance.id}
      instanceName={instance.instanceName}
      leadId={leadId}
      leadName={leadName}
    />
  );
}

function EmbeddedChatContent({
  phoneNumber,
  instanceId,
  instanceName,
  leadId,
  leadName,
}: {
  phoneNumber: string;
  instanceId: string;
  instanceName: string;
  leadId: string;
  leadName?: string;
}) {
  const [newMessage, setNewMessage] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imageCaption, setImageCaption] = useState("");
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { preloadLamejs(); }, []);

  const { data: messages = [], isLoading } = useWhatsAppMessages(phoneNumber, instanceId);
  const sendMessage = useSendWhatsAppMessage();
  const sendMedia = useSendWhatsAppMedia();
  const { canReply } = useCanReplyOnInstanceByName(instanceName);

  // Realtime
  useWhatsAppMessagesRealtime(phoneNumber);

  // Auto-scroll
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
        instanceId,
      });
      setNewMessage("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao enviar mensagem");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) { toast.error("Selecione apenas imagens"); return; }
      if (file.size > 10 * 1024 * 1024) { toast.error("Imagem muito grande (máximo 10MB)"); return; }
      setSelectedImage(file);
      const reader = new FileReader();
      reader.onload = (e) => setImagePreview(e.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSendImage = async () => {
    if (!selectedImage || !instanceName) return;
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(selectedImage);
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao enviar imagem");
    }
  };

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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao enviar áudio");
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Messages area */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <ScrollArea className="flex-1 h-full">
          <div className="p-3 min-h-full">
            <MessagesAreaErrorBoundary>
              {isLoading ? (
                <div className="flex items-center justify-center min-h-[150px]">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center min-h-[150px] text-center">
                  <MessageSquare className="w-8 h-8 text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground/60">
                    Nenhuma mensagem ainda
                  </p>
                </div>
              ) : (
                <div className="space-y-1 pb-2">
                  {(() => {
                    let lastDate = "";
                    return messages.map((message, index) => {
                      const ts = message?.timestamp;
                      const date = ts ? new Date(ts) : new Date();
                      const validDate = !Number.isNaN(date.getTime());
                      const msgDate = validDate ? format(date, "dd/MM/yyyy", { locale: ptBR }) : "";
                      const showDateSeparator = msgDate !== lastDate;
                      if (showDateSeparator) lastDate = msgDate;
                      const dateLabel = validDate
                        ? isToday(date) ? "Hoje" : isYesterday(date) ? "Ontem" : format(date, "dd/MM/yyyy", { locale: ptBR })
                        : "";
                      const safeKey = message?.id || `msg-${index}-${ts || index}`;
                      return (
                        <div key={safeKey}>
                          {showDateSeparator && (
                            <div className="flex justify-center py-2">
                              <span className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground/40 bg-muted/30 px-2.5 py-0.5 rounded-full">
                                {dateLabel}
                              </span>
                            </div>
                          )}
                          <MessageBubble message={message} onImagePreview={setPreviewImageUrl} />
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
      </div>

      {/* Image preview for sending */}
      {selectedImage && imagePreview && (
        <div className="p-3 border-t bg-muted/30 shrink-0">
          <div className="flex items-start gap-3">
            <div className="relative">
              <img src={imagePreview} alt="Preview" className="w-16 h-16 object-cover rounded-lg" />
              <button
                onClick={() => { setSelectedImage(null); setImagePreview(null); setImageCaption(""); }}
                className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="flex-1 space-y-2">
              <Input placeholder="Legenda (opcional)..." value={imageCaption} onChange={(e) => setImageCaption(e.target.value)} className="h-8 text-sm" />
              <Button onClick={handleSendImage} disabled={sendMedia.isPending} size="sm" className="w-full">
                {sendMedia.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
                Enviar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="p-2 border-t border-border/60 bg-background shrink-0">
        {!canReply ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Você não tem permissão para responder neste número.</span>
          </div>
        ) : isRecording ? (
          <AudioRecorder onRecorded={handleAudioRecorded} onCancel={() => setIsRecording(false)} />
        ) : (
          <div className="flex items-center gap-1.5">
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
            <Button variant="ghost" size="icon" className="h-8 w-8 opacity-50 hover:opacity-100" onClick={() => fileInputRef.current?.click()} disabled={sendMessage.isPending || sendMedia.isPending}>
              <ImageIcon className="w-4 h-4 text-muted-foreground" />
            </Button>
            <Input
              placeholder="Mensagem..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sendMessage.isPending || sendMedia.isPending}
              className="flex-1 h-8 text-sm rounded-full border border-border/60 bg-background focus:ring-1 focus:ring-primary/30"
            />
            <Button variant="ghost" size="icon" className="h-8 w-8 opacity-50 hover:opacity-100 hover:text-primary" onClick={() => setScheduleModalOpen(true)} title="Agendar mensagem">
              <Clock className="w-3.5 h-3.5" />
            </Button>
            {newMessage.trim() ? (
              <Button onClick={handleSend} disabled={sendMessage.isPending} size="icon" className="h-8 w-8 gradient-primary text-white border-0">
                {sendMessage.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </Button>
            ) : (
              <Button variant="ghost" size="icon" className="h-8 w-8 opacity-50 hover:opacity-100" onClick={() => setIsRecording(true)} disabled={sendMedia.isPending}>
                <Mic className="w-4 h-4 text-muted-foreground" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Image preview modal */}
      <ImagePreviewModal imageUrl={previewImageUrl} isOpen={!!previewImageUrl} onClose={() => setPreviewImageUrl(null)} />

      {/* Schedule message modal */}
      <ScheduleMessageModal
        open={scheduleModalOpen}
        onOpenChange={(v) => { setScheduleModalOpen(v); if (!v) setNewMessage(""); }}
        leadId={leadId}
        leadName={leadName || phoneNumber}
        phoneNumber={phoneNumber}
        instanceId={instanceId}
        initialMessage={newMessage}
      />
    </div>
  );
}
