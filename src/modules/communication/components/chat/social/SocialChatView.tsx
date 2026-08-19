/**
 * SocialChatView — coluna central do inbox quando a caixa aberta é social.
 *
 * POR QUE UM COMPONENTE PRÓPRIO, E NÃO UM RAMO DENTRO DE `ChatView`. O
 * `ChatHeader` de WhatsApp carrega TakeoverControls, VoiceCallButton,
 * SyncChatButton, limites de mensagem, toggle de Copilot e pausa humana —
 * praticamente tudo pressupõe telefone, instância uazapi e conversa em
 * `conversations`. Um Instagram sem telefone entraria ali desabilitando item por
 * item, e cada prop nova viraria uma chance de mexer no caminho quente de 30
 * orgs. Aqui o WhatsApp fica byte a byte como está e o Instagram ganha a
 * superfície que de fato tem.
 *
 * A LINHA DO TEMPO É A MESMA. `MessageList` recebe o shape de `WhatsAppMessage`;
 * as linhas de `channel_messages` são adaptadas para esse shape em vez de
 * ganharem um renderer paralelo — agrupamento por autor, separador de data,
 * divisor de não-lidas e virtualização são comportamento de CONVERSA, não de
 * WhatsApp, e duplicá-los criaria duas timelines para divergir.
 *
 * `enableActions` fica FALSO: reagir/editar/fixar/apagar são chamadas à Uazapi.
 *
 * O COMPOSER APARECE DESABILITADO, E NÃO ESCONDIDO. Esconder produz a leitura
 * "o Instagram não deixa responder"; o que é verdade é "ainda não construímos o
 * envio". A microcopy diz qual das duas.
 */
import { useMemo, useRef, useState } from "react";
import { FileText, Loader2, Mic, Paperclip, Send, Square, X } from "lucide-react";
import { toast } from "sonner";
import { ChannelBadge } from "@/modules/communication/components/chat/ChannelBadge";
import { MessageList } from "@/modules/communication/components/chat/view/MessageList";
import { getChannelLabel } from "@/modules/communication/components/chat/ChannelBadge";
import { ImagePreviewModal } from "@/modules/communication/components/chat/media/ImagePreviewModal";
import { getAvatarGradient } from "@/modules/communication/components/chat/list/avatarGradient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useSocialMessages } from "@/modules/communication/hooks/chat/useSocialMessages";
import {
  type SocialSendError,
} from "@/modules/communication/hooks/chat/useSendSocialMessage";
import type { SocialSender } from "@/modules/communication/hooks/chat/social-sender";
import { TemplatePicker } from "@/modules/communication/components/chat/social/TemplatePicker";
import { webmOpusToOgg } from "@/modules/communication/lib/webm-opus-to-ogg";
import { socialReplyWindow } from "@/modules/communication/lib/social-window";
import {
  audioExtensionForMime,
  pickAudioRecordingMime,
} from "@/modules/communication/lib/social-attachment";
import { uploadSocialAttachment, type UploadedAttachment } from "@/modules/communication/lib/social-attachment-upload";
import { useCurrentTeamMember } from "@/modules/identity";
import type { WhatsAppMessage } from "@/modules/communication/hooks/chat/types";
import {
  contactHandleLabel,
  contactLabel,
  type SocialContact,
} from "@/modules/communication/hooks/chat/types";
import type { DensityMode } from "@/modules/communication/hooks/chat/useChatDensity";
import type { SocialMessage } from "@/modules/communication/hooks/chat/useSocialMessages";

// ─── Adaptação para a timeline compartilhada ─────────────────────────────────

/**
 * `SocialMessage` → shape que `MessageList`/`MessageBubble` já sabem desenhar.
 *
 * Os campos que só existem no WhatsApp entram com o valor que os torna inertes,
 * nunca com um valor inventado: `phone_number` fica vazio porque não há
 * telefone, `sent_source` é `null` porque nesta fatia nada sai daqui, e
 * `message_id` reusa o `external_id` do fornecedor — que é o mesmo id que a
 * UNIQUE `(external_id, channel, organization_id)` usa como chave de
 * idempotência. Em momento nenhum um id é sintetizado a partir do relógio.
 */
