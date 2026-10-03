import { SendRichContactActions } from "./SendRichContactActions";
import { ReplyPreview } from "../ReplyContext";
import { useChatReply } from "../../../hooks/chat/useChatReply";
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
import { Send, Loader2, CalendarClock, AlertCircle, X, LayoutList, QrCode, Sticker, FileText, Film } from "lucide-react";
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
import { useTypingPresence } from "@/modules/communication/hooks/chat/useTypingPresence";
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
import { QUICK_ACTION_BUTTON } from "./quick-action-button";
import { SendMenuDialog } from "./SendMenuDialog";
import { useQueryClient } from "@tanstack/react-query";
import { criarEnviadorUazapi, type MenuMontado } from "@/modules/communication/lib/menu-sender";
import { acceptedInteractiveRow, interactiveInsertOptions } from "@/modules/communication/lib/accepted-interactive-message";
import { sendMenu as enviarMenuNoProxy } from "@/modules/communication/lib/whatsappApi";
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
  /** Telefone da caixa — o "final 4400" de "Respondendo pela caixa X". */
  instancePhone?: string | null;
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
  instancePhone,
  selectedContact,
}: ChatComposerProps) {
  const { user } = useAuth();
  const { data: teamMember } = useCurrentTeamMember();
  const menuQueryClient = useQueryClient();

  /**
   * Quem envia o menu neste eixo. OBJETO, e montado aqui — nunca um hook
   * passado por prop: hook por prop muda a ordem dos hooks quando o pai troca de
   * canal, e o React aborta com "Rendered more hooks than during the previous
   * render". Nenhum gate de tipo pega isso.
   *
   * A gravação da linha continua sendo do NAVEGADOR neste eixo, como sempre foi
   * — no canal oficial quem grava é o provider, no servidor.
   */
  const enviadorDeMenu = criarEnviadorUazapi({
    instanceId,
    numero: phoneNumber,
    aoEnviar: (inst, numero, tipo, texto, opcoes, extras) =>
      enviarMenuNoProxy(inst, numero, tipo, texto, opcoes, extras),
    aoGravar: async (menu: MenuMontado, _messageId, result) => {
      const orgId = teamMember?.organization_id;
      if (!orgId) {
        toast.warning("Envio aceito. Aguarde a sincronização antes de tentar novamente.");
        return;
      }
      try {
        const row = acceptedInteractiveRow({ organizationId: orgId, instanceId, phoneNumber }, result, { kind: "menu", menu });
        if (!row) throw new Error("Missing accepted message identity");
        const saved = await supabase.from("whatsapp_messages").upsert(row, interactiveInsertOptions);
        if (saved.error) throw saved.error;
      } catch {
        toast.warning("Envio aceito. Histórico aguardando sincronização; não reenvie.");
      }
      void menuQueryClient.invalidateQueries({ queryKey: ["whatsapp_messages", orgId] });
    },
  });

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
  const reply = useChatReply();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (reply?.target?.messageId) inputRef.current?.focus(); }, [reply?.target?.messageId]);
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
        .select("name, company, email, phone, origin, interest, segment, utm_campaign")
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

  const presence = useTypingPresence(instanceId, phoneNumber, canReply);

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
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [message]);

  /** Os quatro últimos dígitos da caixa — o que distingue dois números de mesmo nome. */
  const finalDoNumero = (() => {
    const digitos = (instancePhone ?? "").replace(/\D/g, "");
    return digitos.length >= 4 ? digitos.slice(-4) : null;
  })();

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className={cn(
        "min-w-0 shrink-0 border-t border-border/60 bg-card px-3 pb-2.5 pt-2.5",
        isDragOver && "ring-2 ring-ring ring-inset bg-muted/30",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ReplyPreview />
      {/* Sem permissão */}
      {!canReply ? (
        <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-strong">
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

          {/* Compositor em DOIS ANDARES (V5): o campo em cima, a régua de
              ferramentas embaixo e o enviar à direita. A fileira duplicada que
              ficava acima do campo saiu — cada ferramenta existe uma vez. */}
          <div className="relative rounded-[18px] border border-border/70 bg-muted/50 transition-colors focus-within:border-primary/50 focus-within:bg-card">
            {/* File input oculto */}
            <input
              ref={fileInputRef}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              onChange={handleFileInputChange}
              className="hidden"
              aria-hidden="true"
            />

            {/* SlashCommandPopover para templates */}
            {showSlashPopover && templates && (
              <SlashCommandPopover
                query={message}
                templates={templates}
                onSelect={handleSlashSelect}
                onClose={() => setShowSlashPopover(false)}
              />
            )}

            {/* Andar 1 — o texto. Textarea p/ suportar quebra de linha (⇧⏎). */}
            <Textarea
              ref={inputRef}
              rows={2}
              placeholder={`Mensagem para ${contactName}...`}
              value={message}
              onChange={(e) => {
                const val = e.target.value;
                setMessage(val);
                setShowSlashPopover(val.startsWith("/") && val.length > 0);
                if (val.trim()) presence.typing();
                else presence.stop();
              }}
              onBlur={presence.stop}
              onKeyDown={handleKeyDown}
              disabled={sendMessage.isPending || sendMedia.isPending}
              aria-label={`Digite uma mensagem para ${contactName}`}
              className="block w-full min-h-[52px] max-h-[140px] resize-none border-0 bg-transparent px-3.5 pb-1 pt-3 text-sm leading-5 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />

            {/* Andar 2 — ferramentas · enviar. */}
            <div className="flex items-center gap-1 px-1 pb-1">
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
                className="min-w-0 flex-1 overflow-x-auto scrollbar-hide"
              >
                {/* Agendar */}
                <button
                  type="button"
                  onClick={() => {
                    if (onScheduleOpen) {
                      onScheduleOpen();
                    } else {
                      setScheduleModalOpen(true);
                    }
                  }}
                  aria-label="Agendar mensagem"
                  title="Agendar mensagem"
                  className={QUICK_ACTION_BUTTON}
                >
                  <CalendarClock className="w-[18px] h-[18px]" />
                </button>

                {/* Menu + Pix + contato/localização — Uazapi-only (somem para
                    Meta/Evolution: allowlist positiva, R13). */}
                {caps.canUseUazapiActions && (
                  <>
                    <SendRichContactActions key={conversationKey} instanceId={instanceId} phoneNumber={phoneNumber} leadId={leadId} disabled={!canReply || sendMessage.isPending || sendMedia.isPending} />
                    <button
                      type="button"
                      onClick={() => setPixDialogOpen(true)}
                      aria-label="Enviar botão Pix"
                      title="Enviar Pix"
                      className={QUICK_ACTION_BUTTON}
                    >
                      <QrCode className="w-[18px] h-[18px]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setMenuDialogOpen(true)}
                      aria-label="Enviar menu interativo"
                      title="Menu interativo"
                      className={QUICK_ACTION_BUTTON}
                    >
                      <LayoutList className="w-[18px] h-[18px]" />
                    </button>
                  </>
                )}
              </ChatQuickActions>

              {/* Enviar — tinta, redondo. Sem texto, fica desabilitado (o
                  gravador mora na régua, não troca de lugar com o enviar). */}
              <Button
                type="button"
                variant="ink"
                size="icon"
                onClick={handleSend}
                disabled={!message.trim() || sendMessage.isPending}
                aria-label="Enviar mensagem"
                className="h-[38px] w-[38px] shrink-0 rounded-full"
              >
                {sendMessage.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Linha de dicas — desktop. À direita, POR ONDE a resposta sai: na
              caixa unificada a thread pertence à linha clicada, e o vendedor
              precisa ver o número antes de mandar. */}
          <div className="mt-1.5 hidden items-center gap-3 text-[10.5px] text-muted-foreground select-none sm:flex">
            <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
              <kbd className="rounded border border-border/70 bg-muted/60 px-1 py-px font-mono text-[10px]">Enter</kbd>
              envia
              <kbd className="ml-1.5 rounded border border-border/70 bg-muted/60 px-1 py-px font-mono text-[10px]">Shift+Enter</kbd>
              nova linha
              <span className="hidden items-center gap-1.5 2xl:flex">
                <kbd className="ml-1.5 rounded border border-border/70 bg-muted/60 px-1 py-px font-mono text-[10px]">⌘K</kbd>
                templates
              </span>
            </span>
            {instanceName && (
              <span className="ml-auto min-w-0 truncate whitespace-nowrap text-right">
                Respondendo pela caixa <span className="font-semibold text-foreground/80">{instanceName}</span>
                {finalDoNumero && <> · final <span className="font-mono tabular-nums">{finalDoNumero}</span></>}
              </span>
            )}
          </div>
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
          leadId={selectedContact.lead_id || null}
          leadName={selectedContact.lead_name || selectedContact.push_name || selectedContact.phone_number}
          phoneNumber={selectedContact.phone_number}
          instanceId={instanceId}
          initialMessage={message}
        />
      )}

      <SendMenuDialog
        open={menuDialogOpen}
        onOpenChange={setMenuDialogOpen}
        enviador={enviadorDeMenu}
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
