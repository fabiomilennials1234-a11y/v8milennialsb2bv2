// src/components/chat-meta/MetaMessageList.tsx
import { useEffect, useRef } from "react";
import { useMetaMessages } from "@/hooks/chat-meta/useMetaMessages";
import { useMetaMarkAsRead } from "@/hooks/chat-meta/useMetaMarkAsRead";
import { MetaMessageBubble } from "./MetaMessageBubble";
import { Loader2 } from "lucide-react";

interface Props {
  conversationId: string | null;
}

export function MetaMessageList({ conversationId }: Props) {
  const { data: messages, isLoading } = useMetaMessages(conversationId);
  const markAsRead = useMetaMarkAsRead();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (conversationId) markAsRead.mutate(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (!conversationId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Selecione uma conversa
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-4">
      {messages?.map((m) => (
        <MetaMessageBubble key={m.id} message={m} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
