// src/pages/AtendimentoMeta.tsx
import { Suspense } from "react";
import { useMetaPages } from "@/hooks/chat-meta/useMetaPages";
import { ChatMetaSkeleton } from "@/components/chat-meta/ChatMetaSkeleton";
import { EmptyState } from "@/components/chat-meta/EmptyState";
import { MetaChatShell } from "@/components/chat-meta/MetaChatShell";

export default function AtendimentoMeta() {
  const { data, isLoading } = useMetaPages();
  if (isLoading) return <ChatMetaSkeleton />;
  if (!data || data.pages.length === 0) return <EmptyState />;
  return (
    <Suspense fallback={<ChatMetaSkeleton />}>
      <MetaChatShell />
    </Suspense>
  );
}
