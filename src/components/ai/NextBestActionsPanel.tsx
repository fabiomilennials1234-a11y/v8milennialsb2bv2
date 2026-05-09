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
} from "@/hooks/useNextBestActions";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

// ── Action type config ────────────────────────────────────────

const ACTION_CONFIG: Record<ActionType, { icon: typeof Phone; color: string; label: string }> = {
  call: { icon: Phone, color: "text-blue-500", label: "Ligar" },
  email: { icon: Mail, color: "text-purple-500", label: "Email" },
  meeting: { icon: Calendar, color: "text-emerald-500", label: "Reuniao" },
  follow_up: { icon: Clock, color: "text-amber-500", label: "Follow-up" },
  send_proposal: { icon: FileText, color: "text-primary", label: "Proposta" },
  escalate: { icon: AlertCircle, color: "text-red-500", label: "Escalar" },
  other: { icon: MoreHorizontal, color: "text-muted-foreground", label: "Outro" },
};

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
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            Proximas acoes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (actions.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-muted-foreground" />
            Proximas acoes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <Sparkles className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Nenhuma acao recomendada no momento.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            Proximas acoes
          </span>
          <Badge variant="outline" className="text-xs font-normal">
            {actions.length} pendente{actions.length !== 1 ? "s" : ""}
          </Badge>
        </CardTitle>
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
                  className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-card hover:bg-muted/50 transition-colors"
                >
                  {/* Icon */}
                  <div className={cn("p-2 rounded-lg bg-muted shrink-0", config.color)}>
                    <Icon className="w-4 h-4" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{action.title}</p>
                        {action.lead_name && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {action.lead_name}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">
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
                          <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-500 border-red-500/20">
                            Urgente
                          </Badge>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => dismissAction.mutate(action.id)}
                          disabled={dismissAction.isPending}
                          title="Dispensar"
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-emerald-600 hover:text-emerald-500 hover:bg-emerald-500/10"
                          onClick={() => completeAction.mutate(action.id)}
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
