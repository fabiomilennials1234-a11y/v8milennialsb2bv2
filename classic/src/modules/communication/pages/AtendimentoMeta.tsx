// src/pages/AtendimentoMeta.tsx
import { Suspense } from "react";
import { useMetaPages } from "@/modules/communication/hooks/chat-meta/useMetaPages";
import { ChatMetaSkeleton } from "@/modules/communication/components/chat-meta/ChatMetaSkeleton";
import { EmptyState } from "@/modules/communication/components/chat-meta/EmptyState";
import { MetaChatShell } from "@/modules/communication/components/chat-meta/MetaChatShell";

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
