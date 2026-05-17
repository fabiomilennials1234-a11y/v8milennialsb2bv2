import { memo } from "react";
import { CommentComposer } from "./CommentComposer";
import { ActivityFeed } from "./ActivityFeed";
import { LeadModalChecklist } from "./LeadModalChecklist";

interface LeadActivityColumnProps {
  leadId: string;
  organizationId: string;
}

export const LeadActivityColumn = memo(function LeadActivityColumn({
  leadId,
  organizationId,
}: LeadActivityColumnProps) {
  return (
    <div className="flex flex-col gap-3 overflow-hidden px-5 py-5 border-l border-border/40 bg-card/30 min-h-0">
      {/* Aba de checklist — compacta, expande conforme cresce */}
      <LeadModalChecklist leadId={leadId} />

      <div className="flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold">
          Histórico & comentários
        </h3>
      </div>
      <CommentComposer leadId={leadId} organizationId={organizationId} />
      <div className="flex-1 min-h-0">
        <ActivityFeed leadId={leadId} />
      </div>
    </div>
  );
});
