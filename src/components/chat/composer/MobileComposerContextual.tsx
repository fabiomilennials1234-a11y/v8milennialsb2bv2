/**
 * MobileComposerContextual — WhatsApp-style contextual composer for mobile.
 *
 * State machine:
 * - IDLE: [+] [input] [mic]
 * - TYPING: [+] [input] [send]
 * - RECORDING: AudioRecorder inline
 * - TRAY_OPEN: action tray above composer
 *
 * Replaces ChatComposer + ChatQuickActions on mobile surfaces.
 */
import { useRef, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Send, Mic, Camera, Paperclip, FileText, Clock, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useConversationDraft } from "@/hooks/useConversationDraft";
import { useSendWhatsAppMessage, useSendWhatsAppMedia } from "@/hooks/chat/useWhatsAppSend";
import { useKeyboardOffset } from "@/hooks/use-keyboard-offset";
import { AudioRecorder } from "@/components/chat/media/AudioRecorder";
import { ScheduleMessageModal } from "@/components/chat/ScheduleMessageModal";
import { convertAudioBlobToMp3 } from "@/lib/audioToMp3";

// ─── Types ────────────────────────────────────────────────────────────────────

type ComposerState = "IDLE" | "TYPING" | "RECORDING" | "TRAY_OPEN";

export interface MobileComposerContextualProps {
  conversationKey: string;
  phoneNumber: string;
  contactName: string;
  instanceName: string;
  instanceId: string;
  leadId?: string;
  canReply: boolean;
  selectedContact?: {
    push_name: string | null;
    lead_name: string | null;
    phone_number: string;
    lead_id: string | null;
  } | null;
}

// ─── Tray items ───────────────────────────────────────────────────────────────

const TRAY_ITEMS = [
  { id: "camera", icon: Camera, label: "Camera" },
  { id: "file", icon: Paperclip, label: "Arquivo" },
  { id: "template", icon: FileText, label: "Template" },
  { id: "schedule", icon: Clock, label: "Agendar" },
] as const;

type TrayAction = typeof TRAY_ITEMS[number]["id"];

// ─── Component ────────────────────────────────────────────────────────────────

