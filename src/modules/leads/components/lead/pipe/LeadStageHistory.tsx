/**
 * LeadStageHistory — histórico compacto de mudanças de stage do lead.
 *
 * Criado na Onda 3.1, C4. Exibe eventos de stage_moved filtrados da timeline.
 * Diferente de LeadTabHistory que mostra todos os eventos — este foca em movimentações.
 */

import { History } from "lucide-react";
import { TimelineItem } from "../../leads/TimelineItem";
import type { TimelineEvent } from "../../../hooks/useLeadTimeline";

interface LeadStageHistoryProps {
  events: TimelineEvent[];
  /** Máximo de eventos a exibir. Padrão: 5. */
  maxEvents?: number;
}

export function LeadStageHistory({ events, maxEvents = 5 }: LeadStageHistoryProps) {
  const stageEvents = events
    .filter((e) => e.action === "stage_moved" || e.action === "stage_updated")
    .slice(0, maxEvents);

  if (stageEvents.length === 0) {
    return (
      <div className="text-center py-4">
        <History className="w-6 h-6 text-muted-foreground/30 mx-auto mb-1" />
        <p className="text-xs text-muted-foreground">Sem histórico de estágios.</p>
      </div>
    );
  }

  return (
    <div className="space-y-0 border rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b bg-muted/30">
        <span className="text-xs font-medium text-muted-foreground">Histórico de estágios</span>
      </div>
      {stageEvents.map((event, index) => (
        <TimelineItem
          key={event.id}
          event={event}
          isLast={index === stageEvents.length - 1}
          compact
        />
      ))}
    </div>
  );
}
