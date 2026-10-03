/**
 * ContextPanelHistory — histórico de ações do lead na 3ª coluna do ChatShell.
 *
 * C39: usa LeadTabHistory com dados reais de useLeadTimelineCompact.
 */
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLeadByPhone } from "@/modules/communication/hooks/useWhatsAppLeadIntegration";
import { useLeadTimelineCompact } from "@/modules/leads";
import { LeadTabHistory } from "@/modules/leads";
import type { TimelineEvent } from "@/modules/leads";

export interface ContextPanelHistoryProps {
  phoneNumber?: string;
}

export function ContextPanelHistory({ phoneNumber }: ContextPanelHistoryProps) {
  const { data: lead, isLoading: leadLoading } = useLeadByPhone(phoneNumber ?? null);
  const { data: history = [], isLoading: historyLoading } = useLeadTimelineCompact(lead?.id);

  const isLoading = leadLoading || historyLoading;

  if (!phoneNumber) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] p-6 text-center">
        <p className="text-sm text-muted-foreground">Selecione uma conversa</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px]">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-2">
        <LeadTabHistory
          leadId={lead?.id}
          events={history as TimelineEvent[]}
        />
      </div>
    </ScrollArea>
  );
}
