import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  Bell,
  Calendar,
  CheckCircle,
  ChevronRight,
  Clock,
  MessageSquare,
  UserPlus,
  Zap,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { instanteDoAviso, type Aviso } from "../../lib/aviso-stream";
import { useAvisos } from "../../hooks/useAvisos";

/**
 * O sino. A lista vem inteira do banco (ADR-0035): nada é derivado aqui, e o
 * "não lido" é estado da linha, não memória do navegador.
 */

const ICONES: Record<string, { icone: typeof Bell; classe: string; fundo: string }> = {
  lead_message: { icone: MessageSquare, classe: "text-chart-5", fundo: "bg-chart-5/10" },
  lead_new: { icone: UserPlus, classe: "text-success", fundo: "bg-success/10" },
  meeting_booked: { icone: Calendar, classe: "text-primary", fundo: "bg-primary/10" },
  meeting_soon: { icone: Zap, classe: "text-chart-5", fundo: "bg-chart-5/10" },
  follow_up_due: { icone: Clock, classe: "text-warning", fundo: "bg-warning/10" },
  follow_up_overdue: { icone: AlertTriangle, classe: "text-destructive", fundo: "bg-destructive/10" },
  workflow_alert: { icone: AlertTriangle, classe: "text-destructive", fundo: "bg-destructive/10" },
  cron_drift: { icone: AlertTriangle, classe: "text-destructive", fundo: "bg-destructive/10" },
  transfer_to_human: { icone: UserPlus, classe: "text-destructive", fundo: "bg-destructive/10" },
};

const PADRAO = { icone: Bell, classe: "text-muted-foreground", fundo: "bg-muted/50" };

/** Os tipos que valem interromper alguém — o resto conta, mas não grita. */
const URGENTES = new Set(["workflow_alert", "cron_drift", "lead_message", "transfer_to_human"]);

export function AlertsDropdown() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { avisos, naoLidos, marcarComoLido, marcarTodosComoLidos } = useAvisos();

  const urgentesNaoLidos = avisos.filter(
    (a) => a.read_at === null && URGENTES.has(a.type),
  ).length;

  const aoClicar = async (aviso: Aviso) => {
    if (aviso.read_at === null) {
      await marcarComoLido(aviso.id);
    }
    if (aviso.link) {
      navigate(aviso.link);
      setOpen(false);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notificações">
          <Bell className="w-5 h-5" />
          {naoLidos > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className={cn(
                "absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                urgentesNaoLidos > 0
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-primary text-primary-foreground",
              )}
            >
              {naoLidos > 9 ? "9+" : naoLidos}
            </motion.span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold">Notificações</h3>
          {naoLidos > 0 && (
            <Badge variant="outline" className="text-xs">
              {naoLidos} {naoLidos === 1 ? "não lida" : "não lidas"}
            </Badge>
          )}
        </div>

        {avisos.length > 0 ? (
          <ScrollArea className="h-[300px]">
            <div className="p-2 space-y-1">
              <AnimatePresence mode="popLayout">
                {avisos.map((aviso, index) => {
                  const visual = ICONES[aviso.type] ?? PADRAO;
                  const Icone = visual.icone;
                  return (
                    <motion.div
                      key={aviso.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      transition={{ delay: Math.min(index, 6) * 0.05 }}
                      onClick={() => aoClicar(aviso)}
                      className={cn(
                        "p-3 rounded-lg cursor-pointer transition-colors hover:bg-muted/50",
                        aviso.read_at === null ? visual.fundo : "opacity-60",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5">
                          <Icone className={cn("w-4 h-4", visual.classe)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">
                            {aviso.title}
                            {aviso.event_count > 1 && (
                              <span className="ml-1.5 text-xs font-semibold text-muted-foreground tabular-nums">
                                ×{aviso.event_count}
                              </span>
                            )}
                          </p>
                          {aviso.description && (
                            <p className="text-xs text-muted-foreground truncate">
                              {aviso.description}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDistanceToNow(new Date(instanteDoAviso(aviso)), {
                              addSuffix: true,
                              locale: ptBR,
                            })}
                          </p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground mt-1" />
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </ScrollArea>
        ) : (
          <div className="p-8 text-center">
            <CheckCircle className="w-12 h-12 text-success/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Tudo em dia! Nenhuma notificação pendente.
            </p>
          </div>
        )}

        {naoLidos > 0 && (
          <button
            type="button"
            onClick={() => marcarTodosComoLidos()}
            className="w-full p-2.5 text-xs text-muted-foreground border-t border-border hover:bg-muted/50 transition-colors"
          >
            Marcar todas como lidas
          </button>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
