// src/components/chat-meta/MetaConversationListItem.tsx
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ChannelBadge } from "@/components/chat/ChannelBadge";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { MetaConversationWithLead } from "@/hooks/chat-meta/types";

interface Props {
  conversation: MetaConversationWithLead;
  selected: boolean;
  onClick: (id: string) => void;
}

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.replace("@", "").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function MetaConversationListItem({ conversation, selected, onClick }: Props) {
  const display =
    conversation.external_username ||
    (conversation.channel === "instagram" ? "Usuário do Instagram" : "Usuário do Messenger");
  const lead = (conversation as any).lead as { id: string; name: string | null } | null | undefined;

  return (
    <button
      type="button"
      onClick={() => onClick(conversation.id)}
      className={cn(
        "flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition-colors",
        "hover:bg-muted/60",
        selected && "bg-muted"
      )}
    >
      <div className="relative">
        <Avatar className="h-10 w-10">
          {conversation.profile_pic_url && <AvatarImage src={conversation.profile_pic_url} alt={display} />}
          <AvatarFallback>{initials(display)}</AvatarFallback>
        </Avatar>
        <div className="absolute -bottom-0.5 -right-0.5">
          <ChannelBadge channel={conversation.channel as "instagram" | "messenger"} size={16} />
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{display}</span>
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
            {conversation.last_message_at &&
              formatDistanceToNow(new Date(conversation.last_message_at), { addSuffix: false, locale: ptBR })}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted-foreground">{conversation.last_message_preview}</span>
          {conversation.unread_count > 0 && (
            <Badge className="h-5 min-w-[20px] rounded-full px-1.5 text-[10px]">{conversation.unread_count}</Badge>
          )}
        </div>
        {lead?.name && (
          <span className="mt-1 inline-block rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
            {lead.name}
          </span>
        )}
      </div>
    </button>
  );
}
