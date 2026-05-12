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
import { Send, Loader2, ImageIcon, Mic, Clock, AlertCircle, X, LayoutList, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useConversationDraft } from "@/hooks/useConversationDraft";
import { useSendWhatsAppMessage, useSendWhatsAppMedia } from "@/hooks/chat/useWhatsAppSend";
import { setPresence } from "@/lib/whatsappApi";
import { AudioRecorder } from "@/components/chat/media/AudioRecorder";
import { ScheduleMessageModal } from "@/components/chat/ScheduleMessageModal";
import { SlashCommandPopover } from "@/components/chat/SlashCommandPopover";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { resolveVariables } from "@/lib/template-variables";
import { convertAudioBlobToMp3 } from "@/lib/audioToMp3";
import type { LeadContext, AttendantContext } from "@/lib/template-variables";
import type { MessageTemplate } from "@/hooks/useMessageTemplates";
import type { DensityMode } from "@/components/chat/layout/ChatShell";
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
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imageCaption, setImageCaption] = useState("");
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [menuDialogOpen, setMenuDialogOpen] = useState(false);
  const [pixDialogOpen, setPixDialogOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Refs
  const inputRef = useRef<HTMLInputElement>(null);
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

  const handleSlashSelect = useCallback((template: MessageTemplate) => {
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
    setMessage(resolved);
    setShowSlashPopover(false);
  }, [leadForTemplates, selectedContact, phoneNumber, teamMember, setMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
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

  const handleImageSelect = useCallback((file: File | null) => {
    if (!file) return;
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
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleImageSelect(e.target.files?.[0] ?? null);
  }, [handleImageSelect]);

  const handleSendImage = useCallback(async () => {
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar imagem");
    }
  }, [selectedImage, instanceName, phoneNumber, instanceId, imageCaption, sendMedia]);

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
      });
      toast.success("Áudio enviado!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar áudio");
    }
  }, [phoneNumber, instanceName, instanceId, sendMedia]);

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
    if (file) handleImageSelect(file);
  }, [handleImageSelect]);

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

  // Focar input ao montar
  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationKey]);

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
          {/* Image Preview acima do input */}
          {selectedImage && imagePreview && (
            <div className="mb-3 flex items-start gap-3">
              <div className="relative">
                <img
                  src={imagePreview}
                  alt="Preview da imagem a ser enviada"
                  className="w-20 h-20 object-cover rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSelectedImage(null);
                    setImagePreview(null);
                    setImageCaption("");
                  }}
                  aria-label="Remover imagem"
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
          )}

          {/* Input row */}
          <div className="relative flex items-center gap-2">
            {/* File input oculto */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileInputChange}
              className="hidden"
              aria-hidden="true"
            />

            {/* Botão anexar imagem */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={sendMessage.isPending || sendMedia.isPending}
              aria-label="Anexar imagem"
              className="opacity-50 hover:opacity-100 transition-opacity"
            >
              <ImageIcon className="w-5 h-5 text-muted-foreground" />
            </Button>

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

            {/* SlashCommandPopover para templates */}
            {showSlashPopover && templates && (
              <SlashCommandPopover
                query={message}
                templates={templates}
                onSelect={handleSlashSelect}
                onClose={() => setShowSlashPopover(false)}
              />
            )}

            {/* Input de texto */}
            <Input
              ref={inputRef}
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
              className="flex-1 rounded-full border border-border/60 bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
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
