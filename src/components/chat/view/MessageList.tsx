/**
 * MessageList — timeline de mensagens: grouping, unread divider, date separators,
 * motion de entrada, transfer events, ScrollToBottomFab.
 *
 * Extraído de WhatsAppChat.tsx ChatWindow messages area (C7).
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
 *
 * NOTA: lastReadAt vem como prop do pai (número timestamp).
 * Em C14, o pai passará de localStorage para useConversationReadState().
 * Neste commit, o contrato de prop já está definido — zero mudança interna em C14.
 */
import { useRef, useEffect, useState } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2, UserPlus } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { UnreadDivider } from "@/components/chat/UnreadDivider";
import { ScrollToBottomFab } from "@/components/chat/ScrollToBottomFab";
import { MessagesAreaErrorBoundary } from "@/components/chat/WhatsAppChat";
import { MessageBubble } from "@/components/chat/WhatsAppChat";
import type { WhatsAppMessage, FailedMessage } from "@/hooks/useWhatsAppChat";

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
}

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
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newMessagesCount, setNewMessagesCount] = useState(0);

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

  // Smart auto-scroll: always scroll on own messages, only scroll if at bottom for incoming
  useEffect(() => {
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (lastMsg?.direction === "outgoing") {
      if (viewport) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    } else if (isAtBottom) {
      if (viewport) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    } else {
      setNewMessagesCount((n) => n + 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const scrollToBottom = () => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    setNewMessagesCount(0);
  };

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col relative">
      <ScrollArea ref={scrollAreaRef} className="flex-1 h-full">
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
            ) : (
              <div className="space-y-1 pb-4">
                {(() => {
                  // Merge messages + transfer events + failed messages, sorted by timestamp
                  const timeline = [
                    ...messages.map((m) => ({ ...m, _type: "message" as const })),
                    ...transferEvents.map((e) => ({ ...e, _type: "transfer" as const })),
                    ...failedMessages.map((f) => ({
                      ...f,
                      _type: "message" as const,
                      message_type: "text",
                      content: f.message,
                      media_url: f.mediaUrl,
                    })),
                  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

                  // Compute unread divider position
                  let firstUnreadIndex = -1;
                  let unreadCount = 0;
                  if (lastReadAt > 0) {
                    timeline.forEach((item, idx) => {
                      if (item._type === "message" && item.direction === "incoming") {
                        const msgTime = new Date(item.timestamp).getTime();
                        if (msgTime > lastReadAt) {
                          unreadCount++;
                          if (firstUnreadIndex === -1) firstUnreadIndex = idx;
                        }
                      }
                    });
                  }

                  let lastDate = "";
                  return timeline.map((item, index) => {
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
                    const ts = message?.timestamp;
                    const date = ts ? new Date(ts) : new Date();
                    const validDate = !Number.isNaN(date.getTime());
                    const msgDate = validDate ? format(date, "dd/MM/yyyy", { locale: ptBR }) : "";
                    const showDateSeparator = msgDate !== lastDate;
                    if (showDateSeparator) lastDate = msgDate;
                    const dateLabel = validDate
                      ? isToday(date)
                        ? "Hoje"
                        : isYesterday(date)
                          ? "Ontem"
                          : format(date, "dd/MM/yyyy", { locale: ptBR })
                      : "";
                    const safeKey = message?.id || `msg-${index}-${ts || index}`;

                    // Grouping: compare with adjacent message-type items
                    const prevItem = index > 0 ? timeline[index - 1] : null;
                    const nextItem = index < timeline.length - 1 ? timeline[index + 1] : null;
                    const prevMsg = prevItem && prevItem._type === "message" ? prevItem : null;
                    const nextMsg = nextItem && nextItem._type === "message" ? nextItem : null;
                    const sameAuthorPrev =
                      prevMsg &&
                      prevMsg.direction === message.direction &&
                      prevMsg.sent_by_ai === message.sent_by_ai;
                    const sameAuthorNext =
                      nextMsg &&
                      nextMsg.direction === message.direction &&
                      nextMsg.sent_by_ai === message.sent_by_ai;
                    const deltaPrev = prevMsg
                      ? Math.abs(
                          new Date(message.timestamp).getTime() - new Date(prevMsg.timestamp).getTime()
                        )
                      : Infinity;
                    const deltaNext = nextMsg
                      ? Math.abs(
                          new Date(nextMsg.timestamp).getTime() - new Date(message.timestamp).getTime()
                        )
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
                        />
                      </div>
                    );
                  });
                })()}
                <div ref={messagesEndRef} />
              </div>
            )}
          </MessagesAreaErrorBoundary>
        </div>
      </ScrollArea>
      <ScrollToBottomFab
        visible={!isAtBottom}
        count={newMessagesCount}
        onClick={scrollToBottom}
      />
    </div>
  );
}
