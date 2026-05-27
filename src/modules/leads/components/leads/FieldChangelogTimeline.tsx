import { memo } from "react";
import { Edit2, Loader2, History } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  useFieldChangelog,
  getFieldLabel,
  formatFieldValue,
  type FieldChange,
} from "../../hooks/useLeadTimeline";

interface FieldChangelogTimelineProps {
  leadId: string | null | undefined;
  limit?: number;
  className?: string;
}

function ChangeItem({ change }: { change: FieldChange }) {
  const label = getFieldLabel(change.field_name);
  const from = formatFieldValue(change.field_name, change.old_value);
  const to = formatFieldValue(change.field_name, change.new_value);

  return (
    <div className="flex gap-3 py-2.5 border-b border-border/40 last:border-0">
      <div className="shrink-0 mt-0.5">
        <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
          <Edit2 className="w-3 h-3 text-muted-foreground" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-xs font-medium">{label}</span>
          <span className="text-[10px] text-muted-foreground">
            {change.user_name}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-xs">
          <span className="text-muted-foreground line-through truncate max-w-[120px]" title={from}>
            {from}
          </span>
          <span className="text-muted-foreground shrink-0">&rarr;</span>
          <span className="font-medium text-foreground truncate max-w-[120px]" title={to}>
            {to}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground mt-0.5 block">
          {formatDistanceToNow(new Date(change.changed_at), { addSuffix: true, locale: ptBR })}
          {" - "}
          {format(new Date(change.changed_at), "dd/MM HH:mm", { locale: ptBR })}
        </span>
      </div>
    </div>
  );
}

export const FieldChangelogTimeline = memo(function FieldChangelogTimeline({
  leadId,
  limit = 50,
  className,
}: FieldChangelogTimelineProps) {
  const { data: changes, isLoading } = useFieldChangelog(leadId, limit);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!changes || changes.length === 0) {
    return (
      <div className={cn("text-center py-6", className)}>
        <History className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Nenhuma alteracao de campo registrada.</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-0", className)}>
      {changes.map((change) => (
        <ChangeItem key={change.id} change={change} />
      ))}
    </div>
  );
});
