import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  MessageSquare,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Calendar as CalendarIcon,
  CalendarPlus,
  Kanban,
  Bot,
  Archive,
  Trash2,
  CheckCircle2,
  StickyNote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ScheduleMessageModal } from "@/modules/communication/components/chat/ScheduleMessageModal";
import { ScheduleFollowUpModal } from "@/modules/engagement/components/followups/ScheduleFollowUpModal";
import { estaAtrasado } from "@/modules/engagement/lib/follow-up-atraso";
import { formatPhoneForWhatsApp } from "@/modules/communication/lib/whatsapp";
import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────

export interface RevisionTask {
  id: string;
  type: "follow-up" | "scheduled-message";
  title: string;
  leadName: string;
  leadCompany?: string;
  leadPhone?: string;
  leadId: string;
  scheduledAt: Date;
  priority?: "low" | "normal" | "high" | "urgent";
  isCompleted: boolean;
  completedAt?: Date;
  description?: string;
  assignedTo?: string;
  assignedToName?: string;
  sourcePipe?: string;
  sourcePipeId?: string;
  isAutomated?: boolean;
  messageContent?: string;
  mediaUrl?: string;
  mediaType?: string;
  status?: string;
}

// ─── Helpers ─────────────────────────────────────────────

function PriorityDot({ priority }: { priority?: string }) {
  if (priority === "urgent") return <span className="w-2 h-2 rounded-full bg-destructive flex-shrink-0" />;
  if (priority === "high") return <span className="w-2 h-2 rounded-full bg-warning flex-shrink-0" />;
  return null;
}

const PIPE_ICONS: Record<string, typeof MessageSquare> = {
  whatsapp: MessageSquare,
  confirmacao: CalendarIcon,
  propostas: Kanban,
};

function formatTaskDate(date: Date): string {
  if (isToday(date)) return format(date, "'Hoje' HH:mm");
  return format(date, "dd/MM HH:mm", { locale: ptBR });
}

// ─── Component ───────────────────────────────────────────

interface RevisionItemProps {
  task: RevisionTask;
  onComplete: (id: string, notes?: string) => void;
  onCancel?: (id: string) => void;
  onArchive?: (id: string) => void;
  onDelete?: (id: string) => void;
  onReschedule?: (id: string, newDate: string) => void;
  onOpenLead?: (leadId: string) => void;
  onScheduleNew?: (
    leadId: string,
    leadName: string,
    sourcePipe?: string,
    sourcePipeId?: string,
    assignedTo?: string,
  ) => void;
  canDelete?: boolean;
  /**
   * Fuso da organização, para decidir o que é "atrasado".
   *
   * Entra por PROP e não por `useOrganization()` aqui dentro: este componente é
   * de apresentação — recebe `task` e devolve cliques — e plugar um hook de
   * dados nele exigiria `AuthProvider` em toda montagem, inclusive nos testes
   * (que quebraram 11 de uma vez quando tentei). Quem tem o contexto é a página.
   *
   * Ausente → a regra cai em UTC, que no Brasil erra para o lado seguro: o
   * corte é mais cedo, então nunca acusa como atrasado algo de hoje.
   */
  timezone?: string | null;
}

