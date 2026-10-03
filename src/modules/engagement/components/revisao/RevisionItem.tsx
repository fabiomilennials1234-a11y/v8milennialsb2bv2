import { useState } from "react";
import { useNomeDoPipe } from "../../hooks/useNomeDoPipe";
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
  ListTodo,
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
  // Nome do funil como a ORG o vê (SCRUM-641).
  const nomeDoPipe = useNomeDoPipe();
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
  const isMessage = task.type === "scheduled-message";

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
          "group flex cursor-pointer items-start gap-3 rounded-2xl px-3 py-3 transition-colors",
          "hover:bg-muted/50",
          expanded && !task.isCompleted && "bg-muted/40",
          task.isCompleted && "opacity-50"
        )}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Chip do tipo: a mesma informação do selo, para a lista ser lida
            de relance — azul = mensagem agendada, âmbar = follow-up. */}
        <span
          aria-hidden
          className={cn(
            "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px]",
            isMessage ? "bg-insights/10 text-insights" : "bg-warning/15 text-warning-strong",
          )}
        >
          {isMessage ? <MessageSquare className="h-4 w-4" /> : <ListTodo className="h-4 w-4" />}
        </span>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn(
              "flex-1 truncate text-sm font-semibold",
              task.isCompleted && "line-through"
            )}>
              {task.title}
            </span>
            <Badge
              variant={isMessage ? "info" : "warning"}
              className="shrink-0 px-2 py-0 text-[10px] font-bold"
            >
              {isMessage ? "Mensagem" : "Follow-up"}
            </Badge>
          </div>

          <div className="flex items-center gap-2 mt-0.5">
            <span className="truncate text-[12px] text-muted-foreground">
              {task.leadName}
              {task.leadCompany && ` · ${task.leadCompany}`}
            </span>
            <span className="ml-auto flex items-center gap-1.5 shrink-0">
              {/* V5: a hora vira pílula — vermelha se venceu, âmbar se é de hoje. */}
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular-nums",
                isOverdue
                  ? "bg-destructive/10 text-destructive"
                  : !task.isCompleted && isToday(task.scheduledAt)
                    ? "bg-warning/15 text-warning-strong"
                    : "bg-muted text-muted-foreground"
              )}>
                {task.isCompleted && task.completedAt
                  ? `Concluído ${format(task.completedAt, "HH:mm")}`
                  : formatTaskDate(task.scheduledAt)}
              </span>
              <PriorityDot priority={task.priority} />
            </span>
          </div>
        </div>

        <div className="pt-2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-70">
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
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
            <div className="mx-2 mb-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-success/25 bg-success/10 px-4 py-2.5">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <CheckCircle2 className="h-4 w-4 text-success" />
                Concluído. Próximo passo?
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
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
                    className="h-8 gap-1.5 text-xs"
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
                  className="h-8 text-xs"
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
            <div className="mb-3 ml-14 mr-2 space-y-3 rounded-2xl bg-sunken p-4 max-sm:ml-2">
              {/* Description / Message content */}
              {isFollowUp && task.description && (
                <p className="text-sm text-muted-foreground">{task.description}</p>
              )}
              {task.type === "scheduled-message" && task.messageContent && (
                <div className="rounded-xl border border-border/60 bg-card p-3 text-sm text-foreground/80">
                  {task.messageContent}
                </div>
              )}
              {task.type === "scheduled-message" && task.mediaUrl && (
                <p className="text-xs text-muted-foreground capitalize">{task.mediaType || "mídia"} anexado</p>
              )}

              {/* Meta info */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-muted-foreground">
                {task.assignedToName && <span>Responsável: {task.assignedToName}</span>}
                {task.sourcePipe && (
                  <span className="flex items-center gap-1">
                    {(() => { const Icon = PIPE_ICONS[task.sourcePipe] || MessageSquare; return <Icon className="w-3 h-3" />; })()}
                    {nomeDoPipe(task.sourcePipe)}
                  </span>
                )}
                {task.isAutomated && (
                  <span className="flex items-center gap-1"><Bot className="w-3 h-3" /> Auto</span>
                )}
                {task.status === "failed" && (
                  <span className="font-semibold text-destructive">Falhou</span>
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
                      className="h-8 gap-1.5 text-xs text-success hover:bg-success/10 hover:text-success"
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
                          className="h-8 gap-1.5 text-xs"
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
                      className="h-8 gap-1.5 text-xs"
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
                      className="h-8 gap-1.5 text-xs"
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
                      className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
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
                      className="h-8 gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
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
                      className="h-8 gap-1.5 text-xs text-success hover:bg-success/10 hover:text-success"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      WhatsApp
                    </AbrirConversaButton>
                  )}
                  {onCancel && (
                    <Button size="sm" variant="ghost" className="h-8 text-xs"
                      onClick={(e) => { e.stopPropagation(); onCancel(task.id); }}>
                      Cancelar envio
                    </Button>
                  )}
                </div>
              )}

              {/* Completion Section (follow-ups only) */}
              {isFollowUp && (
                <div className="space-y-2 rounded-xl border border-border/60 bg-card p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
                    <StickyNote className="h-3.5 w-3.5" />
                    <span>Conclusão</span>
                  </div>
                  <Textarea
                    placeholder="Notas de conclusão (opcional)..."
                    value={completionNotes}
                    onChange={(e) => setCompletionNotes(e.target.value)}
                    className="min-h-[60px] resize-none text-xs"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      className="h-8 gap-1.5 text-xs"
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
                      className="h-8 gap-1.5 text-xs"
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
                    className="h-8 gap-1.5 text-xs"
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
