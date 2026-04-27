import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Clock, ChevronDown, ChevronUp, X, Pencil } from "lucide-react";
import {
  useScheduledMessagesForLead,
  useCancelScheduledMessage,
  type ScheduledMessage,
} from "@/hooks/useScheduledMessages";
import { ScheduleMessageModal } from "./ScheduleMessageModal";

interface ScheduledMessagesBannerProps {
  leadId: string;
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
  const { data: scheduled = [] } = useScheduledMessagesForLead(leadId);
  const cancelMutation = useCancelScheduledMessage();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<ScheduledMessage | null>(null);

  if (scheduled.length === 0) return null;

  return (
    <>
      <div className="mx-4 mb-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-sm transition-colors hover:bg-primary/10"
        >
          <span className="flex items-center gap-2 text-foreground/80">
            <Clock className="w-3.5 h-3.5 text-primary" />
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
                className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card border border-border text-xs"
              >
                <span className="flex-1 truncate text-muted-foreground">
                  {msg.message_content
                    ? msg.message_content.slice(0, 50) + (msg.message_content.length > 50 ? "..." : "")
                    : `[${msg.media_type || "midia"}]`}
                </span>
                <span className="text-muted-foreground/70 whitespace-nowrap">
                  {format(new Date(msg.scheduled_at), "dd/MM HH:mm", { locale: ptBR })}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(msg);
                  }}
                  className="p-0.5 rounded hover:bg-muted"
                  title="Editar"
                >
                  <Pencil className="w-3 h-3 text-muted-foreground" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    cancelMutation.mutate(msg.id);
                  }}
                  className="p-0.5 rounded hover:bg-muted"
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
