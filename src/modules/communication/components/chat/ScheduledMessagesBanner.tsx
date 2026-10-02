import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Clock, ChevronDown, ChevronUp, X, Pencil } from "lucide-react";
import {
  useScheduledMessagesForLead,
  useScheduledMessagesForConversation,
  useCancelScheduledMessage,
  type ScheduledMessage,
} from "@/modules/communication/hooks/useScheduledMessages";
import { ScheduleMessageModal } from "./ScheduleMessageModal";

interface ScheduledMessagesBannerProps {
  leadId: string | null;
  leadName: string;
  phoneNumber: string;
  instanceId?: string;
}

export function ScheduledMessagesBanner({
  leadId,
  leadName,
  phoneNumber,
  instanceId,
}: ScheduledMessagesBannerProps) {
  const { data: leadMessages = [] } = useScheduledMessagesForLead(leadId);
  const { data: conversationMessages = [] } = useScheduledMessagesForConversation(phoneNumber, instanceId);
  const scheduled = [...new Map([...leadMessages, ...conversationMessages].map(msg => [msg.id, msg])).values()]
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const cancelMutation = useCancelScheduledMessage();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<ScheduledMessage | null>(null);

  if (scheduled.length === 0) return null;

  return (
    <>
      <div className="mx-3 my-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-between rounded-xl border border-insights/20 bg-insights/10 px-3 py-2 text-sm transition-colors hover:bg-insights/15"
        >
          <span className="flex items-center gap-2 font-semibold text-insights">
            <Clock className="h-3.5 w-3.5" />
            {scheduled.length} mensagem{scheduled.length > 1 ? "ns" : ""} agendada{scheduled.length > 1 ? "s" : ""}
          </span>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>

        {expanded && (
          <div className="mt-1 space-y-1">
            {scheduled.map((msg) => (
              <div
                key={msg.id}
                className="flex items-center gap-2 rounded-xl border border-border/70 bg-card px-3 py-1.5 text-xs shadow-relevo"
              >
                <span className="flex-1 truncate text-muted-foreground">
                  {msg.message_content
                    ? msg.message_content.slice(0, 50) + (msg.message_content.length > 50 ? "..." : "")
                    : `[${msg.media_type || "midia"}]`}
                </span>
                <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                  {format(new Date(msg.scheduled_at), "dd/MM HH:mm", { locale: ptBR })}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(msg);
                  }}
                  className="rounded-md p-1 hover:bg-muted"
                  title="Editar"
                >
                  <Pencil className="w-3 h-3 text-muted-foreground" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    cancelMutation.mutate(msg.id);
                  }}
                  className="rounded-md p-1 hover:bg-muted"
                  title="Cancelar"
                >
                  <X className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <ScheduleMessageModal
          open={!!editing}
          onOpenChange={(v) => { if (!v) setEditing(null); }}
          leadId={leadId}
          leadName={leadName}
          phoneNumber={phoneNumber}
          instanceId={instanceId}
          editingId={editing.id}
          editingContent={editing.message_content || ""}
          editingScheduledAt={new Date(editing.scheduled_at)}
        />
      )}
    </>
  );
}
