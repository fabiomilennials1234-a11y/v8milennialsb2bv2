/**
 * AITimeline — feed cronológico de ações da IA sobre um lead.
 *
 * C31: 7 event types, connector vertical, revert action, motion prefers-reduced-motion.
 *
 * Semântica: <ol> cronológico com <li> por evento.
 * Acessibilidade: <time dateTime>, aria-expanded, aria-label no revert btn.
 */
import { useState, useEffect } from "react";
import {
  Send,
  Zap,
  ArrowRight,
  Tag,
  Clock,
  Hand,
  Undo2,
  ChevronDown,
  AlertCircle,
  Megaphone,
  BadgeDollarSign,
  Wrench,
  DatabaseBackup,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useAITimeline } from "@/hooks/chat/useAITimeline";
import type { AiTimelineEvent, AiEventType } from "@/hooks/chat/useAITimeline";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return reduced;
}

// ─── Configuração de eventos ───────────────────────────────────────────────────

const EVENT_CONFIG: Record<
  AiEventType,
  {
    icon: typeof Send;
    colorClass: string;
    label: string;
    revertible: boolean;
  }
> = {
  message_sent: {
    icon: Send,
    colorClass: "text-primary",
    label: "Mensagem enviada",
    revertible: false,
  },
  action_executed: {
    icon: Zap,
    colorClass: "text-amber-500",
    label: "Ação executada",
    revertible: true,
  },
  stage_moved: {
    icon: ArrowRight,
    colorClass: "text-blue-500",
    label: "Stage movido",
    revertible: true,
  },
  tag_added: {
    icon: Tag,
    colorClass: "text-purple-500",
    label: "Tag adicionada",
    revertible: true,
  },
  silence_detected: {
    icon: Clock,
    colorClass: "text-muted-foreground",
    label: "Silêncio detectado",
    revertible: false,
  },
  handoff_triggered: {
    icon: Hand,
    colorClass: "text-orange-500",
    label: "Handoff solicitado",
    revertible: false,
  },
  reverted: {
    icon: Undo2,
    colorClass: "text-destructive",
    label: "Ação revertida",
    revertible: false,
  },
  // Eventos Uazapi (Onda 5)
  mass_send_completed: {
    icon: Megaphone,
    colorClass: "text-blue-500",
    label: "Campanha enviada",
    revertible: false,
  },
  pix_paid: {
    icon: BadgeDollarSign,
    colorClass: "text-green-500",
    label: "Pix recebido",
    revertible: false,
  },
  repair_executed: {
    icon: Wrench,
    colorClass: "text-amber-500",
    label: "Conexão reparada",
    revertible: false,
  },
  history_sync_finished: {
    icon: DatabaseBackup,
    colorClass: "text-primary",
    label: "Histórico importado",
    revertible: false,
  },
};

// ─── Formatação de tempo ───────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// ─── AITimelineEvent ──────────────────────────────────────────────────────────

function AITimelineEventItem({
  event,
  isLast,
  onRevert,
  prefersReduced,
}: {
  event: AiTimelineEvent;
  isLast: boolean;
  onRevert: (event: AiTimelineEvent) => void;
  prefersReduced: boolean;
}) {
  const config = EVENT_CONFIG[event.type];
  const EventIcon = config.icon;
  const timeLabel = formatTime(event.created_at);
  const canRevert = config.revertible && event.is_reversible && !event.reverted;

  return (
    <motion.li
      layout
      initial={prefersReduced ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={prefersReduced ? { duration: 0 } : { duration: 0.22, ease: "easeOut" }}
      className="relative flex gap-3 px-4 py-2 group hover:bg-muted/10 transition-colors duration-100"
    >
      {/* Connector vertical */}
      {!isLast && (
        <div className="absolute left-[calc(1rem+14px)] top-[28px] bottom-0 border-l border-border/30" />
      )}

      {/* Timestamp */}
      <time
        dateTime={event.created_at}
        className="min-w-[44px] pt-0.5 text-[10px] text-muted-foreground tabular-nums leading-none shrink-0"
      >
        {timeLabel}
      </time>

      {/* Ícone + conteúdo */}
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <EventIcon
            className={cn("h-3.5 w-3.5 shrink-0", config.colorClass)}
            aria-hidden
          />
          <span className="text-xs font-medium text-foreground leading-tight">
            {config.label}
          </span>
        </div>
        {event.description && (
          <p className="text-[11px] text-muted-foreground leading-tight truncate">
            {event.description}
          </p>
        )}
        {canRevert && (
          <button
            type="button"
            aria-label={`Reverter: ${config.label} às ${timeLabel}`}
            className={cn(
              "mt-0.5 text-[10px] text-muted-foreground",
              "hover:text-destructive transition-colors duration-100",
              "opacity-0 group-hover:opacity-100 transition-opacity duration-150",
              "self-start leading-none"
            )}
            onClick={() => onRevert(event)}
          >
            Reverter
          </button>
        )}
      </div>
    </motion.li>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function AITimelineSkeleton() {
  return (
    <div className="py-2 px-4 space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-10 bg-muted/40 rounded animate-pulse" />
      ))}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export interface AITimelineProps {
  leadId: string | null | undefined;
}

export function AITimeline({ leadId }: AITimelineProps) {
  const prefersReduced = usePrefersReducedMotion();
  const [expanded, setExpanded] = useState(true);
  const { data: events = [], isLoading, error, revert } = useAITimeline(leadId);

  return (
    <section aria-label="Histórico de ações da IA">
      {/* Header colapsável */}
      <button
        type="button"
        className={cn(
          "flex items-center justify-between w-full",
          "px-4 py-3 text-left",
          "border-b border-border/40",
          "hover:bg-muted/20 transition-colors duration-100"
        )}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Histórico da IA
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
            !expanded && "-rotate-90"
          )}
          aria-hidden
        />
      </button>

      {/* Conteúdo */}
      {expanded && (
        <>
          {isLoading && <AITimelineSkeleton />}

          {error && !isLoading && (
            <div className="flex items-center gap-1.5 px-4 py-4 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Erro ao carregar histórico da IA
            </div>
          )}

          {!isLoading && !error && events.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6 px-4">
              Nenhuma ação da IA registrada
            </p>
          )}

          {!isLoading && !error && events.length > 0 && (
            <ScrollArea className="max-h-[320px]">
              <ol>
                <AnimatePresence initial={false}>
                  {events.map((event, index) => (
                    <AITimelineEventItem
                      key={event.id}
                      event={event}
                      isLast={index === events.length - 1}
                      onRevert={revert}
                      prefersReduced={prefersReduced}
                    />
                  ))}
                </AnimatePresence>
              </ol>
            </ScrollArea>
          )}
        </>
      )}
    </section>
  );
}
