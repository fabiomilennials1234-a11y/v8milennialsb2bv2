/**
 * DispatchQueueSheet — modal mostrando itens detalhados da fila de disparos.
 * Usado em campanhas e pipes para visualizar pendentes, falhados, enviados, etc.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageSquare,
  ArrowRightLeft,
  UserPlus,
  Ban,
  Hourglass,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Play,
  Loader2,
  AlertTriangle,
  User,
  Mail,
  Phone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { QueueItem } from "@/hooks/useDispatchQueueItems";

const ACTION_ICONS: Record<string, typeof MessageSquare> = {
  send_template: MessageSquare,
  wait_response: Hourglass,
  change_stage: ArrowRightLeft,
  assign_sdr: UserPlus,
  cancel_sequence: Ban,
};

const ACTION_LABELS: Record<string, string> = {
  send_template: "Enviar template",
  wait_response: "Esperar resposta",
  change_stage: "Mudar etapa",
  assign_sdr: "Atribuir SDR",
  cancel_sequence: "Cancelar sequência",
};

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  scheduled: { icon: Clock, color: "text-yellow-500", label: "Agendado" },
  processing: { icon: Loader2, color: "text-yellow-500", label: "Processando" },
  sent: { icon: CheckCircle2, color: "text-green-500", label: "Enviado" },
  failed: { icon: XCircle, color: "text-red-500", label: "Falhou" },
  waiting_response: { icon: Hourglass, color: "text-blue-500", label: "Aguardando" },
  response_received: { icon: CheckCircle2, color: "text-green-500", label: "Respondido" },
  timed_out: { icon: AlertTriangle, color: "text-amber-500", label: "Timeout" },
  executed: { icon: ArrowRightLeft, color: "text-purple-500", label: "Executado" },
  cancelled: { icon: Ban, color: "text-muted-foreground", label: "Cancelado" },
};

interface DispatchQueueSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  statusFilter: string;
  items: QueueItem[];
  isLoading: boolean;
  onRetry?: (ids: string[]) => void;
  isRetrying?: boolean;
  onProcessQueue?: () => void;
  isProcessing?: boolean;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DispatchQueueSheet({
  open,
  onOpenChange,
  title,
  statusFilter,
  items,
  isLoading,
  onRetry,
  isRetrying,
  onProcessQueue,
  isProcessing,
}: DispatchQueueSheetProps) {
  const statusInfo = STATUS_CONFIG[statusFilter] ?? STATUS_CONFIG.scheduled;
  const StatusIcon = statusInfo.icon;

  const failedIds = items.filter((i) => i.status === "failed").map((i) => i.id);
  const scheduledIds = items.filter((i) => i.status === "scheduled" || i.status === "processing").map((i) => i.id);

  const showFooter =
    (statusFilter === "failed" && failedIds.length > 0 && onRetry) ||
    (statusFilter === "scheduled" && scheduledIds.length > 0 && onProcessQueue);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StatusIcon className={cn("w-5 h-5", statusInfo.color)} />
            {statusInfo.label} ({items.length})
          </DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Carregando...
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              Nenhum item encontrado
            </div>
          ) : (
            <div className="space-y-3 pb-2">
              {items.map((item) => (
                <QueueItemCard
                  key={item.id}
                  item={item}
                  onRetry={
                    item.status === "failed" && onRetry
                      ? () => onRetry([item.id])
                      : undefined
                  }
                  isRetrying={isRetrying}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer actions */}
        {showFooter && (
          <div className="pt-4 border-t flex flex-wrap gap-2">
            {statusFilter === "failed" && failedIds.length > 0 && onRetry && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRetry(failedIds)}
                disabled={isRetrying}
              >
                {isRetrying ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Reenviar todos ({failedIds.length})
              </Button>
            )}
            {statusFilter === "scheduled" && scheduledIds.length > 0 && onProcessQueue && (
              <Button
                size="sm"
                variant="secondary"
                onClick={onProcessQueue}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                Processar fila agora
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Individual queue item card ────────────────────────────────────────────

function QueueItemCard({
  item,
  onRetry,
  isRetrying,
}: {
  item: QueueItem;
  onRetry?: () => void;
  isRetrying?: boolean;
}) {
  const ActionIcon = ACTION_ICONS[item.action_type] ?? MessageSquare;
  const actionLabel = ACTION_LABELS[item.action_type] ?? item.action_type;
  const statusCfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.scheduled;
  const ItemStatusIcon = statusCfg.icon;

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      {/* Header: action + status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ActionIcon className="w-4 h-4 text-muted-foreground" />
          {actionLabel}
        </div>
        <div className={cn("flex items-center gap-1 text-xs", statusCfg.color)}>
          <ItemStatusIcon className="w-3 h-3" />
          {statusCfg.label}
        </div>
      </div>

      {/* Lead info */}
      <div className="text-sm text-muted-foreground space-y-0.5">
        {item.lead_name && (
          <div className="flex items-center gap-1.5">
            <User className="w-3 h-3" />
            <span>{item.lead_name}</span>
          </div>
        )}
        {item.lead_phone && (
          <div className="flex items-center gap-1.5">
            <Phone className="w-3 h-3" />
            <span>{item.lead_phone}</span>
          </div>
        )}
        {item.lead_email && !item.lead_phone && (
          <div className="flex items-center gap-1.5">
            <Mail className="w-3 h-3" />
            <span>{item.lead_email}</span>
          </div>
        )}
      </div>

      {/* Details based on action type */}
      <div className="text-xs text-muted-foreground space-y-0.5">
        {item.template_name && (
          <p>Template: <span className="text-foreground">{item.template_name}</span></p>
        )}
        {item.target_stage_name && (
          <p>Etapa destino: <span className="text-foreground">{item.target_stage_name}</span></p>
        )}
        {item.sdr_name && (
          <p>Resp: <span className="text-foreground">{item.sdr_name}</span></p>
        )}
        <p>
          {item.sent_at
            ? `Enviado: ${formatDateTime(item.sent_at)}`
            : `Agendado: ${formatDateTime(item.scheduled_at)}`}
        </p>
      </div>

      {/* Error message */}
      {item.error_message && (
        <div className="text-xs bg-red-500/10 text-red-500 rounded px-2 py-1.5 flex items-start gap-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{item.error_message}</span>
        </div>
      )}

      {/* Retry button for individual failed item */}
      {onRetry && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={onRetry}
          disabled={isRetrying}
        >
          <RefreshCw className="w-3 h-3 mr-1" />
          Reenviar
        </Button>
      )}
    </div>
  );
}
