import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format, isPast, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  MessageSquare,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Calendar,
  Kanban,
  Bot,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScheduleMessageModal } from "@/components/chat/ScheduleMessageModal";
import { useOpenWhatsAppChat, formatPhoneForWhatsApp } from "@/lib/whatsapp";
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
  confirmacao: Calendar,
  propostas: Kanban,
};

function formatTaskDate(date: Date): string {
  if (isToday(date)) return format(date, "'Hoje' HH:mm");
  return format(date, "dd/MM HH:mm", { locale: ptBR });
}

// ─── Component ───────────────────────────────────────────

interface RevisionItemProps {
  task: RevisionTask;
  onComplete: (id: string) => void;
  onCancel?: (id: string) => void;
  onArchive?: (id: string) => void;
  onDelete?: (id: string) => void;
  canDelete?: boolean;
}

export function RevisionItem({
  task,
  onComplete,
  onCancel,
  onArchive,
  onDelete,
  canDelete,
}: RevisionItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [showCompletionBanner, setShowCompletionBanner] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const openWhatsApp = useOpenWhatsAppChat();

  const isOverdue = !task.isCompleted && isPast(task.scheduledAt);
  const hasPhone = !!formatPhoneForWhatsApp(task.leadPhone ?? undefined);

  const handleComplete = () => {
    onComplete(task.id);
    if (task.type === "follow-up") {
      setShowCompletionBanner(true);
      setTimeout(() => setShowCompletionBanner(false), 5000);
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
        {/* Checkbox */}
        <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={task.isCompleted}
            onCheckedChange={() => handleComplete()}
          />
        </div>

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

      {/* Completion Banner */}
      <AnimatePresence>
        {showCompletionBanner && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center justify-between gap-3 mx-2 mb-2 px-4 py-2.5 rounded-lg bg-success/5 border border-success/20">
              <span className="text-sm text-foreground/80">
                Concluído · Enviar mensagem para o lead?
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    setScheduleModalOpen(true);
                    setShowCompletionBanner(false);
                  }}
                >
                  Agendar
                </Button>
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

      {/* Expanded */}
      <AnimatePresence>
        {expanded && !task.isCompleted && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="ml-9 mr-2 mb-3 p-3 rounded-lg bg-muted/20 border border-border/50 space-y-2">
              {task.type === "follow-up" && task.description && (
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

              <div className="flex items-center gap-2 pt-1">
                {hasPhone && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                    onClick={(e) => { e.stopPropagation(); openWhatsApp(task.leadPhone); }}>
                    <ExternalLink className="w-3 h-3" /> WhatsApp
                  </Button>
                )}
                {task.type === "follow-up" && onArchive && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs"
                    onClick={(e) => { e.stopPropagation(); onArchive(task.id); }}>
                    Arquivar
                  </Button>
                )}
                {task.type === "scheduled-message" && onCancel && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs"
                    onClick={(e) => { e.stopPropagation(); onCancel(task.id); }}>
                    Cancelar envio
                  </Button>
                )}
                {canDelete && onDelete && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}>
                    Excluir
                  </Button>
                )}
              </div>
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
    </>
  );
}
