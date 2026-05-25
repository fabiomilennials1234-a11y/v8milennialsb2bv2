// src/pages/AtendimentoMeta.tsx
import { useMetaPages } from "@/hooks/chat-meta/useMetaPages";
import { ChatMetaSkeleton } from "@/components/chat-meta/ChatMetaSkeleton";
import { EmptyState } from "@/components/chat-meta/EmptyState";

export default function AtendimentoMeta() {
  const { data, isLoading } = useMetaPages();
  if (isLoading) return <ChatMetaSkeleton />;
  if (!data || data.pages.length === 0) return <EmptyState />;
  return (
    <div className="p-8 text-sm text-muted-foreground">
      Shell em construção (Sub-fase 0.6 substitui este placeholder pelo MetaChatShell).
    </div>
  );
}