function toTimelineMessage(m: SocialMessage, organizationId: string): WhatsAppMessage {
  return {
    id: m.id,
    organization_id: organizationId,
    instance_id: null,
    message_id: m.external_id,
    remote_jid: "",
    phone_number: "",
    direction: m.direction,
    message_type: m.message_type,
    content: m.content,
    media_url: m.media_url,
    push_name: m.sender_name,
    status: m.status ?? "received",
    lead_id: null,
    timestamp: m.timestamp,
    created_at: m.created_at ?? m.timestamp,
    sent_by_ai: false,
    sent_source: null,
    failure_reason: m.failure_reason ?? null,
    failure_code: m.failure_code ?? null,
  };
}

// ─── Header ──────────────────────────────────────────────────────────────────

function SocialChatHeader({
  contact,
  channelName,
  onBack,
  isMobile,
  onOpenLead,
}: {
  contact: SocialContact;
  channelName: string;
  onBack: () => void;
  isMobile: boolean;
  /**
   * Abre a ficha do lead a partir do contato. Só existe onde há TELEFONE — no
   * Instagram o interlocutor é IGSID e a ficha é montada por telefone.
   */
  onOpenLead?: () => void;
}) {
  const name = contactLabel(contact);
  const handle = contactHandleLabel(contact);
  const gradient = getAvatarGradient(contact.external_user_id || name);

  return (
    <header className="flex items-center gap-3 px-4 py-3 border-b border-border/60 bg-background shrink-0">
      {isMobile && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="-ml-2 h-8 px-2 shrink-0"
          aria-label="Voltar para a lista"
        >
          ←
        </Button>
      )}
      <div className="relative shrink-0">
        {contact.avatar_url ? (
          <img
            src={contact.avatar_url}
            alt=""
            className="w-10 h-10 rounded-full border-2 border-background shadow-sm object-cover"
          />
        ) : (
          <div
            className={cn(
              "w-10 h-10 rounded-full border-2 border-background shadow-sm flex items-center justify-center font-semibold text-sm select-none",
              gradient.ink ? "text-[#1c1c1c]" : "text-white",
            )}
            style={{ background: gradient.background }}
            aria-hidden
          >
            {(name.replace("@", "").charAt(0) || "?").toUpperCase()}
          </div>
        )}
        {/* O canal SAI DO CONTATO. Chumbado em "instagram", o cabeçalho da caixa
            oficial anunciava Instagram Direct numa conversa de WhatsApp — a
            lista acertava (badge verde) e o header contradizia, na mesma tela. */}
        <ChannelBadge channel={contact.channel} size={16} overlay />
      </div>
      <div className="flex-1 min-w-0">
        {onOpenLead ? (
          <button
            type="button"
            onClick={onOpenLead}
            className="font-display font-semibold truncate text-foreground hover:underline text-left w-full"
            title="Abrir ficha do contato"
          >
            {name}
          </button>
        ) : (
          <h3 className="font-display font-semibold truncate text-foreground">{name}</h3>
        )}
        {/* O @ vem primeiro no subtítulo por ser o dado IDENTIFICADOR da pessoa —
            o resto é contexto do canal, igual em toda conversa desta caixa. */}
        <p className="text-sm text-muted-foreground truncate">
          {[handle, getChannelLabel(contact.channel), channelName]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </header>
  );
}

// ─── Composer inerte ─────────────────────────────────────────────────────────

/**
 * Composer do Direct.
 *
 * ⚠️ A JANELA É INFORMAÇÃO, NÃO TRAVA. A doc do fornecedor declara 24h desde a
 * última mensagem do cliente, mas o campo continua habilitado depois disso: o
 * relógio é nosso, a regra é da Meta, e travar o vendedor por uma conta que pode
 * estar errada é pior do que deixá-lo tentar e ver a recusa — que sobe com o
 * texto do fornecedor junto, em vez de virar "erro ao enviar".
 *
 * O contador fica SEMPRE visível enquanto a janela está aberta. É a diferença
 * entre "não consigo responder" e "tenho 3 horas para responder".
 */
