/**
 * MessageList — timeline de mensagens: grouping, unread divider, date separators,
 * motion de entrada, transfer events, ScrollToBottomFab.
 *
 * Extraído de WhatsAppChat.tsx ChatWindow messages area (C7).
 *
 * C22: virtualização para listas >100 msgs via @tanstack/react-virtual.
 * Threshold: messages.length > 100 → virtualizer ativo. ≤100 → render plain.
 * Mobile: virtualizer ativo com overscan maior (5) para momentum scroll suave.
 * Desktop: overscan padrão (3).
 *
 * PRESERVA 100% dos wins da Onda 1:
 * - Grouping por autor + janela 120s (radius adaptativo, gap 2px / 12px)
 * - Date separators (Hoje / Ontem / dd/MM/yyyy)
 * - <UnreadDivider> acima da primeira incoming não-lida
 * - <motion.div> só para msgs posteriores a mountTime
 * - prefers-reduced-motion respeitado
 * - <MessagesAreaErrorBoundary> envolvendo o timeline
 * - FAB visível quando !isAtBottom
 * - <ChatEmptyState> quando messages.length === 0
 */
import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2, UserPlus } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useViewport } from "@/shared/hooks/use-viewport";
import { ChatEmptyState } from "@/modules/communication/components/chat/ChatEmptyState";
import { UnreadDivider } from "@/modules/communication/components/chat/UnreadDivider";
import { ScrollToBottomFab } from "@/modules/communication/components/chat/ScrollToBottomFab";
import { MessagesAreaErrorBoundary } from "@/modules/communication/components/chat/MessagePrimitives";
import { MessageBubble } from "@/modules/communication/components/chat/MessagePrimitives";
import { CallMarker } from "@/modules/communication/components/chat/view/CallMarker";
import type { WhatsAppMessage, FailedMessage } from "@/modules/communication/hooks/useWhatsAppChat";
import type { ConversationCall } from "@/modules/communication/lib/conversationCallsQuery";
import type { DensityMode } from "@/modules/communication/hooks/chat/useChatDensity";

export interface TransferEvent {
  id: string;
  type: "transfer_event";
  reason: string;
  timestamp: string;
}

