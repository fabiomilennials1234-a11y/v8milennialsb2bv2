/**
 * LeadTabHistory — tab de histórico compacto do lead.
 *
 * C38: extraído de LeadDetailContent para modularização.
 * Exibe últimos 8 eventos da timeline + link para histórico completo.
 */
import { History, ExternalLink } from "lucide-react";
import { TimelineItem } from "@/components/leads/TimelineItem";
import type { TimelineEvent } from "@/hooks/useLeadTimeline";

export interface LeadTabHistoryProps {
  leadId: string | null | undefined;
  events: TimelineEvent[];
}

export function LeadTabHistory({ leadId, events }: LeadTabHistoryProps) {
  if (events.length === 0) {
    return (
      <div className="text-center py-6">
        <History className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Nenhum evento registrado.</p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {events.map((item, index) => (
        <TimelineItem
          key={item.id}
          event={item}
          isLast={index === events.length - 1}
          compact
        />
      ))}
      {leadId && (
        <button
          onClick={() => window.open(`/leads?id=${leadId}`, "_blank")}
          className="w-full text-center text-xs text-primary hover:underline py-1 flex items-center justify-center gap-1"
        >
          <ExternalLink className="w-3 h-3" />
          Ver histórico completo
        </button>
      )}
    </div>
  );
}