function SocialComposer({
  sender,
  canal,
  contactExternalId,
  onAbrirTemplates,
  lastIncomingAt,
}: {
  /**
   * O enviador JÁ PRONTO, montado pelo shell. Não é um hook, e isso é o ponto:
   * chamar um hook vindo por prop muda a ordem dos hooks quando a caixa troca —
   * "Rendered more hooks than during the previous render", com o chat aberto.
   */
  sender: SocialSender;
  /** O canal da caixa — decide microcopy. O envio já vem resolvido no `sender`. */
  canal: SocialContact["channel"];
  contactExternalId: string;
  /**
   * Abre o seletor de template. O estado mora na VIEW, e não aqui, porque o
   * botão de "tentar novamente" de uma mensagem recusada também precisa abri-lo
   * — e ele vive na lista de mensagens, não no composer.
   */
  onAbrirTemplates: () => void;
  lastIncomingAt: string | null;
}) {
  const [texto, setTexto] = useState("");
  const [anexo, setAnexo] = useState<UploadedAttachment | null>(null);
  const [subindo, setSubindo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const gravadorRef = useRef<MediaRecorder | null>(null);
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;

  const enviar = sender;
  const janela = socialReplyWindow(lastIncomingAt);

  /** Publica o arquivo e guarda a URL — o fornecedor BUSCA, não recebe bytes. */
  const publicar = async (file: File) => {
    if (!organizationId) return;
    setSubindo(true);
    try {
      setAnexo(await uploadSocialAttachment(file, organizationId, canal));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao anexar");
    } finally {
      setSubindo(false);
    }
  };

  const gravar = async () => {
    if (gravando) {
      gravadorRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Sem esta escolha, o Chrome grava `audio/webm;codecs=opus` — o único
      // formato de áudio que a Meta NÃO lista para o Instagram (ela documenta
      // aac, m4a, wav, mp4). Pedimos o mais compatível que este navegador tenha.
      const mime = pickAudioRecordingMime(
        (t) => MediaRecorder.isTypeSupported(t),
        canal,
      );
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const pedacos: BlobPart[] = [];

      rec.ondataavailable = (e) => pedacos.push(e.data);
      rec.onstop = async () => {
        // Solta o microfone assim que para: sem isto o indicador do navegador
        // fica aceso e o usuário acha que continua sendo ouvido.
        stream.getTracks().forEach((t) => t.stop());
        setGravando(false);
        // `rec.mimeType` é a VERDADE do que saiu do gravador — o pedido acima
        // pode não ter sido atendido. A extensão sai dele, nunca de um literal:
        // um mp4 chamado `.webm` faz o classificador cair na regra errada.
        const tipo = rec.mimeType || mime || "audio/webm";
        let blob = new Blob(pedacos, { type: tipo });
        let extensao = audioExtensionForMime(tipo);

        // ─── REMUX PARA OGG, SÓ NO CANAL OFICIAL ─────────────────────────────
        //
        // A Meta recusa o MP4 fragmentado do navegador e exige .ogg/OPUS para
        // nota de voz. O Chromium não escreve Ogg, mas escreve WebM/Opus — e os
        // pacotes são os mesmos. Reempacotar aqui é o que transforma o anexo
        // recusado numa nota de voz de verdade, sem recodificar.
        if (canal === "whatsapp_oficial" && /webm/i.test(tipo)) {
          try {
            const ogg = webmOpusToOgg(new Uint8Array(await blob.arrayBuffer()));
            blob = new Blob([ogg], { type: "audio/ogg;codecs=opus" });
            extensao = "ogg";
          } catch (e) {
            // Falhar aqui é melhor que subir o que a Meta recusa em silêncio: o
            // vendedor fica sabendo na hora, com o áudio ainda na mão.
            toast.error("Não foi possível preparar o áudio para o WhatsApp", {
              description: e instanceof Error ? e.message : undefined,
            });
            return;
          }
        }

        await publicar(
          new File([blob], `audio-${Date.now()}.${extensao}`, { type: blob.type }),
        );
      };

      gravadorRef.current = rec;
      rec.start();
      setGravando(true);
    } catch {
      toast.error("Não foi possível acessar o microfone", {
        description: "Verifique a permissão do navegador.",
      });
    }
  };

  const submeter = async () => {
    const conteudo = texto.trim();
    if ((!conteudo && !anexo) || enviar.isPending || subindo) return;

    try {
      await enviar.send({
        contactExternalId,
        text: conteudo || undefined,
        ...(anexo
          ? {
            media: {
              type: anexo.type,
              url: anexo.url,
              mime: anexo.mime,
              ...(conteudo ? { caption: conteudo } : {}),
              filename: anexo.filename,
            },
          }
          : {}),
      });
      setTexto("");
      setAnexo(null);
    } catch (e) {
      const erro = e as SocialSendError;
      toast.error(erro.message, {
        // O texto cru do fornecedor é o que diz POR QUE não foi — inclusive
        // quando a causa é a janela. Sem ele, o operador tentaria para sempre.
        description: erro.detail ?? undefined,
      });
    }
  };

  return (
    <div className="shrink-0 border-t border-border/60 bg-background px-4 py-3">
      {anexo && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">{anexo.filename}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {(anexo.sizeBytes / 1024 / 1024).toFixed(1)} MB
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 shrink-0 p-0"
            onClick={() => setAnexo(null)}
            aria-label="Remover anexo"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Zera o input: sem isto, escolher o MESMO arquivo de novo depois de
            // removê-lo não dispara `change` e o anexo nunca volta.
            e.target.value = "";
            if (file) void publicar(file);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-[42px] w-9 shrink-0 p-0"
          onClick={() => inputRef.current?.click()}
          disabled={subindo || enviar.isPending || gravando}
          aria-label="Anexar arquivo"
        >
          {subindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
        </Button>
        <Button
          variant={gravando ? "destructive" : "ghost"}
          size="sm"
          className="h-[42px] w-9 shrink-0 p-0"
          onClick={() => void gravar()}
          disabled={subindo || enviar.isPending}
          aria-label={gravando ? "Parar gravação" : "Gravar áudio"}
        >
          {gravando ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>
        {/*
          TEMPLATE — a única saída fora da janela de 24 horas.

          Só na caixa oficial: o Direct não tem template aprovado pela Meta.
          Sempre visível, e não só com a janela fechada — template é legítimo
          dentro dela também, e um botão que aparece e some conforme o relógio
          ensina que a ferramenta é instável. O que muda é o DESTAQUE.
        */}
        {canal === "whatsapp_oficial" && (
          <Button
            variant={janela.open === false ? "default" : "ghost"}
            size="sm"
            className="h-[42px] w-9 shrink-0 p-0"
            onClick={onAbrirTemplates}
            disabled={subindo || enviar.isPending || gravando}
            aria-label="Enviar template aprovado"
            title="Enviar template aprovado"
          >
            <FileText className="h-4 w-4" />
          </Button>
        )}
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submeter();
            }
          }}
          placeholder={
            gravando
              ? "Gravando… toque no quadrado para parar"
              : canal === "whatsapp_oficial"
                ? "Responder no WhatsApp…"
                : "Responder no Direct…"
          }
          rows={1}
          className="min-h-[42px] max-h-32 resize-none"
          disabled={enviar.isPending}
        />
        <Button
          onClick={() => void submeter()}
          disabled={(!texto.trim() && !anexo) || enviar.isPending || subindo}
          size="sm"
          className="h-[42px] px-3 shrink-0"
          aria-label="Enviar"
        >
          {enviar.isPending
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Send className="w-4 h-4" />}
        </Button>
      </div>

      {janela.open !== null && (
        <p
          className={cn(
            "mt-1.5 text-[11px]",
            janela.open ? "text-muted-foreground" : "text-amber-500",
          )}
        >
          {janela.open
            ? janela.label
            : canal === "whatsapp_oficial"
              // Com saída disponível, o aviso deixa de ser só aviso: ele diz o
              // que fazer. Antes ele anunciava a recusa e parava aí.
              ? `${janela.label} — texto livre pode ser recusado. Use um template.`
              : `${janela.label} — o envio pode ser recusado`}
        </p>
      )}
    </div>
  );
}

// ─── Componente ──────────────────────────────────────────────────────────────

export interface SocialChatViewProps {
  selectedContact: SocialContact | null;
  /**
   * O canal da CAIXA aberta. Existe para o estado vazio, que é desenhado antes
   * de haver contato selecionado — sem ele, o ícone de "Selecione uma conversa"
   * ficaria chumbado num canal que pode não ser o desta caixa.
   */
  boxChannel: SocialContact["channel"];
  /** Abre a ficha do lead pelo telefone. Ausente na caixa social, que não tem telefone. */
  onOpenLead?: () => void;
  /**
   * Como esta caixa envia. Injetado porque a view é a MESMA para o Direct e para
   * o WhatsApp oficial, e só o envio difere: `notificame-send-social` recusa
   * WhatsApp por modelo, então o canal oficial sai pelo proxy de WhatsApp.
   */
  sender: SocialSender;
  /** Nome da caixa (conta) — vai para o subtítulo do header e para o empty state. */
  channelName: string;
  organizationId: string | null;
  mountTime: number;
  onBack: () => void;
  density: DensityMode;
  isMobile: boolean;
}

export function SocialChatView({
  selectedContact,
  boxChannel,
  onOpenLead,
  sender,
  channelName,
  organizationId,
  mountTime,
  onBack,
  density,
  isMobile,
}: SocialChatViewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [templatesAberto, setTemplatesAberto] = useState(false);

  const { data: rawMessages = [], isLoading } = useSocialMessages(selectedContact);

  const messages = useMemo(
    () => rawMessages.map((m) => toTimelineMessage(m, organizationId ?? "")),
    [rawMessages, organizationId],
  );

  /**
   * O marco da janela é a última mensagem RECEBIDA — nunca a última da thread.
   * Responder não reabre prazo nenhum: quem reinicia a contagem é o cliente,
   * e usar a nossa própria mensagem daria ao vendedor um contador que se renova
   * sozinho a cada resposta, sempre otimista e sempre errado.
   */
  const ultimaRecebidaEm = useMemo(() => {
    let ultima: string | null = null;
    for (const m of rawMessages) {
      if (m.direction !== "incoming") continue;
      if (!ultima || new Date(m.timestamp) > new Date(ultima)) ultima = m.timestamp;
    }
    return ultima;
  }, [rawMessages]);

  if (!selectedContact) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 text-muted-foreground bg-muted/10">
        <ChannelBadge channel={boxChannel} size={40} className="opacity-40" />
        <p className="text-sm">Selecione uma conversa</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0">
      <SocialChatHeader
        contact={selectedContact}
        channelName={channelName}
        onBack={onBack}
        isMobile={isMobile}
        onOpenLead={onOpenLead}
      />

      <div className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <MessageList
            messages={messages}
            transferEvents={[]}
            failedMessages={[]}
            isLoading={isLoading}
            contactName={contactLabel(selectedContact)}
            instanceName={channelName}
            lastReadAt={0}
            mountTime={mountTime}
            onImagePreview={(url) => setPreviewUrl(url)}
            onRetry={(falha) => {
              // ⚠️ ESTE BOTÃO ERA DECORATIVO. O comentário anterior — "não há
              // envio nesta fatia" — descrevia a fatia de recebimento e ficou
              // para trás quando o envio entrou. Resultado: mensagem recusada
              // pela Meta exibia "Tentar novamente" e o clique não fazia NADA.
              const m = falha as unknown as {
                message_type?: string | null;
                content?: string | null;
              };

              // TEMPLATE não se reenvia igual: a recusa costuma ser de FORMA —
              // faltou a imagem do cabeçalho, faltou parâmetro. Repetir o mesmo
              // envelope repete o mesmo erro. Abrir o seletor é o caminho de
              // conserto: lá o que falta é exigido antes de liberar o botão.
              if (m.message_type === "template") {
                setTemplatesAberto(true);
                return;
              }

              const texto = (m.content ?? "").trim();
              if (!texto) {
                // Mídia não é reenviável daqui: o arquivo não está em mãos, só a
                // URL do que foi recusado. Mandar o vendedor anexar de novo é
                // honesto; fingir que reenviou não é.
                toast.error("Reenvie o arquivo pelo composer");
                return;
              }

              void sender
                .send({ contactExternalId: selectedContact.external_user_id, text: texto })
                .then(() => toast.success("Mensagem reenviada"))
                .catch((e) =>
                  toast.error(e instanceof Error ? e.message : "Não foi possível reenviar"),
                );
            }}
            onOpenTemplates={() => {
              /* templates de Instagram são fatia própria (janela de 24h) */
            }}
            density={density}
            enableActions={false}
          />
        )}
      </div>

      {selectedContact.channel === "whatsapp_oficial" && (
        <TemplatePicker
          instanceId={selectedContact.messaging_channel_id}
          contactExternalId={selectedContact.external_user_id}
          open={templatesAberto}
          onOpenChange={setTemplatesAberto}
        />
      )}

      <SocialComposer
        sender={sender}
        canal={selectedContact.channel}
        contactExternalId={selectedContact.external_user_id}
        onAbrirTemplates={() => setTemplatesAberto(true)}
        lastIncomingAt={ultimaRecebidaEm}
      />

      <ImagePreviewModal
        isOpen={!!previewUrl}
        imageUrl={previewUrl}
        onClose={() => setPreviewUrl(null)}
      />
    </div>
  );
}