export interface MessageListProps {
  messages: WhatsAppMessage[];
  transferEvents: TransferEvent[];
  failedMessages: FailedMessage[];
  /**
   * Ligações da conversa, intercaladas com as mensagens em ordem cronológica.
   * Opcional: quem ainda não passa (mockups, telas sem voz) continua igual.
   */
  calls?: ConversationCall[];
  isLoading: boolean;
  contactName: string;
  instanceName: string;
  /** Timestamp da última leitura (epoch ms). 0 = nunca lido. Passado pelo pai via localStorage ou RPC. */
  lastReadAt: number;
  /** Date.now() capturado no mount do pai — usado para animar só novas msgs. */
  mountTime: number;
  onImagePreview: (url: string) => void;
  onRetry: (msg: FailedMessage) => void;
  onOpenTemplates: () => void;
  /** Modo de densidade para estimativa de tamanho do virtualizer. */
  density?: DensityMode;
  /**
   * ID da instância uazapi. Quando fornecido junto com enableActions=true,
   * ativa o action bar (react/edit/pin/delete/markRead) em cada MessageBubble.
   */
  instanceId?: string;
  /**
   * Habilita as bubble actions uazapi. Default false para preservar
   * comportamento em mockups e contextos sem instância real.
   */
  enableActions?: boolean;
  /**
   * As duas ações do canal OFICIAL: reagir e responder-citando.
   *
   * Vêm por callback e não por `enableActions` porque aquele caminho é do eixo
   * da Uazapi — ele exige `instanceId` de `whatsapp_instances`, monta a barra
   * com editar/fixar/apagar (que a Cloud API não tem) e é fechado por
   * `canUseUazapiActions`. Duas barras diferentes para dois canais diferentes é
   * mais honesto que uma barra com metade dos botões inertes.
   */
  onReagir?: (mensagem: { id: string; providerMessageId: string | null }, emoji: string) => void;
  onResponder?: (mensagem: { id: string; providerMessageId: string | null; texto: string | null }) => void;
  /**
   * O texto da mensagem CITADA, pelo id estável.
   *
   * Vem de fora porque a bolha não conhece a thread — ela só tem a própria
   * linha. Sem isto, a barra de citação diria "respondendo a uma mensagem" sem
   * dizer a qual, que é o que o vendedor precisa saber para não citar errado.
   */
  textoCitado?: (providerMessageId: string) => string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VIRTUALIZE_THRESHOLD = 100;
const DESKTOP_OVERSCAN = 3;
const MOBILE_OVERSCAN = 5;

/**
 * Identidade estável para "sem ligações". `calls ?? []` inline criaria um array
 * novo a cada render e derrubaria o `useMemo` do timeline em toda passada —
 * custo por render no caminho mais quente do produto.
 */
const NO_CALLS: ConversationCall[] = [];

type TimelineItem =
  | ({ _type: "message" } & WhatsAppMessage & Partial<FailedMessage> & { message_type: string; content: string | null; media_url: string | null })
  | ({ _type: "transfer" } & TransferEvent)
  | ({ _type: "call"; timestamp: string; call: ConversationCall });

function buildTimeline(
  messages: WhatsAppMessage[],
  transferEvents: TransferEvent[],
  failedMessages: FailedMessage[],
  calls: ConversationCall[]
): TimelineItem[] {
  return [
    ...messages.map((m) => ({ ...m, _type: "message" as const })),
    ...transferEvents.map((e) => ({ ...e, _type: "transfer" as const })),
    // `started_at` vira `timestamp` para entrar na MESMA ordenação das
    // mensagens — a linha do tempo tem um relógio só.
    ...calls.map((c) => ({ _type: "call" as const, timestamp: c.started_at, call: c })),
    ...failedMessages.map((f) => ({
      ...f,
      _type: "message" as const,
      message_type: "text",
      content: f.message,
      media_url: f.mediaUrl ?? null,
      id: f.tempId ?? `failed-${Date.now()}`,
      organization_id: "",
      instance_id: null,
      message_id: f.tempId ?? "",
      remote_jid: "",
      phone_number: "",
      direction: "outgoing" as const,
      push_name: null,
      status: "failed",
      lead_id: null,
      sent_by_ai: false,
      created_at: f.timestamp,
    })),
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) as TimelineItem[];
}

/**
 * Separador de data do item `index`.
 *
 * Vive fora do ramo de mensagem porque QUALQUER item pode abrir um dia. Quando
 * uma ligação é o primeiro acontecimento da data, é ela quem tem de carregar a
 * marca — senão a mensagem seguinte compara a própria data com a da ligação,
 * acha igual, e o dia começa sem separador nenhum.
 */
function dateSeparatorFor(
  timeline: TimelineItem[],
  index: number,
): { show: boolean; label: string; iso: string } {
  const ts = timeline[index]?.timestamp;
  const date = ts ? new Date(ts) : new Date();
  const valid = !Number.isNaN(date.getTime());
  if (!valid) return { show: false, label: "", iso: "" };

  const current = format(date, "dd/MM/yyyy", { locale: ptBR });
  const prevTs = index > 0 ? timeline[index - 1]?.timestamp : null;
  const previous = prevTs ? format(new Date(prevTs), "dd/MM/yyyy", { locale: ptBR }) : "";

  return {
    show: current !== previous,
    label: isToday(date) ? "Hoje" : isYesterday(date) ? "Ontem" : current,
    iso: format(date, "yyyy-MM-dd"),
  };
}

function DateSeparator({ label, iso }: { label: string; iso: string }) {
  return (
    <div className="flex justify-center py-3">
      <time
        dateTime={iso}
        className="text-[11px] font-medium tracking-wider uppercase text-muted-foreground/40 bg-muted/30 px-3 py-1 rounded-full"
      >
        {label}
      </time>
    </div>
  );
}

function estimateDensitySize(density: DensityMode): number {
  switch (density) {
    case "compact": return 64;
    case "spacious": return 96;
    default: return 80;
  }
}

// ─── Componente ──────────────────────────────────────────────────────────────

export function MessageList({
  messages,
  transferEvents,
  failedMessages,
  calls,
  isLoading,
  contactName,
  instanceName,
  lastReadAt,
  mountTime,
  onImagePreview,
  onRetry,
  onOpenTemplates,
  density = "comfortable",
  instanceId,
  enableActions = false,
  onReagir,
  onResponder,
  textoCitado,
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newMessagesCount, setNewMessagesCount] = useState(0);

  const { isMobile } = useViewport();

  const timeline = useMemo(
    () => buildTimeline(messages, transferEvents, failedMessages, calls ?? NO_CALLS),
    [messages, transferEvents, failedMessages, calls]
  );

  // Virtualiza tanto mobile quanto desktop acima do threshold.
  // Mobile ganha overscan maior para momentum scroll suave.
  const shouldVirtualize = timeline.length > VIRTUALIZE_THRESHOLD;
  const overscan = isMobile ? MOBILE_OVERSCAN : DESKTOP_OVERSCAN;

  // Pré-computa unread divider position
  const { firstUnreadIndex, unreadCount } = useMemo(() => {
    if (lastReadAt <= 0) return { firstUnreadIndex: -1, unreadCount: 0 };
    let firstIdx = -1;
    let count = 0;
    timeline.forEach((item, idx) => {
      if (item._type === "message" && item.direction === "incoming") {
        const msgTime = new Date(item.timestamp).getTime();
        if (msgTime > lastReadAt) {
          count++;
          if (firstIdx === -1) firstIdx = idx;
        }
      }
    });
    return { firstUnreadIndex: firstIdx, unreadCount: count };
  }, [timeline, lastReadAt]);

  // Getter do scroll element para o virtualizer
  const getScrollElement = useCallback(() => {
    return scrollAreaRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]"
    ) ?? null;
  }, []);

  // Virtualizer — só instanciado quando necessário
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? timeline.length : 0,
    getScrollElement,
    estimateSize: () => estimateDensitySize(density),
    overscan,
  });

  // Scroll listener for FAB visibility
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (!viewport) return;
    const handler = () => {
      const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      const atBottom = distance < 80;
      setIsAtBottom(atBottom);
      if (atBottom) setNewMessagesCount(0);
    };
    viewport.addEventListener("scroll", handler, { passive: true });
    handler();
    return () => viewport.removeEventListener("scroll", handler);
  }, [contactName]);

  // Reset FAB state on conversation change
  useEffect(() => {
    setIsAtBottom(true);
    setNewMessagesCount(0);
  }, [contactName]);

  // Smart auto-scroll
  useEffect(() => {
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");

    const scrollToBottom = () => {
      if (shouldVirtualize) {
        virtualizer.scrollToIndex(timeline.length - 1, { align: "end", behavior: "smooth" });
      } else if (viewport) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    };

    if (lastMsg?.direction === "outgoing") {
      scrollToBottom();
    } else if (isAtBottom) {
      scrollToBottom();
    } else {
      setNewMessagesCount((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const handleScrollToBottom = useCallback(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (shouldVirtualize) {
      virtualizer.scrollToIndex(timeline.length - 1, { align: "end", behavior: "smooth" });
    } else if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    setNewMessagesCount(0);
  }, [shouldVirtualize, timeline.length, virtualizer]);

  // ─── Render de item individual (shared entre virtualizado e plain) ──────────

  const renderTimelineItem = useCallback((item: TimelineItem, index: number) => {
    // Ligação — marco na linha do tempo, não balão.
    if (item._type === "call") {
      const sep = dateSeparatorFor(timeline, index);
      return (
        <div key={`call-${item.call.id}`}>
          {sep.show && <DateSeparator label={sep.label} iso={sep.iso} />}
          <CallMarker call={item.call} />
        </div>
      );
    }

    // Transfer event card
    if (item._type === "transfer") {
      return (
        <div
          key={`transfer-${item.id}`}
          className="flex items-start gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-950/20 border-l-2 border-amber-400 mx-4 my-2 rounded-r"
        >
          <UserPlus className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
              Transferido para humano
            </p>
            {item.reason && (
              <p className="text-xs text-amber-700 dark:text-amber-300">{item.reason}</p>
            )}
            <time
              dateTime={item.timestamp}
              className="text-xs text-amber-500 mt-0.5 tabular-nums"
            >
              {new Date(item.timestamp).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </div>
        </div>
      );
    }

    // Normal message
    const message = item;
    const ts = message.timestamp;

    const sep = dateSeparatorFor(timeline, index);
    const prevItem = index > 0 ? timeline[index - 1] : null;

    const safeKey = message.id || `msg-${index}-${ts || index}`;

    // Grouping: compare with adjacent message-type items
    const prevMsg = prevItem && prevItem._type === "message" ? prevItem : null;
    const nextItem = index < timeline.length - 1 ? timeline[index + 1] : null;
    const nextMsg = nextItem && nextItem._type === "message" ? nextItem : null;
    const getSource = (m: typeof message) =>
      (m as any).sent_source ?? (m.sent_by_ai ? "copilot" : "manual");
    const msgSource = getSource(message);
    const sameAuthorPrev =
      prevMsg && prevMsg.direction === message.direction && getSource(prevMsg) === msgSource;
    const sameAuthorNext =
      nextMsg && nextMsg.direction === message.direction && getSource(nextMsg) === msgSource;
    const deltaPrev = prevMsg
      ? Math.abs(new Date(message.timestamp).getTime() - new Date(prevMsg.timestamp).getTime())
      : Infinity;
    const deltaNext = nextMsg
      ? Math.abs(new Date(nextMsg.timestamp).getTime() - new Date(message.timestamp).getTime())
      : Infinity;
    const isFirstInGroup = !(sameAuthorPrev && deltaPrev < 120_000);
    const isLastInGroup = !(sameAuthorNext && deltaNext < 120_000);

    return (
      <div key={safeKey}>
        {sep.show && <DateSeparator label={sep.label} iso={sep.iso} />}
        {index === firstUnreadIndex && unreadCount > 0 && (
          <UnreadDivider count={unreadCount} />
        )}
        <MessageBubble
          message={message}
          onImagePreview={onImagePreview}
          isFirstInGroup={isFirstInGroup}
          isLastInGroup={isLastInGroup}
          mountTime={mountTime}
          onRetry={message.status === "failed" ? onRetry : undefined}
          instanceId={instanceId}
          enableActions={enableActions}
          onReagir={onReagir}
          onResponder={onResponder}
          textoCitado={textoCitado}
        />
      </div>
    );
  }, [timeline, firstUnreadIndex, unreadCount, mountTime, onImagePreview, onRetry, instanceId, enableActions, onReagir, onResponder, textoCitado]);

  return (
    <div className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col relative">
      <ScrollArea
        ref={scrollAreaRef}
        className={cn(
          "flex-1 h-full w-full",
          // Radix Viewport injeta wrapper interno com inline `display: table; min-width: 100%`,
          // que faz o conteúdo do chat decidir a largura — quebrando `truncate` em nomes de
          // documento longos. Override força `display: block; min-width: 0` no wrapper.
          "[&_[data-radix-scroll-area-viewport]>div]:!block",
          "[&_[data-radix-scroll-area-viewport]>div]:!min-w-0",
          "[&_[data-radix-scroll-area-viewport]>div]:w-full",
        )}
      >
        <div className="p-4 min-h-full">
          <MessagesAreaErrorBoundary>
            {isLoading ? (
              <div className="flex items-center justify-center min-h-[200px]">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : timeline.length === 0 ? (
              // `timeline`, e não `messages`: uma conversa que só tem ligação
              // (o vendedor ligou antes de mandar a primeira mensagem) tem uma
              // história para contar, e a tela de "nada aqui ainda" mentiria.
              <ChatEmptyState
                contactName={contactName}
                instanceName={instanceName}
                onOpenTemplates={onOpenTemplates}
              />
            ) : shouldVirtualize ? (
              // ── Modo virtualizado (mobile + desktop) ───────────────────
              <div
                data-testid="virtual-container"
                data-mobile={isMobile ? "true" : "false"}
                style={{ height: virtualizer.getTotalSize(), position: "relative" }}
                className="space-y-0 pb-4"
              >
                {virtualizer.getVirtualItems().map((virtualItem) => (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    {renderTimelineItem(timeline[virtualItem.index], virtualItem.index)}
                  </div>
                ))}
              </div>
            ) : (
              // ── Modo plain (≤100 msgs) ────────────────────────────────
              <div className="space-y-1 pb-4">
                {timeline.map((item, index) => renderTimelineItem(item, index))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </MessagesAreaErrorBoundary>
        </div>
      </ScrollArea>
      <ScrollToBottomFab
        visible={!isAtBottom}
        count={newMessagesCount}
        onClick={handleScrollToBottom}
      />
    </div>
  );
}
