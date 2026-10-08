// src/components/chat-meta/MetaConversationList.tsx
import { useMetaConversations } from "@/modules/communication/hooks/chat-meta/useMetaConversations";
import { MetaConversationListItem } from "./MetaConversationListItem";
import { Loader2 } from "lucide-react";
import type { MetaChannel } from "@/modules/communication/hooks/chat-meta/types";

interface Props {
  pageId: string | null;
  channel: MetaChannel | null;
  selectedConversationId: string | null;
  onSelect: (id: string) => void;
}

export function MetaConversationList({ pageId, channel, selectedConversationId, onSelect }: Props) {
  const { data: conversations, isLoading } = useMetaConversations({ pageId, channel, tab: "active" });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!conversations || conversations.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
        Nenhuma conversa nesta página ainda.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-2">
      {conversations.map((c) => (
        <MetaConversationListItem
          key={c.id}
          conversation={c}
          selected={c.id === selectedConversationId}
          onClick={onSelect}
        />
      ))}
    </div>
  );
}