export function RevisionItem({
  task,
  onComplete,
  onCancel,
  onArchive,
  onDelete,
  onReschedule,
  onOpenLead,
  onScheduleNew,
  canDelete,
  timezone,
}: RevisionItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [showCompletionBanner, setShowCompletionBanner] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleFollowUpOpen, setScheduleFollowUpOpen] = useState(false);
  const [completionNotes, setCompletionNotes] = useState("");
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  /**
   * O selo vermelho da lista — a QUINTA definição de "atrasado" que existia no
   * produto, e a única que o usuário enxerga.
   *
   * Era `isPast(scheduledAt)`: corte por INSTANTE, no fuso do browser. Uma
   * tarefa marcada para hoje às 09:00 ficava vermelha às 09:01, ao lado de um
   * cartão do dashboard que a contava como "de hoje". Agora as duas leem a
   * mesma regra, e ela corta por DIA no fuso da organização (SCRUM-607).
   */
  const isOverdue = !task.isCompleted && estaAtrasado(task.scheduledAt, timezone);
  const hasPhone = !!formatPhoneForWhatsApp(task.leadPhone ?? undefined);
  const isFollowUp = task.type === "follow-up";

  const handleCompleteWithNotes = () => {
    onComplete(task.id, completionNotes || undefined);
    setCompletionNotes("");
    setShowCompletionBanner(true);
  };

  const handleCompleteWithoutNotes = () => {
    onComplete(task.id);
    setCompletionNotes("");
    setShowCompletionBanner(true);
  };

  const handleRescheduleDate = (date: Date | undefined) => {
    if (date && onReschedule) {
      onReschedule(task.id, date.toISOString());
      setRescheduleOpen(false);
    }
  };

  const handleScheduleNew = () => {
    if (onScheduleNew) {
      onScheduleNew(
        task.leadId,
        task.leadName,
        task.sourcePipe,
        task.sourcePipeId,
        task.assignedTo,
      );
    }
  };

  return (
    <>
      <div
        className={cn(
          "group flex items-start gap-3 py-3 px-2 rounded-lg cursor-pointer transition-colors",
          "hover:bg-muted/30",
          task.isCompleted && "opacity-50"
        )}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-sm font-medium truncate flex-1",
              task.isCompleted && "line-through"
            )}>
              {task.title}
            </span>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-1.5 py-0 shrink-0",
                task.type === "scheduled-message"
                  ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
                  : "bg-amber-500/10 text-amber-600 border-amber-500/20"
              )}
            >
              {task.type === "scheduled-message" ? "Mensagem" : "Follow-up"}
            </Badge>
          </div>

          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[12px] text-muted-foreground/60 truncate">
              {task.leadName}
              {task.leadCompany && ` · ${task.leadCompany}`}
            </span>
            <span className="ml-auto flex items-center gap-1.5 shrink-0">
              <span className={cn(
                "text-[12px] tabular-nums",
                isOverdue ? "text-destructive font-medium" : "text-muted-foreground/50"
              )}>
                {task.isCompleted && task.completedAt
                  ? `Concluído ${format(task.completedAt, "HH:mm")}`
                  : formatTaskDate(task.scheduledAt)}
              </span>
              <PriorityDot priority={task.priority} />
            </span>
          </div>
        </div>

        <div className="pt-1 opacity-0 group-hover:opacity-40 transition-opacity">
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </div>
      </div>

      {/* Completion Banner (post-complete next-step prompt) */}
      <AnimatePresence>
        {showCompletionBanner && task.isCompleted && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center justify-between gap-3 mx-2 mb-2 px-4 py-2.5 rounded-lg bg-success/5 border border-success/20">
              <span className="text-sm text-foreground/80">
                Concluído. Próximo passo?
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setScheduleFollowUpOpen(true);
                    setShowCompletionBanner(false);
                  }}
                >
                  <CalendarIcon className="w-3 h-3" />
                  Novo follow-up
                </Button>
                {task.leadPhone && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      setScheduleModalOpen(true);
                      setShowCompletionBanner(false);
                    }}
                  >
                    <MessageSquare className="w-3 h-3" />
                    Enviar mensagem
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={(e) => { e.stopPropagation(); setShowCompletionBanner(false); }}
                >
                  Pular
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded Panel */}
      <AnimatePresence>
        {expanded && !task.isCompleted && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="ml-4 mr-2 mb-3 p-3 rounded-lg bg-muted/20 border border-border/50 space-y-3">
              {/* Description / Message content */}
              {isFollowUp && task.description && (
                <p className="text-sm text-muted-foreground">{task.description}</p>
              )}
              {task.type === "scheduled-message" && task.messageContent && (
                <div className="text-sm text-muted-foreground bg-background rounded-md p-2 border border-border/30">
                  {task.messageContent}
                </div>
              )}
              {task.type === "scheduled-message" && task.mediaUrl && (
                <p className="text-xs text-muted-foreground capitalize">{task.mediaType || "mídia"} anexado</p>
              )}

              {/* Meta info */}
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground/50">
                {task.assignedToName && <span>Responsável: {task.assignedToName}</span>}
                {task.sourcePipe && (
                  <span className="flex items-center gap-1">
                    {(() => { const Icon = PIPE_ICONS[task.sourcePipe] || MessageSquare; return <Icon className="w-3 h-3" />; })()}
                    {task.sourcePipe === "whatsapp" ? "WhatsApp" : task.sourcePipe === "confirmacao" ? "Confirmação" : "Propostas"}
                  </span>
                )}
                {task.isAutomated && (
                  <span className="flex items-center gap-1"><Bot className="w-3 h-3" /> Auto</span>
                )}
                {task.status === "failed" && (
                  <span className="text-destructive font-medium">Falhou</span>
                )}
              </div>

              {/* Quick Actions Row (follow-ups get full set, scheduled-messages keep cancel) */}
              {isFollowUp && (
                <div className="flex flex-wrap gap-1.5">
                  {hasPhone && (
                    <AbrirConversaButton
                      leadId={task.leadId}
                      phone={task.leadPhone}
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
                          selected={task.scheduledAt}
                          onSelect={handleRescheduleDate}
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

                  {onOpenLead && task.leadId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenLead(task.leadId);
                      }}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Ver Lead
                    </Button>
                  )}

                  {onArchive && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        onArchive(task.id);
                      }}
                    >
                      <Archive className="w-3.5 h-3.5" />
                      Arquivar
                    </Button>
                  )}

                  {canDelete && onDelete && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(task.id);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remover
                    </Button>
                  )}
                </div>
              )}

              {/* Scheduled-message actions (minimal — cancel only) */}
              {task.type === "scheduled-message" && (
                <div className="flex items-center gap-2">
                  {hasPhone && (
                    <AbrirConversaButton
                      leadId={task.leadId}
                      phone={task.leadPhone}
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 text-xs text-[#25D366] hover:text-[#25D366] hover:bg-[#25D366]/10"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      WhatsApp
                    </AbrirConversaButton>
                  )}
                  {onCancel && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs"
                      onClick={(e) => { e.stopPropagation(); onCancel(task.id); }}>
                      Cancelar envio
                    </Button>
                  )}
                </div>
              )}

              {/* Completion Section (follow-ups only) */}
              {isFollowUp && (
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

              {/* Scheduled-message quick complete (keep original behavior) */}
              {task.type === "scheduled-message" && !onCancel && (
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      onComplete(task.id);
                    }}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Marcar como concluído
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ScheduleMessageModal
        open={scheduleModalOpen}
        onOpenChange={setScheduleModalOpen}
        leadId={task.leadId}
        leadName={task.leadName}
        phoneNumber={task.leadPhone || ""}
      />

      <ScheduleFollowUpModal
        open={scheduleFollowUpOpen}
        onOpenChange={setScheduleFollowUpOpen}
        leadId={task.leadId}
        leadName={task.leadName}
        sourcePipe={task.sourcePipe as "whatsapp" | "confirmacao" | "propostas" | undefined}
        sourcePipeId={task.sourcePipeId}
        defaultAssignedTo={task.assignedTo}
      />
    </>
  );
}
