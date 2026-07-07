/**
 * ChatComposer — input standalone do chat.
 *
 * Extraído de WhatsAppChat.tsx ChatWindow composer area (C13).
 *
 * Features:
 * - Draft persistido via useConversationDraft (user-scoped, B1 compliant)
 * - Shortcuts: Enter envia, Shift+Enter nova linha, Ctrl/Cmd+K abre templates,
 *   Ctrl/Cmd+U abre file picker, Escape fecha popover ou cancela gravação
 * - Kbd hints no rodapé (mobile hidden)
 * - Drop zone: arrastar imagem → abre preview
 * - Botão enviar/gravar, botão anexar, botão agendar
 * - AudioRecorder inline quando isRecording=true
 * - Image preview antes de enviar (com legenda)
 * - SlashCommandPopover para templates com variáveis
 */
import { useRef, useState, useCallback, useEffect, type DragEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send, Loader2, Mic, Clock, AlertCircle, X, LayoutList, QrCode, Sticker, Paperclip, FileText, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/modules/identity";
import { useCurrentTeamMember } from "@/modules/identity";
import { useConversationDraft } from "@/modules/communication/hooks/useConversationDraft";
import { useSendWhatsAppMessage, useSendWhatsAppMedia } from "@/modules/communication/hooks/chat/useWhatsAppSend";
import { setPresence } from "@/modules/communication/lib/whatsappApi";
import { AudioRecorder } from "@/modules/communication/components/chat/media/AudioRecorder";
import { ScheduleMessageModal } from "@/modules/communication/components/chat/ScheduleMessageModal";
import { SlashCommandPopover } from "@/modules/communication/components/chat/SlashCommandPopover";
import { useMessageTemplates } from "@/modules/communication/hooks/useMessageTemplates";
import { useInstanceCapabilities } from "@/modules/communication/hooks/useInstanceCapabilities";
import { resolveVariables } from "@/lib/template-variables";
import { convertAudioBlobToMp3, preloadLamejs } from "@/modules/communication/lib/audioToMp3";
import {
  deriveAttachmentMediaType,
  getAttachmentValidationError,
  ATTACHMENT_ACCEPT,
} from "@/modules/communication/lib/attachment-media-type";
import type { LeadContext, AttendantContext } from "@/lib/template-variables";
import type { MessageTemplate } from "@/modules/communication/hooks/useMessageTemplates";
import type { DensityMode } from "@/modules/communication/components/chat/layout/ChatShell";
import { ChatQuickActions } from "./ChatQuickActions";
import { SendMenuDialog } from "./SendMenuDialog";
import { SendPixDialog } from "./SendPixDialog";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ChatComposerProps {
  /** Chave única da conversa: `${instanceId}:${phoneNumber}` */
  conversationKey: string;
  /** Número do contato */
  phoneNumber: string;
  /** Nome do contato para placeholder */
  contactName: string;
  /** Nome da instância WhatsApp */
  instanceName: string;
  /** ID da instância */
  instanceId: string;
  /** ID do lead associado (para templates) */
  leadId?: string;
  /** Se false, mostra aviso de sem permissão */
  canReply: boolean;
  /** Modo de densidade (para min-height do input) */
  density?: DensityMode;
  /** Callback ao abrir modal de agendamento */
  onScheduleOpen?: () => void;
  /** Dados do contact para templates */
  selectedContact?: {
    push_name: string | null;
    lead_name: string | null;
    phone_number: string;
    lead_id: string | null;
  } | null;
}

// ─── Componente ──────────────────────────────────────────────────────────────

export function ChatComposer({
  conversationKey,
  phoneNumber,
  contactName,
  instanceName,
  instanceId,
  leadId,
  canReply,
  density: _density,
  onScheduleOpen,
  selectedContact,
}: ChatComposerProps) {
  const { user } = useAuth();
  const { data: teamMember } = useCurrentTeamMember();

  // Draft persistido — user-scoped (B1 pattern)
  const { draft: message, setDraft: setMessage } = useConversationDraft(conversationKey, user?.id);

  // State local
  const [showSlashPopover, setShowSlashPopover] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  // Preview só existe pra imagem (data URL). Documento/vídeo mostram chip com nome.
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [menuDialogOpen, setMenuDialogOpen] = useState(false);
  const [pixDialogOpen, setPixDialogOpen] = useState(false);
  // Provider-aware gating: interactive menu + Pix are Uazapi-only. Hidden for
  // Meta/Evolution instances (no-op for uazapi/legacy — positive allowlist, R13).
  const caps = useInstanceCapabilities(instanceId);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sendAsSticker, setSendAsSticker] = useState(false);
  // Leitura base64 do anexo em andamento (janela pré-mutation)
  const [isPreparing, setIsPreparing] = useState(false);

  // Refs
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mutations
  const sendMessage = useSendWhatsAppMessage();
  const sendMedia = useSendWhatsAppMedia();

  // Templates para slash command
  const { data: templates } = useMessageTemplates();

  // Dados do lead para resolução de variáveis de template
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

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    if (!message.trim() || !instanceName) return;
    try {
      await sendMessage.mutateAsync({
        phoneNumber,
        message: message.trim(),
        instanceName,
        instanceId,
      });
      setMessage("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar mensagem");
    }
  }, [message, instanceName, phoneNumber, instanceId, sendMessage, setMessage]);

  const handleSlashSelect = useCallback(async (template: MessageTemplate) => {
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
    const attendantCtx: AttendantContext = { name: teamMember?.name ?? undefined };
    const resolved = resolveVariables(template.body, leadCtx, attendantCtx);
    setShowSlashPopover(false);

    // Template com mídia → envia direto (o corpo resolvido vira caption).
    // Texto não é editável inline p/ mídia, então selecionar = enviar.
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
  }, [leadForTemplates, selectedContact, phoneNumber, instanceName, instanceId, leadId, teamMember, sendMedia, setMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash popover captura Enter para selecionar template
    if (showSlashPopover) return;

    const isMod = e.metaKey || e.ctrlKey;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (isMod && e.key === "k") {
      e.preventDefault();
      setMessage("/");
      setShowSlashPopover(true);
    } else if (isMod && e.key === "u") {
      e.preventDefault();
      fileInputRef.current?.click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (showSlashPopover) setShowSlashPopover(false);
      if (isRecording) setIsRecording(false);
    }
  }, [showSlashPopover, isRecording, handleSend, setMessage]);

  const handleFileSelect = useCallback((file: File | null) => {
    if (!file) return;
    const validationError = getAttachmentValidationError(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    const kind = deriveAttachmentMediaType(file.type);
    setSelectedFile(file);
    setSendAsSticker(false);
    // Preview visual só faz sentido pra imagem; doc/vídeo usam chip com nome.
    if (kind === "image") {
      const reader = new FileReader();
      reader.onload = (e) => setFilePreview(e.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setFilePreview(null);
    }
  }, []);

  const clearAttachment = useCallback(() => {
    setSelectedFile(null);
    setFilePreview(null);
    setCaption("");
    setSendAsSticker(false);
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files?.[0] ?? null);
    // Permite reanexar o mesmo arquivo (onChange não dispara se value igual).
    e.target.value = "";
  }, [handleFileSelect]);

  const handleSendMedia = useCallback(async () => {
    // isPreparing cobre a janela da leitura base64 (centenas de ms num PDF de
    // 16MB) em que sendMedia.isPending ainda é false — sem isso, duplo-clique
    // envia o arquivo em duplicata.
    if (!selectedFile || !instanceName || sendMedia.isPending || isPreparing) return;
    const kind = deriveAttachmentMediaType(selectedFile.type);
    const asSticker = sendAsSticker && kind === "image";
    setIsPreparing(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });
      await sendMedia.mutateAsync({
        phoneNumber,
        instanceName,
        instanceId,
        mediaType: asSticker ? "sticker" : kind,
        media: base64,
        caption: asSticker ? undefined : (caption || undefined),
        fileName: selectedFile.name,
        mimetype: selectedFile.type,
        leadId: leadId ?? null,
      });
      clearAttachment();
      toast.success(
        asSticker ? "Figurinha enviada!"
          : kind === "document" ? "Arquivo enviado!"
          : kind === "video" ? "Vídeo enviado!"
          : "Imagem enviada!",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar arquivo");
    } finally {
      setIsPreparing(false);
    }
  }, [selectedFile, instanceName, phoneNumber, instanceId, leadId, caption, sendMedia, sendAsSticker, clearAttachment, isPreparing]);

  const handleAudioRecorded = useCallback(async (audioBlob: Blob) => {
    setIsRecording(false);
    try {
      const blobToSend = await convertAudioBlobToMp3(audioBlob);
      const isMp3 = (blobToSend.type || "").toLowerCase().includes("mpeg") ||
        (blobToSend.type || "").toLowerCase().includes("mp3");
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
        leadId: leadId ?? null,
      });
      toast.success("Áudio enviado!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar áudio");
    }
  }, [phoneNumber, instanceName, instanceId, sendMedia, leadId]);

  // ─── Drop zone ──────────────────────────────────────────────────────────────

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    // Só em desktop (pointer: fine)
    if (!window.matchMedia("(pointer: fine)").matches) return;
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  // Presence: "composing" on type, "available" after 3s idle or blur
  const presenceTimer = useRef<ReturnType<typeof setTimeout>>();
  const presenceSent = useRef<"composing" | "available">("available");

  const sendPresence = useCallback((state: "composing" | "available") => {
    if (presenceSent.current === state) return;
    presenceSent.current = state;
    setPresence(instanceId, phoneNumber, state).catch(() => {});
  }, [instanceId, phoneNumber]);

  const handlePresenceTyping = useCallback(() => {
    sendPresence("composing");
    clearTimeout(presenceTimer.current);
    presenceTimer.current = setTimeout(() => sendPresence("available"), 3000);
  }, [sendPresence]);

  useEffect(() => {
    return () => {
      clearTimeout(presenceTimer.current);
      if (presenceSent.current === "composing") {
        setPresence(instanceId, phoneNumber, "available").catch(() => {});
      }
    };
  }, [instanceId, phoneNumber]);

  // Preload lamejs pra conversão MP3 (evita enviar WebM que Safari não toca)
  useEffect(() => { preloadLamejs(); }, []);

  // Focar input ao montar
  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationKey]);

  // Auto-resize do textarea: cresce com o conteúdo até um teto (~6 linhas),
  // depois rola. Roda a cada mudança de `message` — cobre digitação, inserção
  // de template e reset pós-envio.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [message]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className={cn(
        "p-3 border-t border-border/60 bg-background shrink-0 min-w-0",
        isDragOver && "ring-2 ring-ring ring-inset bg-muted/30",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Sem permissão */}
      {!canReply ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>
            Apenas os vendedores selecionados para este número podem responder no chat. Peça ao admin para incluir você na configuração da instância.
          </span>
        </div>
      ) : isRecording ? (
        /* Gravação de áudio */
        <AudioRecorder
          onRecorded={handleAudioRecorded}
          onCancel={() => setIsRecording(false)}
        />
      ) : (
        <>
          {/* Preview do anexo acima do input — imagem mostra thumbnail,
              documento/vídeo mostram chip com ícone + nome. */}
          {selectedFile && (() => {
            const kind = deriveAttachmentMediaType(selectedFile.type);
            const isImage = kind === "image";
            const KindIcon = kind === "video" ? Film : FileText;
            return (
              <div className="mb-3 flex items-start gap-3">
                <div className="relative shrink-0">
                  {isImage && filePreview ? (
                    <img
                      src={filePreview}
                      alt="Preview da imagem a ser enviada"
                      className="w-20 h-20 object-cover rounded-lg"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-lg bg-muted flex items-center justify-center border border-border/60">
                      <KindIcon className="w-8 h-8 text-muted-foreground" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={clearAttachment}
                    aria-label="Remover anexo"
                    className="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  {!isImage && (
                    <p className="text-sm text-foreground truncate" title={selectedFile.name}>
                      {selectedFile.name}
                    </p>
                  )}
                  {!sendAsSticker && (
                    <Input
                      placeholder="Adicionar legenda (opcional)..."
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                    />
                  )}
                  <div className="flex gap-2">
                    <Button
                      onClick={handleSendMedia}
                      disabled={sendMedia.isPending || isPreparing}
                      className="flex-1"
                    >
                      {sendMedia.isPending || isPreparing ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : sendAsSticker ? (
                        <Sticker className="w-4 h-4 mr-2" />
                      ) : (
                        <Send className="w-4 h-4 mr-2" />
                      )}
                      {sendAsSticker ? "Enviar Figurinha"
                        : kind === "document" ? "Enviar Arquivo"
                        : kind === "video" ? "Enviar Vídeo"
                        : "Enviar Imagem"}
                    </Button>
                    {/* Figurinha só pra imagem */}
                    {isImage && (
                      <Button
                        variant={sendAsSticker ? "default" : "outline"}
                        size="icon"
                        onClick={() => setSendAsSticker(!sendAsSticker)}
                        title={sendAsSticker ? "Enviar como imagem" : "Enviar como figurinha"}
                        className="shrink-0"
                      >
                        <Sticker className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Quick action bar */}
          <ChatQuickActions
            onAudio={() => {
              if (sendMedia.isPending) {
                toast.info("Aguarde o envio anterior finalizar.");
                return;
              }
              setIsRecording(true);
            }}
            onTemplate={() => {
              setMessage("/");
              setShowSlashPopover(true);
            }}
            onAttach={() => fileInputRef.current?.click()}
            disabled={sendMessage.isPending || sendMedia.isPending}
          />

          {/* Input row — container "pill" arredondado (estilo mockup) */}
          <div className="relative flex items-end gap-1 rounded-xl border border-border/70 dark:border-white/[0.07] bg-muted/30 dark:bg-white/[0.03] px-1.5 py-1 transition-colors focus-within:border-primary/40">
            {/* File input oculto */}
            <input
              ref={fileInputRef}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              onChange={handleFileInputChange}
              className="hidden"
              aria-hidden="true"
            />

            {/* Botão anexar arquivo */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={sendMessage.isPending || sendMedia.isPending}
              aria-label="Anexar arquivo"
              title="Anexar imagem, vídeo ou documento"
              className="opacity-50 hover:opacity-100 transition-opacity"
            >
              <Paperclip className="w-5 h-5 text-muted-foreground" />
            </Button>

            {/* Menu + Pix — Uazapi-only (hidden for Meta/Evolution instances) */}
            {caps.canUseUazapiActions && (
              <>
                {/* Menu interativo */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setMenuDialogOpen(true)}
                  aria-label="Enviar menu interativo"
                  title="Menu interativo"
                  className="opacity-50 hover:opacity-100 transition-opacity"
                >
                  <LayoutList className="w-4 h-4 text-muted-foreground" />
                </Button>

                {/* Pix */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setPixDialogOpen(true)}
                  aria-label="Enviar botão Pix"
                  title="Enviar Pix"
                  className="opacity-50 hover:opacity-100 transition-opacity"
                >
                  <QrCode className="w-4 h-4 text-muted-foreground" />
                </Button>
              </>
            )}

            {/* SlashCommandPopover para templates */}
            {showSlashPopover && templates && (
              <SlashCommandPopover
                query={message}
                templates={templates}
                onSelect={handleSlashSelect}
                onClose={() => setShowSlashPopover(false)}
              />
            )}

            {/* Input de texto — textarea p/ suportar quebra de linha (⇧⏎) */}
            <Textarea
              ref={inputRef}
              rows={1}
              placeholder={`Mensagem para ${contactName}...`}
              value={message}
              onChange={(e) => {
                const val = e.target.value;
                setMessage(val);
                setShowSlashPopover(val.startsWith("/") && val.length > 0);
                if (val.trim()) handlePresenceTyping();
              }}
              onBlur={() => sendPresence("available")}
              onKeyDown={handleKeyDown}
              disabled={sendMessage.isPending || sendMedia.isPending}
              aria-label={`Digite uma mensagem para ${contactName}`}
              className="flex-1 min-h-[36px] max-h-40 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 px-2 py-2 leading-5"
            />

            {/* Botão agendar */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (onScheduleOpen) {
                  onScheduleOpen();
                } else {
                  setScheduleModalOpen(true);
                }
              }}
              aria-label="Agendar mensagem"
              title="Agendar mensagem"
              className="opacity-50 hover:opacity-100 hover:text-primary transition-all"
            >
              <Clock className="w-4 h-4" />
            </Button>

            {/* Botão enviar ou gravar */}
            {message.trim() ? (
              <Button
                onClick={handleSend}
                disabled={sendMessage.isPending}
                size="icon"
                aria-label="Enviar mensagem"
                className="gradient-gold text-primary-foreground border-0 rounded-lg shadow-[0_4px_12px_hsl(var(--primary)/0.3)] hover:shadow-[0_6px_16px_hsl(var(--primary)/0.4)] hover:brightness-105 transition-all shrink-0"
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
                onClick={() => {
                  if (sendMedia.isPending) {
                    toast.info("Aguarde o envio anterior finalizar.");
                    return;
                  }
                  setIsRecording(true);
                }}
                aria-label="Gravar áudio"
                className="opacity-50 hover:opacity-100 transition-opacity"
              >
                <Mic className="w-5 h-5 text-muted-foreground" />
              </Button>
            )}
          </div>

          {/* Kbd hints — visíveis apenas em desktop */}
          <p className="hidden sm:flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground/50 select-none">
            <kbd className="font-sans">⏎</kbd>
            <span>enviar</span>
            <span className="opacity-40">·</span>
            <kbd className="font-sans">⇧⏎</kbd>
            <span>nova linha</span>
            <span className="opacity-40">·</span>
            <kbd className="font-sans">⌘K</kbd>
            <span>templates</span>
            <span className="opacity-40">·</span>
            <span className="opacity-50">@time</span>
            <span className="opacity-30">(em breve)</span>
            <span className="opacity-40">·</span>
            <span className="opacity-50">#tag</span>
            <span className="opacity-30">(em breve)</span>
          </p>
        </>
      )}

      {/* Modal de agendamento — interno se não tiver callback externo */}
      {!onScheduleOpen && selectedContact && (
        <ScheduleMessageModal
          open={scheduleModalOpen}
          onOpenChange={(v) => {
            setScheduleModalOpen(v);
            if (!v) setMessage("");
          }}
          leadId={selectedContact.lead_id || ""}
          leadName={selectedContact.lead_name || selectedContact.push_name || selectedContact.phone_number}
          phoneNumber={selectedContact.phone_number}
          instanceId={instanceId}
          initialMessage={message}
        />
      )}

      <SendMenuDialog
        open={menuDialogOpen}
        onOpenChange={setMenuDialogOpen}
        instanceId={instanceId}
        phoneNumber={phoneNumber}
      />

      <SendPixDialog
        open={pixDialogOpen}
        onOpenChange={setPixDialogOpen}
        instanceId={instanceId}
        phoneNumber={phoneNumber}
      />
    </div>
  );
}
