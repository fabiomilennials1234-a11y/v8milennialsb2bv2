// src/components/chat-meta/MetaMessageBubble.tsx
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import type { ChannelMessage } from "@/hooks/chat-meta/types";

interface Props {
  message: ChannelMessage;
}

export function MetaMessageBubble({ message }: Props) {
  const isOutgoing = message.direction === "outgoing";

  return (
    <div className={cn("flex w-full", isOutgoing ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[70%] rounded-2xl px-3 py-2 text-sm",
          isOutgoing ? "bg-primary text-primary-foreground" : "bg-muted"
        )}
      >
        {message.media_url && message.message_type === "image" && (
          <img
            src={message.media_url}
            alt=""
            className="mb-1 max-h-[300px] rounded-lg object-cover"
            loading="lazy"
          />
        )}
        {message.media_url && message.message_type !== "image" && message.message_type !== "text" && (
          <a href={message.media_url} target="_blank" rel="noreferrer" className="underline">
            [{message.message_type}]
          </a>
        )}
        {message.content && <div className="whitespace-pre-wrap">{message.content}</div>}
        <div className={cn("mt-1 text-[10px]", isOutgoing ? "text-primary-foreground/70" : "text-muted-foreground")}>
          {message.timestamp && format(new Date(message.timestamp), "HH:mm")}
          {message.status === "failed" && <span className="ml-2 text-destructive">Falhou</span>}
        </div>
      </div>
    </div>
  );
}
