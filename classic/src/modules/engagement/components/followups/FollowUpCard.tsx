import { memo, useState } from "react";
import { useNomeDoPipe } from "../../hooks/useNomeDoPipe";
import { format, formatDistanceToNow, isPast, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  Calendar as CalendarIcon,
  User,
  MessageSquare,
  Kanban,
  MessageCircle,
  Archive,
  Trash2,
  ChevronDown,
  CalendarPlus,
  ExternalLink,
  StickyNote,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { formatPhoneForWhatsApp } from "@/modules/communication/lib/whatsapp";
import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";
import type { FollowUp } from "@/modules/engagement/hooks/useFollowUps";

interface FollowUpCardProps {
  followUp: FollowUp;
  onComplete: (id: string, notes?: string) => void;
  onArchive?: (id: string) => void;
  onRemove?: (id: string) => void;
  onReschedule?: (id: string, newDate: string) => void;
  onScheduleNew?: (leadId: string, leadName: string, sourcePipe?: string, sourcePipeId?: string, assignedTo?: string) => void;
  onOpenLead?: (leadId: string) => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

const priorityConfig = {
  low: { label: "Baixa", class: "bg-muted text-muted-foreground" },
  normal: { label: "Normal", class: "bg-chart-4/10 text-chart-4 border-chart-4/20" },
  high: { label: "Alta", class: "bg-chart-5/10 text-chart-5 border-chart-5/20" },
  urgent: { label: "Urgente", class: "bg-destructive/10 text-destructive border-destructive/20" },
};

const pipeIcons = {
  whatsapp: MessageSquare,
  confirmacao: CalendarIcon,
  propostas: Kanban,
};


export const FollowUpCard = memo(function FollowUpCard({
  followUp,
  onComplete,
  onArchive,
  onRemove,
  onReschedule,
  onScheduleNew,
  onOpenLead,
  isExpanded = false,
  onToggleExpand,
}: FollowUpCardProps) {
  // Nome do funil como a ORG o vê (SCRUM-641).
  const nomeDoPipe = useNomeDoPipe();
  const [completionNotes, setCompletionNotes] = useState("");
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  const dueDate = new Date(followUp.due_date);
  const isOverdue = isPast(dueDate) && !isToday(dueDate);
  const isDueToday = isToday(dueDate);
  const isCompleted = !!followUp.completed_at;
  const PipeIcon = followUp.source_pipe ? pipeIcons[followUp.source_pipe as keyof typeof pipeIcons] : null;
  const hasPhone = !!formatPhoneForWhatsApp(followUp.lead?.phone);

  const handleCompleteWithNotes = () => {
    onComplete(followUp.id, completionNotes || undefined);
    setCompletionNotes("");
  };

  const handleCompleteWithoutNotes = () => {
    onComplete(followUp.id);
    setCompletionNotes("");
  };

  const handleReschedule = (date: Date | undefined) => {
    if (date && onReschedule) {
      onReschedule(followUp.id, date.toISOString());
      setRescheduleOpen(false);
    }
  };

  const handleScheduleNew = () => {
    if (onScheduleNew) {
      onScheduleNew(
        followUp.lead_id,
        followUp.lead?.name || "Lead",
        followUp.source_pipe || undefined,
        followUp.source_pipe_id || undefined,
        followUp.assigned_to || undefined,
      );
    }
  };

  const handleOpenLead = () => {
    if (onOpenLead && followUp.lead_id) {
      onOpenLead(followUp.lead_id);
    }
  };

  return (
    <Collapsible open={isExpanded} onOpenChange={() => onToggleExpand?.()}>
      <div
        className={cn(
          "rounded-xl border transition-all duration-150",
          isOverdue && !isCompleted && "border-destructive/30 bg-destructive/5",
          isDueToday && !isOverdue && !isCompleted && "border-amber-500/30 bg-amber-500/5",
          isCompleted && "bg-muted/50 border-border opacity-70",
          !isOverdue && !isDueToday && !isCompleted && "border-border bg-card",
          isExpanded && "shadow-lg ring-1 ring-primary/20",
          !isExpanded && "hover:shadow-md hover:border-border/80 cursor-pointer",
        )}
      >
        {/* Compact Header — always visible */}
        <CollapsibleTrigger asChild>
          <div className="p-4 flex items-center gap-3">
            {/* Left: Icon + Title + Lead info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                {isOverdue && !isCompleted && (
                  <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />
                )}
                {isDueToday && !isOverdue && !isCompleted && (
                  <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
                )}
                {isCompleted && (
                  <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
                )}
                <h4 className="font-medium text-sm truncate">{followUp.title}</h4>
                <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", priorityConfig[followUp.priority].class)}>
                  {priorityConfig[followUp.priority].label}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium truncate">{followUp.lead?.name || "Lead"}</span>
                {followUp.lead?.company && (
                  <>
                    <span className="text-border">•</span>
                    <span className="truncate">{followUp.lead.company}</span>
                  </>
                )}
              </div>
            </div>

            {/* Right: Due date + Source + Avatar + Chevron */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {followUp.source_pipe && PipeIcon && (
                <Badge variant="secondary" className="text-[10px] gap-0.5 px-1.5 py-0 hidden sm:flex">
                  <PipeIcon className="w-3 h-3" />
                  {nomeDoPipe(followUp.source_pipe)}
                </Badge>
              )}

              <div className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-md whitespace-nowrap",
                isOverdue && !isCompleted && "bg-destructive/10 text-destructive",
                isDueToday && !isOverdue && !isCompleted && "bg-amber-500/10 text-amber-500",
                isCompleted && "bg-success/10 text-success",
                !isOverdue && !isDueToday && !isCompleted && "bg-muted text-muted-foreground"
              )}>
                {isCompleted ? (
                  "Concluída"
                ) : isOverdue ? (
                  `${formatDistanceToNow(dueDate, { locale: ptBR })} atrás`
                ) : isDueToday ? (
                  "Hoje"
                ) : (
                  format(dueDate, "dd/MM", { locale: ptBR })
                )}
              </div>

              {followUp.team_member && (
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-medium text-primary">
                    {followUp.team_member.name.substring(0, 2).toUpperCase()}
                  </span>
                </div>
              )}

              <ChevronDown className={cn(
                "w-4 h-4 text-muted-foreground transition-transform duration-150",
                isExpanded && "rotate-180"
              )} />
            </div>
          </div>
        </CollapsibleTrigger>

        {/* Expanded Panel */}
        <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1 duration-150">
          <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
            {/* Quick Actions Row */}
            {!isCompleted && (
              <div className="flex flex-wrap gap-1.5">
                {hasPhone && (
                  <AbrirConversaButton
                    leadId={followUp.lead_id}
                    phone={followUp.lead?.phone}
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 text-xs text-[#25D366] hover:text-[#25D366] hover:bg-[#25D366]/10"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    WhatsApp
                  </AbrirConversaButton>
                )}

                {onReschedule && (
                  <Popover open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1.5 text-xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <CalendarIcon className="w-3.5 h-3.5" />
                        Reagendar
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start" onClick={(e) => e.stopPropagation()}>
                      <Calendar
                        mode="single"
                        selected={dueDate}
                        onSelect={handleReschedule}
                        disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                        initialFocus
                        locale={ptBR}
                      />
                    </PopoverContent>
                  </Popover>
                )}

                {onScheduleNew && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleScheduleNew();
                    }}
                  >
                    <CalendarPlus className="w-3.5 h-3.5" />
                    Novo FU
                  </Button>
                )}

                {onOpenLead && followUp.lead_id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenLead();
                    }}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Ver Lead
                  </Button>
                )}

                {onArchive && (isOverdue || isCompleted) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchive(followUp.id);
                    }}
                  >
                    <Archive className="w-3.5 h-3.5" />
                    Arquivar
                  </Button>
                )}

                {onRemove && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(followUp.id);
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remover
                  </Button>
                )}
              </div>
            )}

            {/* Completion Section */}
            {!isCompleted && (
              <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
                  <StickyNote className="w-3.5 h-3.5" />
                  <span className="font-medium">Conclusão</span>
                </div>
                <Textarea
                  placeholder="Notas de conclusão (opcional)..."
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  className="min-h-[60px] text-xs resize-none bg-background/50"
                  onClick={(e) => e.stopPropagation()}
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs gap-1.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCompleteWithNotes();
                    }}
                    disabled={!completionNotes.trim()}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Concluir com nota
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCompleteWithoutNotes();
                    }}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Concluir sem nota
                  </Button>
                </div>
              </div>
            )}

            {/* Info Section */}
            <div className="text-xs text-muted-foreground space-y-1 pt-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span>Criado em: {format(new Date(followUp.created_at), "dd/MM/yyyy", { locale: ptBR })}</span>
                {followUp.source_pipe && (
                  <>
                    <span className="text-border">•</span>
                    <span>Funil: {nomeDoPipe(followUp.source_pipe)}</span>
                  </>
                )}
                {followUp.is_automated && (
                  <>
                    <span className="text-border">•</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-primary/5 text-primary border-primary/20">
                      Auto
                    </Badge>
                  </>
                )}
                {followUp.team_member && (
                  <>
                    <span className="text-border">•</span>
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {followUp.team_member.name}
                    </span>
                  </>
                )}
              </div>
              {followUp.description && (
                <p className="text-muted-foreground/80 pt-1 leading-relaxed">
                  {followUp.description}
                </p>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
});
