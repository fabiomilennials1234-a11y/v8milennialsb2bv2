/**
 * MessageList — timeline de mensagens: grouping, unread divider, date separators,
 * motion de entrada, transfer events, ScrollToBottomFab.
 *
 * Extraído de WhatsAppChat.tsx ChatWindow messages area (C7).
 *
 * C22: virtualização para listas >100 msgs via @tanstack/react-virtual.
 * Threshold: messages.length > 100 → virtualizer ativo. ≤100 → render plain.
 * Mobile fallback: window.innerWidth < 780 → render plain sempre.
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
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { UnreadDivider } from "@/components/chat/UnreadDivider";
import { ScrollToBottomFab } from "@/components/chat/ScrollToBottomFab";
import { MessagesAreaErrorBoundary } from "@/components/chat/WhatsAppChat";
import { MessageBubble } from "@/components/chat/WhatsAppChat";
import type { WhatsAppMessage, FailedMessage } from "@/hooks/useWhatsAppChat";
import type { DensityMode } from "@/hooks/chat/useChatDensity";

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
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VIRTUALIZE_THRESHOLD = 100;
const MOBILE_BREAKPOINT = 780;

type TimelineItem =
  | ({ _type: "message" } & WhatsAppMessage & Partial<FailedMessage> & { message_type: string; content: string | null; media_url: string | null })
  | ({ _type: "transfer" } & TransferEvent);

function buildTimeline(
  messages: WhatsAppMessage[],
  transferEvents: TransferEvent[],
  failedMessages: FailedMessage[]
): TimelineItem[] {
  return [
    ...messages.map((m) => ({ ...m, _type: "message" as const })),
    ...transferEvents.map((e) => ({ ...e, _type: "transfer" as const })),
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
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newMessagesCount, setNewMessagesCount] = useState(0);

  const timeline = useMemo(
    () => buildTimeline(messages, transferEvents, failedMessages),
    [messages, transferEvents, failedMessages]
  );

  // Determina se virtualizar: threshold e mobile fallback
  const isMobile = typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT;
  const shouldVirtualize = !isMobile && timeline.length > VIRTUALIZE_THRESHOLD;

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
    overscan: 5,
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
    const date = ts ? new Date(ts) : new Date();
    const validDate = !Number.isNaN(date.getTime());
    const msgDate = validDate ? format(date, "dd/MM/yyyy", { locale: ptBR }) : "";

    // Date separator: check if previous item has different date
    const prevItem = index > 0 ? timeline[index - 1] : null;
    const prevDate = prevItem
      ? (prevItem.timestamp ? format(new Date(prevItem.timestamp), "dd/MM/yyyy", { locale: ptBR }) : "")
      : "";
    const showDateSeparator = msgDate !== prevDate;
    const dateLabel = validDate
      ? isToday(date)
        ? "Hoje"
        : isYesterday(date)
          ? "Ontem"
          : format(date, "dd/MM/yyyy", { locale: ptBR })
      : "";

    const safeKey = message.id || `msg-${index}-${ts || index}`;

    // Grouping: compare with adjacent message-type items
    const prevMsg = prevItem && prevItem._type === "message" ? prevItem : null;
    const nextItem = index < timeline.length - 1 ? timeline[index + 1] : null;
    const nextMsg = nextItem && nextItem._type === "message" ? nextItem : null;
    const sameAuthorPrev =
      prevMsg && prevMsg.direction === message.direction && prevMsg.sent_by_ai === message.sent_by_ai;
    const sameAuthorNext =
      nextMsg && nextMsg.direction === message.direction && nextMsg.sent_by_ai === message.sent_by_ai;
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
        {showDateSeparator && (
          <div className="flex justify-center py-3">
            <time
              dateTime={validDate ? format(date, "yyyy-MM-dd") : ""}
              className="text-[11px] font-medium tracking-wider uppercase text-muted-foreground/40 bg-muted/30 px-3 py-1 rounded-full"
            >
              {dateLabel}
            </time>
          </div>
        )}
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
        />
      </div>
    );
  }, [timeline, firstUnreadIndex, unreadCount, mountTime, onImagePreview, onRetry, instanceId, enableActions]);

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
            ) : messages.length === 0 ? (
              <ChatEmptyState
                contactName={contactName}
                instanceName={instanceName}
                onOpenTemplates={onOpenTemplates}
              />
            ) : shouldVirtualize ? (
              // ── Modo virtualizado ────────────────────────────────────────
              <div
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
              // ── Modo plain (≤100 msgs ou mobile) ────────────────────────
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
