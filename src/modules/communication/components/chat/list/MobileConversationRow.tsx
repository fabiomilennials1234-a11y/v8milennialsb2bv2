/**
 * MobileConversationRow — WhatsApp-style conversation list item for mobile.
 *
 * Pure presentational: no state, no dropdown menus, no complex interactions.
 * Just avatar + text + badges + tap handler.
 */
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { contactKey, type InboxContact } from "@/modules/communication/hooks/chat/types";
import { ChannelBadge } from "../ChannelBadge";
import { contactDisplayName, formatContactTime } from "./ConversationListItem";

// ─── Props ───────────────────────────────────────────────────────────────────

export interface MobileConversationRowProps {
  contact: InboxContact;
  isSelected: boolean;
  /** Recebe `contactKey(contact)` — telefone no WhatsApp, `conversation_key` no social. */
  onPress: (key: string) => void;
  onLongPress?: (key: string) => void;
  stageName?: string | null;
  stageColor?: string | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MobileConversationRow({
  contact,
  isSelected,
  onPress,
  onLongPress,
  stageName,
  stageColor,
}: MobileConversationRowProps) {
  const name = contactDisplayName(contact);
  const initials = (name.replace("@", "").charAt(0) || "?").toUpperCase();
  const hasUnread = contact.unread_count > 0 && !isSelected;
  const key = contactKey(contact);
  // Canal AUSENTE e WhatsApp legado, nao "outro canal": toda conversa era
  // WhatsApp antes do NotificaMe. Sem este default, contato antigo caia no
  // ramo do selo e pedia um icone que nao existe.
  const isWhatsApp = (contact.channel ?? "whatsapp") === "whatsapp";

  const isOutgoingManual =
    contact.last_message_direction === "outgoing" &&
    (!isWhatsApp ||
      !contact.last_message_sent_source ||
      contact.last_message_sent_source === "manual");

  const isOutgoingWorkflow =
    isWhatsApp &&
    contact.last_message_direction === "outgoing" &&
    contact.last_message_sent_source === "workflow";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Conversa com ${name}`}
      aria-pressed={isSelected}
      className={cn(
        "flex items-center gap-3 px-4 h-14 cursor-pointer select-none transition-colors",
        isSelected
          ? "bg-primary/15"
          : hasUnread
            ? "bg-amber-950/20"
            : "active:bg-muted/60",
      )}
      onClick={() => onPress(key)}
      onContextMenu={(e) => {
        if (onLongPress) {
          e.preventDefault();
          onLongPress(key);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPress(key);
        }
      }}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        <Avatar className="w-10 h-10">
          {!isWhatsApp && contact.avatar_url && (
            <AvatarImage src={contact.avatar_url} alt="" />
          )}
          <AvatarFallback className="bg-primary/10 text-primary font-medium text-sm">
            {initials}
          </AvatarFallback>
        </Avatar>
        {/* Só aparece quando há mais de um canal em jogo seria melhor, mas a
            linha do mobile não sabe o contexto — o selo é barato e nunca mente. */}
        {!isWhatsApp && <ChannelBadge channel={contact.channel} size={14} overlay />}
      </div>

      {/* Center content */}
      <div className="flex-1 min-w-0">
        {/* Top row: name + timestamp */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-sm text-foreground truncate">
            {name}
          </span>
          <time
            dateTime={contact.last_message_time || ""}
            className={cn(
              "text-xs whitespace-nowrap shrink-0 tabular-nums",
              hasUnread ? "text-amber-500 font-medium" : "text-muted-foreground",
            )}
          >
            {formatContactTime(contact.last_message_time)}
          </time>
        </div>

        {/* Bottom row: preview + badges */}
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className="text-xs text-muted-foreground/60 truncate flex-1 min-w-0 flex items-center gap-1">
            {isOutgoingWorkflow && (
              <span className="text-purple-400 shrink-0 text-[10px]">Auto:</span>
            )}
            {isOutgoingManual && (
              <span className="text-foreground/50 shrink-0">Você:</span>
            )}
            <span className="truncate min-w-0">
              {contact.last_message || "Sem mensagens"}
            </span>
          </p>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Stage chip */}
            {stageName && stageColor && (
              <span
                className="text-[10px] leading-none px-1.5 py-0.5 rounded-full whitespace-nowrap font-medium"
                style={{
                  backgroundColor: `${stageColor}33`,
                  color: stageColor,
                }}
              >
                {stageName}
              </span>
            )}

            {/* Unread badge */}
            {hasUnread && (
              <Badge className="h-5 min-w-5 px-1.5 text-xs bg-amber-500 text-white border-0 hover:bg-amber-500">
                {contact.unread_count > 99 ? "99+" : contact.unread_count}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