export function MobileComposerContextual({
  conversationKey,
  phoneNumber,
  contactName,
  instanceName,
  instanceId,
  leadId,
  canReply,
  selectedContact,
}: MobileComposerContextualProps) {
  const { user } = useAuth();
  const { draft: message, setDraft: setMessage } = useConversationDraft(conversationKey, user?.id);
  const { offset } = useKeyboardOffset();

  const sendMessage = useSendWhatsAppMessage();
  const sendMedia = useSendWhatsAppMedia();

  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isSending = sendMessage.isPending || sendMedia.isPending;
  const hasText = message.trim().length > 0;

  // Derived state machine
  const state: ComposerState = isRecording
    ? "RECORDING"
    : trayOpen
      ? "TRAY_OPEN"
      : hasText
        ? "TYPING"
        : "IDLE";

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    if (!message.trim() || !instanceName) return;
    try {
      await sendMessage.mutateAsync({
        phoneNumber,
        message: message.trim(),
        instanceName,
        instanceId,
        leadId,
      });
      setMessage("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar");
    }
  }, [message, instanceName, phoneNumber, instanceId, leadId, sendMessage, setMessage]);

  const handleAudioRecorded = useCallback(async (audioBlob: Blob) => {
    setIsRecording(false);
    try {
      const mp3 = await convertAudioBlobToMp3(audioBlob);
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(mp3);
      });
      await sendMedia.mutateAsync({
        phoneNumber,
        instanceName,
        instanceId,
        mediaType: "audio",
        media: base64,
        mimetype: "audio/mpeg",
      });
      toast.success("Audio enviado!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar audio");
    }
  }, [phoneNumber, instanceName, instanceId, sendMedia]);

  const handleFileSelected = useCallback(async (file: File) => {
    setTrayOpen(false);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      const mediaType = isImage ? "image" : isVideo ? "video" : "document";
      await sendMedia.mutateAsync({
        phoneNumber,
        instanceName,
        instanceId,
        mediaType,
        media: base64,
        fileName: file.name,
        mimetype: file.type,
      });
      toast.success("Arquivo enviado!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar arquivo");
    }
  }, [phoneNumber, instanceName, instanceId, sendMedia]);

  const handleTrayAction = useCallback((action: TrayAction) => {
    switch (action) {
      case "camera":
        cameraInputRef.current?.click();
        break;
      case "file":
        fileInputRef.current?.click();
        break;
      case "template":
        setTrayOpen(false);
        setMessage("/");
        inputRef.current?.focus();
        break;
      case "schedule":
        setTrayOpen(false);
        setScheduleModalOpen(true);
        break;
    }
  }, [setMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (!canReply) {
    return (
      <div className="p-3 border-t border-border/60 bg-background" style={{ paddingBottom: offset || undefined }}>
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          <X className="w-4 h-4 shrink-0" />
          <span>Sem permissao para responder neste chat.</span>
        </div>
      </div>
    );
  }

  if (state === "RECORDING") {
    return (
      <div className="p-3 border-t border-border/60 bg-background" style={{ paddingBottom: offset || undefined }}>
        <AudioRecorder
          onRecorded={handleAudioRecorded}
          onCancel={() => setIsRecording(false)}
        />
      </div>
    );
  }

  return (
    <div
      className="border-t border-border/60 bg-background shrink-0"
      style={{ paddingBottom: offset || undefined }}
    >
      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*,video/*"
        capture="environment"
        onChange={(e) => e.target.files?.[0] && handleFileSelected(e.target.files[0])}
        className="hidden"
        aria-hidden="true"
      />
      <input
        ref={fileInputRef}
        type="file"
        onChange={(e) => e.target.files?.[0] && handleFileSelected(e.target.files[0])}
        className="hidden"
        aria-hidden="true"
      />

      {/* Action tray */}
      <AnimatePresence>
        {trayOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden border-b border-border/40"
            data-testid="action-tray"
          >
            <div className="flex items-center justify-around px-4 py-3">
              {TRAY_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleTrayAction(item.id)}
                  aria-label={item.label}
                  className={cn(
                    "flex flex-col items-center gap-1 min-w-[56px] min-h-[56px]",
                    "rounded-xl p-2 text-muted-foreground",
                    "active:bg-muted/60 transition-colors",
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="text-[10px]">{item.label}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Composer row */}
      <div className="flex items-center gap-2 p-3">
        {/* Plus / close tray toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTrayOpen((v) => !v)}
          aria-label={trayOpen ? "Fechar acoes" : "Abrir acoes"}
          className="shrink-0"
        >
          <Plus
            className={cn(
              "w-5 h-5 transition-transform duration-200",
              trayOpen && "rotate-45",
            )}
          />
        </Button>

        {/* Text input */}
        <Input
          ref={inputRef}
          placeholder={`Mensagem para ${contactName}...`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isSending}
          aria-label={`Mensagem para ${contactName}`}
          className="flex-1 rounded-full border border-border/60 bg-background"
        />

        {/* Mic or Send */}
        {hasText ? (
          <Button
            onClick={handleSend}
            disabled={isSending}
            size="icon"
            aria-label="Enviar mensagem"
            className="gradient-primary text-white border-0 shrink-0"
          >
            {isSending ? (
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
            disabled={isSending}
            aria-label="Gravar audio"
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
          >
            <Mic className="w-5 h-5 text-muted-foreground" />
          </Button>
        )}
      </div>

      {/* Schedule modal */}
      {selectedContact && (
        <ScheduleMessageModal
          open={scheduleModalOpen}
          onOpenChange={setScheduleModalOpen}
          leadId={selectedContact.lead_id || ""}
          leadName={selectedContact.lead_name || selectedContact.push_name || selectedContact.phone_number}
          phoneNumber={selectedContact.phone_number}
          instanceId={instanceId}
          initialMessage={message}
        />
      )}
    </div>
  );
}
