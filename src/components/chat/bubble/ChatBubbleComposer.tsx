/**
 * ChatBubbleComposer — composer compact próprio para o Bubble (380×).
 *
 * Convenção mic↔send (WhatsApp Web):
 *   textarea vazio → mic (ghost / muted)
 *   textarea com texto → send (gradient gold via primary)
 *   recording → stop (destructive)
 *
 * Reusa hooks de envio do /chat (useSendWhatsAppMessage / useSendWhatsAppMedia)
 * e o componente AudioRecorder. UI é toda própria.
 */
import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Mic, Paperclip, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  useSendWhatsAppMessage,
  useSendWhatsAppMedia,
} from "@/hooks/chat/useWhatsAppSend";
import { AudioRecorder } from "@/components/chat/media/AudioRecorder";

interface ChatBubbleComposerProps {
  phoneNumber: string;
  instanceId: string;
  instanceName: string;
  /** Se false, composer não renderiza — caller deve mostrar PermissionBanner. */
  canReply: boolean;
  /** Lead vinculado à conversa — encaminhado ao backend p/ vínculo strict. */
  leadId?: string | null;
}

export function ChatBubbleComposer({
  phoneNumber,
  instanceId,
  instanceName,
  canReply,
  leadId,
}: ChatBubbleComposerProps) {
  const [text, setText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [imagePreview, setImagePreview] = useState<{ data: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const sendMessage = useSendWhatsAppMessage();
  const sendMedia = useSendWhatsAppMedia();

  if (!canReply) return null;

  const trimmed = text.trim();
  const hasText = trimmed.length > 0;
  const isSending = sendMessage.isPending || sendMedia.isPending;

  const handleSend = async () => {
    if (!hasText || isSending) return;
    const message = trimmed;
    setText("");
    try {
      await sendMessage.mutateAsync({
        phoneNumber,
        message,
        instanceName,
        instanceId,
        leadId,
      });
    } catch (err) {
      toast({
        title: "Falha ao enviar",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Formato não suportado",
        description: "Selecione uma imagem (PNG, JPG, etc).",
        variant: "destructive",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result as string;
      setImagePreview({ data, name: file.name });
    };
    reader.readAsDataURL(file);
    e.target.value = ""; // permite re-selecionar mesma imagem
  };

  const handleSendImage = async () => {
    if (!imagePreview || isSending) return;
    const captionText = trimmed;
    const preview = imagePreview;
    setImagePreview(null);
    setText("");
    try {
      await sendMedia.mutateAsync({
        phoneNumber,
        instanceName,
        instanceId,
        mediaType: "image",
        media: preview.data,
        caption: captionText || undefined,
        fileName: preview.name,
        leadId,
      });
    } catch (err) {
      toast({
        title: "Falha ao enviar imagem",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const handleAudioRecorded = async (blob: Blob) => {
    setIsRecording(false);
    try {
      const reader = new FileReader();
      const dataUrl: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      await sendMedia.mutateAsync({
        phoneNumber,
        instanceName,
        instanceId,
        mediaType: "audio",
        media: dataUrl,
        fileName: `audio_${Date.now()}.mp3`,
        leadId,
      });
    } catch (err) {
      toast({
        title: "Falha ao enviar áudio",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    }
  };

  // ── Recording ─────────────────────────────────────────────────────────────
  if (isRecording) {
    return (
      <div className="px-3 py-2 border-t border-border/40 bg-popover/95">
        <AudioRecorder
          onRecorded={handleAudioRecorded}
          onCancel={() => setIsRecording(false)}
        />
      </div>
    );
  }

  // ── Image preview antes de enviar ─────────────────────────────────────────
  if (imagePreview) {
    return (
      <div className="border-t border-border/40 bg-popover/95">
        <div className="px-3 pt-3 pb-2 flex items-start gap-2">
          <img
            src={imagePreview.data}
            alt={imagePreview.name}
            className="w-16 h-16 rounded-lg object-cover border border-border"
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground truncate">{imagePreview.name}</p>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Adicione uma legenda (opcional)"
              aria-label="Legenda da imagem"
              rows={1}
              className="mt-1 min-h-[32px] max-h-[80px] py-1 px-2 resize-none border-0 bg-muted/40 text-xs rounded-md focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-3 pb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setImagePreview(null);
              setText("");
            }}
            disabled={isSending}
          >
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSendImage} disabled={isSending}>
            {isSending ? "Enviando…" : "Enviar"}
          </Button>
        </div>
      </div>
    );
  }

  // ── Default composer ──────────────────────────────────────────────────────
  return (
    <div className="flex items-end gap-1.5 px-3 py-2 border-t border-border/40 bg-popover/95">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        hidden
        aria-hidden
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => fileInputRef.current?.click()}
        disabled={isSending}
        aria-label="Anexar imagem"
      >
        <Paperclip className="w-4 h-4" aria-hidden />
      </Button>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Mensagem"
        aria-label="Mensagem"
        rows={1}
        disabled={isSending}
        className="
          flex-1 min-h-[36px] max-h-[120px] py-2 px-3
          resize-none border-0 bg-muted/40
          text-sm placeholder:text-muted-foreground/60
          rounded-xl
          focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0
        "
      />

      {hasText ? (
        <Button
          type="button"
          variant="default"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-full"
          onClick={handleSend}
          disabled={isSending}
          aria-label="Enviar mensagem"
        >
          <Send className="w-4 h-4" aria-hidden />
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
          onClick={() => setIsRecording(true)}
          disabled={isSending}
          aria-label="Gravar áudio"
        >
          <Mic className="w-4 h-4" aria-hidden />
        </Button>
      )}
    </div>
  );
}
