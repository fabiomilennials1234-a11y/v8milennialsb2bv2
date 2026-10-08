/**
 * Item compact da lista de conversas no Bubble.
 *
 * Density: compact (56px row height, avatar 32px). Color-dot 6px à esquerda
 * apenas quando há >1 instância permitida (Linear convention).
 */
import { memo } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ChatContact } from "@/modules/communication/hooks/chat/types";
import { instanceColor } from "./utils/instanceColor";
import { telefoneParaExibicao } from "@/modules/communication/lib/identificadorOculto";

interface ChatBubbleConversationItemProps {
  contact: ChatContact;
  /** ID da instância dessa conversa (color-dot derivado dele). */
  instanceId: string;
  /** Nome da instância (tooltip do dot). */
  instanceName?: string | null;
  showInstanceDot: boolean;
  isSelected: boolean;
  onSelect: () => void;
}

function getInitials(c: ChatContact): string {
  const name = (c.lead_name || c.push_name || c.phone_number || "").trim();
  if (!name) return "?";
  const parts = name.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRelativeTime(timestamp: string): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isToday) {
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  if (isYesterday) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function ChatBubbleConversationItemBase({
  contact,
  instanceId,
  instanceName,
  showInstanceDot,
  isSelected,
  onSelect,
}: ChatBubbleConversationItemProps) {
  const displayName =
    contact.lead_name ||
    contact.push_name ||
    telefoneParaExibicao(contact.phone_number) ||
    "Contato";
  const preview = contact.last_message ?? "";
  const time = formatRelativeTime(contact.last_message_time);
  const unread = contact.unread_count ?? 0;
  const ariaUnread = unread > 0
    ? `${unread} não lida${unread > 1 ? "s" : ""}`
    : "sem novas mensagens";

  return (
    <li className="contents">
      <button
        type="button"
        onClick={onSelect}
        data-selected={isSelected || undefined}
        aria-label={`Conversa com ${displayName}, ${ariaUnread}`}
        className={cn(
          "relative w-full flex items-start gap-3",
          "h-14 px-3",
          "border-b border-border/40",
          "transition-colors duration-100",
          "hover:bg-muted/40",
          "focus-visible:outline-none focus-visible:bg-muted/40 focus-visible:ring-1 focus-visible:ring-ring/40",
          "data-[selected]:bg-muted/60",
          "text-left",
        )}
      >
        {showInstanceDot && (
          <span
            className="absolute left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: instanceColor(instanceId) }}
            aria-hidden
            title={instanceName ?? undefined}
          />
        )}

        <Avatar className="w-8 h-8 mt-1.5 shrink-0 ml-1">
          <AvatarFallback className="bg-muted text-foreground/70 text-xs font-medium">
            {getInitials(contact)}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-foreground truncate">
              {displayName}
            </span>
            <span className="text-[10px] tabular-nums text-muted-foreground/60 shrink-0">
              {time}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <span className="text-xs text-muted-foreground/80 line-clamp-1">
              {preview}
            </span>
            {unread > 0 && (
              <Badge
                className="h-4 min-w-[16px] px-1 bg-destructive text-destructive-foreground text-[9px] font-bold tabular-nums shrink-0 border-0 hover:bg-destructive"
                aria-hidden
              >
                {unread > 99 ? "99+" : unread}
              </Badge>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

export const ChatBubbleConversationItem = memo(ChatBubbleConversationItemBase);
