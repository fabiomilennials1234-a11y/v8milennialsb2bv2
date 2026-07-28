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
import { useRef, useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Send, Mic, Camera, Paperclip, FileText, Film, Clock, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth, useCurrentTeamMember } from "@/modules/identity";
import { useConversationDraft } from "@/modules/communication/hooks/useConversationDraft";
import { useSendWhatsAppMessage, useSendWhatsAppMedia } from "@/modules/communication/hooks/chat/useWhatsAppSend";
import { useMessageTemplates } from "@/modules/communication/hooks/useMessageTemplates";
import { useKeyboardOffset } from "@/shared/hooks/use-keyboard-offset";
import { AudioRecorder } from "@/modules/communication/components/chat/media/AudioRecorder";
import { ScheduleMessageModal } from "@/modules/communication/components/chat/ScheduleMessageModal";
import { SlashCommandPopover } from "@/modules/communication/components/chat/SlashCommandPopover";
import { resolveVariables } from "@/lib/template-variables";
import { convertAudioBlobToMp3 } from "@/modules/communication/lib/audioToMp3";
import {
  deriveAttachmentMediaType,
  getAttachmentValidationError,
  ATTACHMENT_ACCEPT,
} from "@/modules/communication/lib/attachment-media-type";
import type { LeadContext, AttendantContext } from "@/lib/template-variables";
import type { MessageTemplate } from "@/modules/communication/hooks/useMessageTemplates";

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
  { id: "camera", icon: Camera, label: "Câmera" },
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
  const { data: teamMember } = useCurrentTeamMember();
  const { draft: message, setDraft: setMessage } = useConversationDraft(conversationKey, user?.id);
  const { offset } = useKeyboardOffset();

  const sendMessage = useSendWhatsAppMessage();
  const sendMedia = useSendWhatsAppMedia();

  const { data: templates } = useMessageTemplates();

  // Dados do lead para resolução de variáveis de template
  const { data: leadForTemplates } = useQuery({
    queryKey: ["lead-for-templates", leadId],
    queryFn: async () => {
      if (!leadId) return null;
      const { data } = await supabase
        .from("leads")
        .select("name, company, email, phone, origin, interest, segment, utm_campaign")
        .eq("id", leadId)
        .maybeSingle();
      return data;
    },
    enabled: !!leadId,
    staleTime: 1000 * 60 * 5,
  });

  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [showSlashPopover, setShowSlashPopover] = useState(false);
  // Anexo pendente de confirmação — imagem mostra thumbnail; doc/vídeo, chip.
  const [pendingAttachment, setPendingAttachment] =
    useState<{ data: string; name: string; mime: string } | null>(null);
  const [attachmentCaption, setAttachmentCaption] = useState("");

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
        leadId: leadId ?? null,
      });
      toast.success("Áudio enviado!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar áudio");
    }
  }, [phoneNumber, instanceName, instanceId, sendMedia, leadId]);

  const handleFileSelected = useCallback(async (file: File) => {
    setTrayOpen(false);
    if (isSending) {
      toast.info("Aguarde o envio anterior finalizar.");
      return;
    }
    const validationError = getAttachmentValidationError(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      // Preview antes de enviar (paridade desktop/bubble) — mis-tap no picker
      // não dispara mais o arquivo direto pro cliente.
      setPendingAttachment({ data: base64, name: file.name, mime: file.type });
      setAttachmentCaption("");
    } catch {
      toast.error("Erro ao ler arquivo. Tente novamente.");
    }
  }, [isSending]);

  const clearPendingAttachment = useCallback(() => {
    setPendingAttachment(null);
    setAttachmentCaption("");
  }, []);

  const handleSendAttachment = useCallback(async () => {
    if (!pendingAttachment || isSending) return;
    const kind = deriveAttachmentMediaType(pendingAttachment.mime);
    try {
      await sendMedia.mutateAsync({
        phoneNumber,
        instanceName,
        instanceId,
        mediaType: kind,
        media: pendingAttachment.data,
        caption: attachmentCaption.trim() || undefined,
        fileName: pendingAttachment.name,
        mimetype: pendingAttachment.mime,
        leadId: leadId ?? null,
      });
      // Limpa só no sucesso — em falha o preview fica pra retry.
      clearPendingAttachment();
      toast.success(
        kind === "document" ? "Arquivo enviado!"
          : kind === "video" ? "Vídeo enviado!"
          : "Imagem enviada!",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar arquivo");
    }
  }, [pendingAttachment, attachmentCaption, isSending, phoneNumber, instanceName, instanceId, leadId, sendMedia, clearPendingAttachment]);

  const handleSlashSelect = useCallback(async (template: MessageTemplate) => {
    const leadCtx: LeadContext = {
      name: leadForTemplates?.name ?? selectedContact?.lead_name ?? selectedContact?.push_name ?? undefined,
      company: leadForTemplates?.company ?? undefined,
      email: leadForTemplates?.email ?? undefined,
      phone: leadForTemplates?.phone ?? phoneNumber ?? undefined,
      // LeadContext.source/campaign_name são nomes do view-model de template;
      // as colunas reais são leads.origin e leads.utm_campaign.
      source: leadForTemplates?.origin ?? undefined,
      interest: leadForTemplates?.interest ?? undefined,
      segment: leadForTemplates?.segment ?? undefined,
      campaign_name: leadForTemplates?.utm_campaign ?? undefined,
    };
    const attendantCtx: AttendantContext = { name: teamMember?.name ?? undefined };
    const resolved = resolveVariables(template.body, leadCtx, attendantCtx);
    setShowSlashPopover(false);

    // Template com mídia → envia direto (o corpo resolvido vira caption).
    if (template.media_url && template.media_type !== "text") {
      if (!instanceName) return;
      try {
        await sendMedia.mutateAsync({
          phoneNumber,
          instanceName,
          instanceId,
          mediaType: template.media_type,
          media: template.media_url,
          caption: template.media_type === "audio" ? undefined : (resolved || undefined),
          leadId: leadId ?? null,
        });
        setMessage("");
        toast.success("Template enviado!");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao enviar template");
      }
      return;
    }

    // Template de texto → preenche input para revisão antes de enviar.
    setMessage(resolved);
    inputRef.current?.focus();
  }, [leadForTemplates, selectedContact, phoneNumber, instanceName, instanceId, leadId, teamMember, sendMedia, setMessage]);

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
        setShowSlashPopover(true);
        inputRef.current?.focus();
        break;
      case "schedule":
        setTrayOpen(false);
        setScheduleModalOpen(true);
        break;
    }
  }, [setMessage]);

  // Auto-resize do textarea (cresce até ~5 linhas, depois rola).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [message]);

  // No mobile o Enter insere nova linha (comportamento nativo do textarea, igual
  // WhatsApp) — o envio é só pelo botão. Sem onKeyDown de envio.

  // ─── Render ───────────────────────────────────────────────────────────────

  if (!canReply) {
    return (
      <div className="p-3 border-t border-border/60 bg-background" style={{ paddingBottom: offset || undefined }}>
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          <X className="w-4 h-4 shrink-0" />
          <span>Sem permissão para responder neste chat.</span>
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
        onChange={(e) => {
          if (e.target.files?.[0]) handleFileSelected(e.target.files[0]);
          // Permite recapturar/re-selecionar o mesmo arquivo.
          e.target.value = "";
        }}
        className="hidden"
        aria-hidden="true"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        data-testid="mobile-file-input"
        onChange={(e) => {
          if (e.target.files?.[0]) handleFileSelected(e.target.files[0]);
          // Permite reanexar o mesmo arquivo (onChange não dispara se value igual).
          e.target.value = "";
        }}
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

      {/* Preview do anexo antes de enviar — imagem mostra thumbnail,
          documento/vídeo mostram chip com ícone + nome. */}
      {pendingAttachment && (() => {
        const kind = deriveAttachmentMediaType(pendingAttachment.mime);
        const KindIcon = kind === "video" ? Film : FileText;
        return (
          <div className="border-b border-border/40 px-3 pt-3 pb-2" data-testid="attachment-preview">
            <div className="flex items-start gap-3">
              <div className="relative shrink-0">
                {kind === "image" ? (
                  <img
                    src={pendingAttachment.data}
                    alt={pendingAttachment.name}
                    className="w-16 h-16 object-cover rounded-lg border border-border/60"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center border border-border/60">
                    <KindIcon className="w-6 h-6 text-muted-foreground" aria-hidden />
                  </div>
                )}
                <button
                  type="button"
                  onClick={clearPendingAttachment}
                  aria-label="Remover anexo"
                  className="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                {kind !== "image" && (
                  <p className="text-sm text-foreground truncate" title={pendingAttachment.name}>
                    {pendingAttachment.name}
                  </p>
                )}
                <Textarea
                  value={attachmentCaption}
                  onChange={(e) => setAttachmentCaption(e.target.value)}
                  placeholder="Adicionar legenda (opcional)..."
                  aria-label="Legenda do anexo"
                  rows={1}
                  className="min-h-[36px] max-h-24 resize-none py-2"
                />
                <Button
                  onClick={handleSendAttachment}
                  disabled={isSending}
                  className="w-full"
                >
                  {isSending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 mr-2" />
                  )}
                  {kind === "document" ? "Enviar Arquivo"
                    : kind === "video" ? "Enviar Vídeo"
                    : "Enviar Imagem"}
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Composer row */}
      <div className="flex items-center gap-2 p-3">
        {/* Plus / close tray toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTrayOpen((v) => !v)}
          aria-label={trayOpen ? "Fechar ações" : "Abrir ações"}
          className="shrink-0"
        >
          <Plus
            className={cn(
              "w-5 h-5 transition-transform duration-200",
              trayOpen && "rotate-45",
            )}
          />
        </Button>

        {/* Text input — textarea p/ suportar quebra de linha + slash popover */}
        <div className="relative flex-1">
          {showSlashPopover && templates && (
            <SlashCommandPopover
              query={message}
              templates={templates}
              onSelect={handleSlashSelect}
              onClose={() => setShowSlashPopover(false)}
            />
          )}
          <Textarea
            ref={inputRef}
            rows={1}
            placeholder={`Mensagem para ${contactName}...`}
            value={message}
            onChange={(e) => {
              const val = e.target.value;
              setMessage(val);
              setShowSlashPopover(val.startsWith("/") && val.length > 0);
            }}
            disabled={isSending}
            aria-label={`Mensagem para ${contactName}`}
            className="w-full min-h-[40px] max-h-32 resize-none rounded-2xl border border-border/60 bg-background py-2 leading-5"
          />
        </div>

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
            onClick={() => {
              if (isSending) {
                toast.info("Aguarde o envio anterior finalizar.");
                return;
              }
              setIsRecording(true);
            }}
            aria-label="Gravar áudio"
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
