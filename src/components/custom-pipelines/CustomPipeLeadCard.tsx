/**
 * @deprecated Use LeadCard variant="custom" instead. This component is kept for reference only.
 */
import { Building2, Phone, User, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { CustomPipeEntry } from "@/hooks/useCustomPipelines";

interface CustomPipeLeadCardProps {
  entry: CustomPipeEntry;
  onRemove?: (entryId: string) => void;
  onClick?: (entry: CustomPipeEntry) => void;
}

export function CustomPipeLeadCard({ entry, onRemove, onClick }: CustomPipeLeadCardProps) {
  const lead = entry.lead;
  if (!lead) return null;

  const timeInStage = entry.stage_changed_at
    ? formatDistanceToNow(new Date(entry.stage_changed_at), { locale: ptBR, addSuffix: false })
    : null;

  return (
    <div
      className="bg-card border rounded-lg p-3 space-y-2 cursor-pointer hover:border-primary/50 transition-colors"
      onClick={() => onClick?.(entry)}
    >
      {/* Header: Nome + Remover */}
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-medium text-sm line-clamp-1">{lead.name}</h4>
        {onRemove && (
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0 w-6 h-6 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(entry.id);
            }}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {/* Empresa */}
      {lead.company_name && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Building2 className="w-3.5 h-3.5 shrink-0" />
          <span className="line-clamp-1">{lead.company_name}</span>
        </div>
      )}

      {/* Telefone */}
      {lead.phone && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Phone className="w-3.5 h-3.5 shrink-0" />
          <span>{lead.phone}</span>
        </div>
      )}

      {/* Footer: Responsável + Tempo na etapa */}
      <div className="flex items-center justify-between gap-2 pt-1">
        {entry.assigned_profile?.full_name ? (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <User className="w-3 h-3" />
            <span className="line-clamp-1">{entry.assigned_profile.full_name}</span>
          </div>
        ) : (
          <span />
        )}

        {timeInStage && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 shrink-0">
            <Clock className="w-3 h-3 mr-0.5" />
            {timeInStage}
          </Badge>
        )}
      </div>

      {/* Notas */}
      {entry.notes && (
        <p className="text-xs text-muted-foreground line-clamp-2 pt-1 border-t border-border/50">
          {entry.notes}
        </p>
      )}
    </div>
  );
}
