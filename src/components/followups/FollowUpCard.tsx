import { motion } from "framer-motion";
import { format, formatDistanceToNow, isPast, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { 
  Building2, 
  Clock, 
  CheckCircle2, 
  AlertTriangle,
  Calendar,
  User,
  MessageSquare,
  Kanban,
  MessageCircle,
  Archive,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { openWhatsApp, formatPhoneForWhatsApp } from "@/lib/whatsapp";
import type { FollowUp } from "@/hooks/useFollowUps";

interface FollowUpCardProps {
  followUp: FollowUp;
  onComplete: (id: string) => void;
  onArchive?: (id: string) => void;
  onClick?: () => void;
}

const priorityConfig = {
  low: { label: "Baixa", class: "bg-muted text-muted-foreground" },
  normal: { label: "Normal", class: "bg-chart-4/10 text-chart-4 border-chart-4/20" },
  high: { label: "Alta", class: "bg-chart-5/10 text-chart-5 border-chart-5/20" },
  urgent: { label: "Urgente", class: "bg-destructive/10 text-destructive border-destructive/20" },
};

const pipeIcons = {
  whatsapp: MessageSquare,
  confirmacao: Calendar,
  propostas: Kanban,
};

const pipeLabels = {
  whatsapp: "WhatsApp",
  confirmacao: "Confirmação",
  propostas: "Propostas",
};

export function FollowUpCard({ followUp, onComplete, onArchive, onClick }: FollowUpCardProps) {
  const dueDate = new Date(followUp.due_date);
  const isOverdue = isPast(dueDate) && !isToday(dueDate);
  const isDueToday = isToday(dueDate);
  const isCompleted = !!followUp.completed_at;
  const canArchive = onArchive && (isOverdue || isCompleted);
  const PipeIcon = followUp.source_pipe ? pipeIcons[followUp.source_pipe] : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        "p-4 rounded-xl border transition-all cursor-pointer hover:shadow-md",
        isOverdue && "border-destructive/50 bg-destructive/5",
        isDueToday && !isOverdue && "border-chart-5/50 bg-chart-5/5",
        !isOverdue && !isDueToday && "border-border bg-card"
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isOverdue && (
              <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />
            )}
            {isDueToday && !isOverdue && (
              <Clock className="w-4 h-4 text-chart-5 flex-shrink-0" />
            )}
            <h4 className="font-medium text-sm truncate">{followUp.title}</h4>
          </div>
          
          {followUp.description && (
            <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
              {followUp.description}
            </p>
          )}

          {/* Lead info */}
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <User className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">{followUp.lead?.name || "Lead"}</span>
            </div>
            {followUp.lead?.company && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <Building2 className="w-3 h-3" />
                <span className="text-xs">{followUp.lead.company}</span>
              </div>
            )}
          </div>

          {/* Badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={priorityConfig[followUp.priority].class}>
              {priorityConfig[followUp.priority].label}
            </Badge>
            
            {followUp.source_pipe && PipeIcon && (
              <Badge variant="secondary" className="text-xs gap-1">
                <PipeIcon className="w-3 h-3" />
                {pipeLabels[followUp.source_pipe]}
              </Badge>
            )}

            {followUp.is_automated && (
              <Badge variant="outline" className="text-xs bg-primary/5 text-primary border-primary/20">
                Auto
              </Badge>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className={cn(
            "text-xs font-medium px-2 py-1 rounded-md",
            isOverdue && "bg-destructive/10 text-destructive",
            isDueToday && !isOverdue && "bg-chart-5/10 text-chart-5",
            !isOverdue && !isDueToday && "bg-muted text-muted-foreground"
          )}>
            {isOverdue ? (
              `Atrasado ${formatDistanceToNow(dueDate, { locale: ptBR })}`
            ) : isDueToday ? (
              "Hoje"
            ) : (
              format(dueDate, "dd/MM", { locale: ptBR })
            )}
          </div>

          <div className="flex items-center gap-1">
            {formatPhoneForWhatsApp(followUp.lead?.phone) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-[#25D366] hover:text-[#25D366] hover:bg-[#25D366]/10"
                onClick={(e) => openWhatsApp(followUp.lead?.phone, e)}
                title="Abrir WhatsApp"
              >
                <MessageCircle className="w-4 h-4" />
              </Button>
            )}
            {!isCompleted && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-success hover:text-success hover:bg-success/10"
                onClick={(e) => {
                  e.stopPropagation();
                  onComplete(followUp.id);
                }}
                title="Concluir"
              >
                <CheckCircle2 className="w-5 h-5" />
              </Button>
            )}
            {canArchive && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  onArchive(followUp.id);
                }}
                title="Arquivar"
              >
                <Archive className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Assigned to */}
      {followUp.team_member && (
        <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="text-xs font-medium text-primary">
              {followUp.team_member.name.substring(0, 2).toUpperCase()}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {followUp.team_member.name}
          </span>
        </div>
      )}
    </motion.div>
  );
}
