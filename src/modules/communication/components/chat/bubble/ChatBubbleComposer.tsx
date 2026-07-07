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
 *
 * Anexos: mesma paridade do composer desktop (imagem, vídeo, PDF/documentos) —
 * accept/teto/derivação vêm de `lib/attachment-media-type`.
 */
import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Film, FileText, Mic, Paperclip, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  useSendWhatsAppMessage,
  useSendWhatsAppMedia,
} from "@/modules/communication/hooks/chat/useWhatsAppSend";
import {
  deriveAttachmentMediaType,
  getAttachmentValidationError,
  ATTACHMENT_ACCEPT,
} from "@/modules/communication/lib/attachment-media-type";
import { AudioRecorder } from "@/modules/communication/components/chat/media/AudioRecorder";

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
  // Anexo pendente — imagem mostra thumbnail; documento/vídeo mostram chip.
  const [attachment, setAttachment] = useState<{ data: string; name: string; mime: string } | null>(null);
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
    const validationError = getAttachmentValidationError(file);
    if (validationError) {
      toast({
        title: "Anexo inválido",
        description: validationError,
        variant: "destructive",
      });
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result as string;
      setAttachment({ data, name: file.name, mime: file.type });
    };
    reader.onerror = () => {
      toast({
        title: "Erro ao ler arquivo",
        description: "Não foi possível ler o arquivo selecionado. Tente novamente.",
        variant: "destructive",
      });
    };
    reader.readAsDataURL(file);
    e.target.value = ""; // permite re-selecionar mesmo arquivo
  };

  const handleSendAttachment = async () => {
    if (!attachment || isSending) return;
    const kind = deriveAttachmentMediaType(attachment.mime);
    try {
      await sendMedia.mutateAsync({
        phoneNumber,
        instanceName,
        instanceId,
        mediaType: kind,
        media: attachment.data,
        caption: trimmed || undefined,
        fileName: attachment.name,
        mimetype: attachment.mime,
        leadId,
      });
      // Limpa só no sucesso — em falha o preview fica intacto pra retry
      // (mesmo contrato do composer desktop).
      setAttachment(null);
      setText("");
      toast({
        title:
          kind === "document" ? "Arquivo enviado!"
            : kind === "video" ? "Vídeo enviado!"
            : "Imagem enviada!",
      });
    } catch (err) {
      toast({
        title: "Falha ao enviar arquivo",
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

  // ── Preview do anexo antes de enviar — imagem mostra thumbnail,
  //    documento/vídeo mostram chip com ícone + nome. ─────────────────────────
  if (attachment) {
    const kind = deriveAttachmentMediaType(attachment.mime);
    const KindIcon = kind === "video" ? Film : FileText;
    return (
      <div className="border-t border-border/40 bg-popover/95">
        <div className="px-3 pt-3 pb-2 flex items-start gap-2">
          {kind === "image" ? (
            <img
              src={attachment.data}
              alt={attachment.name}
              className="w-16 h-16 rounded-lg object-cover border border-border"
            />
          ) : (
            <div className="w-16 h-16 shrink-0 rounded-lg bg-muted flex items-center justify-center border border-border">
              <KindIcon className="w-6 h-6 text-muted-foreground" aria-hidden />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground truncate" title={attachment.name}>
              {attachment.name}
            </p>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Adicione uma legenda (opcional)"
              aria-label="Legenda do anexo"
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
              setAttachment(null);
              setText("");
            }}
            disabled={isSending}
          >
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSendAttachment} disabled={isSending}>
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
        accept={ATTACHMENT_ACCEPT}
        data-testid="bubble-file-input"
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
        aria-label="Anexar arquivo"
        title="Anexar imagem, vídeo ou documento"
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
