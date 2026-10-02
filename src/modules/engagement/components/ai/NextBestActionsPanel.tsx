/**
 * NextBestActionsPanel — prioritized list of AI-recommended actions.
 * Consumes useNextBestActions, useCompleteAction, useDismissAction.
 */

import { motion, AnimatePresence } from "framer-motion";
import {
  Phone,
  Mail,
  Calendar,
  Clock,
  FileText,
  AlertCircle,
  MoreHorizontal,
  Check,
  X,
  Sparkles,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useNextBestActions,
  useCompleteAction,
  useDismissAction,
  type ActionType,
} from "@/modules/engagement/hooks/useNextBestActions";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

// ── Action type config ────────────────────────────────────────

// `color` = fundo + texto do chip do ícone. Só tokens: vale no escuro.
const ACTION_CONFIG: Record<ActionType, { icon: typeof Phone; color: string; label: string }> = {
  call: { icon: Phone, color: "bg-insights/10 text-insights", label: "Ligar" },
  email: { icon: Mail, color: "bg-silver/15 text-silver", label: "E-mail" },
  meeting: { icon: Calendar, color: "bg-success/10 text-success", label: "Reunião" },
  follow_up: { icon: Clock, color: "bg-warning/15 text-warning-strong", label: "Follow-up" },
  send_proposal: { icon: FileText, color: "bg-primary-soft text-primary-soft-foreground", label: "Proposta" },
  escalate: { icon: AlertCircle, color: "bg-destructive/10 text-destructive", label: "Escalar" },
  other: { icon: MoreHorizontal, color: "bg-muted text-muted-foreground", label: "Outro" },
};

/** Cabeçalho de cartão do V5: ícone em chip, título 15 px, contador opcional. */
function PanelTitle({ count, muted = false }: { count?: number; muted?: boolean }) {
  return (
    <CardTitle className="flex items-center gap-2 text-[15px] tracking-[-0.02em]">
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-[10px]",
          muted ? "bg-muted text-foreground/60" : "bg-primary-soft text-primary-soft-foreground",
        )}
      >
        <Zap className="h-4 w-4" strokeWidth={2.2} />
      </span>
      Próximas ações
      {typeof count === "number" && (
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
          {count} pendente{count !== 1 ? "s" : ""}
        </span>
      )}
    </CardTitle>
  );
}

// ── Component ─────────────────────────────────────────────────

interface NextBestActionsPanelProps {
  limit?: number;
  compact?: boolean;
}

export function NextBestActionsPanel({ limit = 10, compact = false }: NextBestActionsPanelProps) {
  const { data: actions = [], isLoading } = useNextBestActions(limit);
  const completeAction = useCompleteAction();
  const dismissAction = useDismissAction();

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <PanelTitle />
        </CardHeader>
        <CardContent className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (actions.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <PanelTitle muted />
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <Sparkles className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold">
              Nenhuma ação recomendada no momento.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <PanelTitle count={actions.length} />
      </CardHeader>
      <CardContent>
        <div className={cn("space-y-2", !compact && "max-h-[500px] overflow-y-auto pr-1")}>
          <AnimatePresence initial={false}>
            {actions.map((action, idx) => {
              const config = ACTION_CONFIG[action.action_type] || ACTION_CONFIG.other;
              const Icon = config.icon;

              return (
                <motion.div
                  key={action.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  transition={{ delay: idx * 0.03 }}
                  className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-3 transition-colors hover:bg-muted/40"
                >
                  {/* Icon */}
                  <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-[10px]", config.color)}>
                    <Icon className="h-4 w-4" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{action.title}</p>
                        {action.lead_name && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {action.lead_name}
                          </p>
                        )}
                      </div>
                      <Badge variant="soft" className="shrink-0 px-2 py-0 text-[10px]">
                        {config.label}
                      </Badge>
                    </div>

                    {!compact && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {action.reason}
                      </p>
                    )}

                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-2">
                        {action.due_by && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDistanceToNow(new Date(action.due_by), {
                              addSuffix: true,
                              locale: ptBR,
                            })}
                          </span>
                        )}
                        {action.priority >= 8 && (
                          <Badge variant="soft" className="bg-destructive/10 px-2 py-0 text-[10px] font-bold text-destructive">
                            Urgente
                          </Badge>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                          onClick={() => dismissAction.mutate(action.id)}
                          aria-label="Dispensar"
                          disabled={dismissAction.isPending}
                          title="Dispensar"
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 rounded-lg text-success hover:bg-success/10 hover:text-success"
                          onClick={() => completeAction.mutate(action.id)}
                          aria-label="Concluir"
                          disabled={completeAction.isPending}
                          title="Concluir"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </CardContent>
    </Card>
  );
}
