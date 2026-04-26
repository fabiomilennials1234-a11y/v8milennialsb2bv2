/**
 * ContextPanelTabAI — aba I.A do ContextPanel.
 *
 * Timeline cronológica de mensagens e ações do agente (AITimeline sem header
 * colapsável, altura total da aba).
 */
import { Bot } from "lucide-react";
import { AITimeline } from "@/components/chat/takeover/AITimeline";

export interface ContextPanelTabAIProps {
  leadId: string | null;
}

export function ContextPanelTabAI({ leadId }: ContextPanelTabAIProps) {
  if (!leadId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-6 text-center">
        <Bot className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Nenhum lead vinculado</p>
      </div>
    );
  }

  return <AITimeline leadId={leadId} hideHeader />;
}
