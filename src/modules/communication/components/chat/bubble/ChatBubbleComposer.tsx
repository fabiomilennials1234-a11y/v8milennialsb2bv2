import { readMediaAsDataUrl } from "@/modules/communication/lib/media-operation";
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
 *
 * Envio: SEM trava própria. Texto, anexo e áudio entram na fila da conversa
 * (`shared/filaDeEnvio`), que garante ordem e um em voo; o desfecho é o mesmo
 * do /chat (`tratarFalhaDoEnvio`): fila cheia devolve o rascunho, item
 * interrompido não gera toast (a bolha de falha já diz).
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
import { notifyError } from "@/shared/errors";
import { ComposerEmojiPicker } from "../composer/ComposerEmojiPicker";
import { tratarFalhaDoEnvio } from "../composer/tratarFalhaDoEnvio";

interface ChatBubbleComposerProps {
  phoneNumber: string;
  /** Conversa de grupo: o envio vai para o JID `<id>@g.us`, não para um telefone. */
  isGroup?: boolean;
  instanceId: string;
  instanceName: string;
  /** Se false, composer não renderiza — caller deve mostrar PermissionBanner. */
  canReply: boolean;
  /** Lead vinculado à conversa — encaminhado ao backend p/ vínculo strict. */
  leadId?: string | null;
}

export function ChatBubbleComposer({
  phoneNumber,
  isGroup = false,
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  const sendMessage = useSendWhatsAppMessage();
  const sendMedia = useSendWhatsAppMedia();
  // Rascunho/anexo atuais, para a devolução pós-"fila cheia" não pisar no novo.
  const textRef = useRef(text);
  textRef.current = text;
  const attachmentRef = useRef(attachment);
  attachmentRef.current = attachment;

  if (!canReply) return null;

  const trimmed = text.trim();
  const hasText = trimmed.length > 0;

  const handleSend = async () => {
    if (!hasText) return;
    const message = trimmed;
    // Limpa antes do await: quem digita a próxima não perde texto no resolve.
    setText("");
    textRef.current = "";
    try {
      await sendMessage.mutateAsync({
        phoneNumber,
        isGroup,
        message,
        instanceName,
        instanceId,
        leadId,
      });
    } catch (err) {
      tratarFalhaDoEnvio(err, "Não foi possível enviar.", () => {
        if (textRef.current === "") setText(message);
      });
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
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
    const input = e.target;
    try {
      const data = await readMediaAsDataUrl(file);
      setAttachment({ data, name: file.name, mime: file.type });
    } catch (error) {
      notifyError(error, { fallback: "Não foi possível ler o arquivo." });
    }
    input.value = ""; // permite re-selecionar mesmo arquivo
  };

  const handleSendAttachment = async () => {
    if (!attachment) return;
    const enviado = attachment;
    const legenda = text;
    const kind = deriveAttachmentMediaType(enviado.mime);
    // O anexo sai do composer no clique (contrato do /chat): duplo clique não
    // duplica, e a falha vira bolha de reenvio na conversa. Só "fila cheia"
    // — o item nem entrou — devolve anexo e legenda.
    setAttachment(null);
    setText("");
    attachmentRef.current = null;
    textRef.current = "";
    try {
      await sendMedia.mutateAsync({
        phoneNumber,
        isGroup,
        instanceName,
        instanceId,
        mediaType: kind,
        media: enviado.data,
        caption: legenda.trim() || undefined,
        fileName: enviado.name,
        mimetype: enviado.mime,
        leadId,
      });
      toast({
        title:
          kind === "document" ? "Arquivo enviado!"
            : kind === "video" ? "Vídeo enviado!"
            : "Imagem enviada!",
      });
    } catch (err) {
      tratarFalhaDoEnvio(err, "Não foi possível enviar arquivo.", () => {
        if (attachmentRef.current) return;
        setAttachment(enviado);
        if (textRef.current === "") setText(legenda);
      });
    }
  };

  const handleAudioRecorded = async (blob: Blob) => {
    setIsRecording(false);
    try {
      await sendMedia.mutateAsync({
        phoneNumber,
        isGroup,
        instanceName,
        instanceId,
        mediaType: "audio",
        // Leitura na vez do item: a ordem é a do clique de parar a gravação.
        media: { previa: null, preparar: () => readMediaAsDataUrl(blob) },
        fileName: `audio_${Date.now()}.mp3`,
        leadId,
      });
    } catch (err) {
      tratarFalhaDoEnvio(err, "Não foi possível enviar áudio.");
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
              ref={inputRef}
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
          <ComposerEmojiPicker inputRef={inputRef} onChange={setText} className="mr-auto" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAttachment(null);
              setText("");
            }}
          >
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSendAttachment}>
            Enviar
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
        aria-label="Anexar arquivo"
        title="Anexar imagem, vídeo ou documento"
      >
        <Paperclip className="w-4 h-4" aria-hidden />
      </Button>

      <ComposerEmojiPicker key={`${instanceId}:${phoneNumber}`} inputRef={inputRef} onChange={setText} className="h-9 w-9" />
      <Textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Mensagem"
        aria-label="Mensagem"
        rows={1}
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
          aria-label="Gravar áudio"
        >
          <Mic className="w-4 h-4" aria-hidden />
        </Button>
      )}
    </div>
  );
}
