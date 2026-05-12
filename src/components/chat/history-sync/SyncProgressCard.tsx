/**
 * SyncProgressCard — renderiza status de 1 history_sync_job.
 *
 * v2: real progress (Chat X/Y), ETA, chat_errors expandable, chats_skipped.
 */
import { CheckCircle2, Loader2, XCircle, RefreshCw, Clock, StopCircle, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  useControlHistorySyncJob,
  type HistorySyncJob,
} from "@/hooks/useHistorySyncJobs";
import { cn } from "@/lib/utils";

interface Props {
  job: HistorySyncJob;
}

const scopeLabels: Record<string, string> = {
  default: "Sync padrão (30d)",
  full: "Sync completo",
  chat: "Chat específico",
  incremental: "Atualização incremental",
};

function formatElapsed(started: string | null, completed: string | null): string {
  if (!started) return "—";
  const end = completed ? new Date(completed) : new Date();
  const elapsedMs = end.getTime() - new Date(started).getTime();
  const m = Math.floor(elapsedMs / 60000);
  const s = Math.floor((elapsedMs % 60000) / 1000);
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatEta(job: HistorySyncJob): string | null {
  if (!job.started_at || !job.total_chats || job.total_chats <= 0) return null;
  const elapsedMs = Date.now() - new Date(job.started_at).getTime();
  if (elapsedMs < 5000) return null; // too early
  const completed = job.chats_completed ?? 0;
  if (completed <= 0) return null;
  const rate = completed / (elapsedMs / 1000);
  const remaining = job.total_chats - completed - (job.chats_skipped ?? 0);
  if (remaining <= 0) return null;
  const etaSec = remaining / rate;
  const etaMin = Math.ceil(etaSec / 60);
  return etaMin > 0 ? `~${etaMin} min` : "< 1 min";
}

export function SyncProgressCard({ job }: Props) {
  const control = useControlHistorySyncJob();
  const isActive = job.status === "running" || job.status === "queued";

  const hasRealProgress = job.total_chats != null && job.total_chats > 0;
  const chatsCompleted = job.chats_completed ?? 0;
  const progressPct = hasRealProgress
    ? Math.min(100, Math.round((chatsCompleted / job.total_chats!) * 100))
    : Math.min(
        100,
        Math.round(
          (job.total_fetched /
            (job.scope === "full"
              ? Math.max(job.total_fetched * 2, 1000)
              : job.max_messages_per_chat * job.max_chats)) *
            100
        )
      );

  const chatErrors = (job.chat_errors && typeof job.chat_errors === "object" && !Array.isArray(job.chat_errors))
    ? (job.chat_errors as Record<string, string>)
    : {};
  const errorCount = Object.keys(chatErrors).length;
  const eta = isActive ? formatEta(job) : null;

  const handleCancel = async () => {
    try {
      await control.mutateAsync({ job, action: "cancel" });
      toast.success("Job cancelado");
    } catch (e) {
      toast.error(`Erro ao cancelar: ${(e as Error).message}`);
    }
  };

  const handleRetry = async () => {
    try {
      await control.mutateAsync({ job, action: "retry" });
      toast.success("Retry agendado");
    } catch (e) {
      toast.error(`Erro ao retentar: ${(e as Error).message}`);
    }
  };

  const scopeLabel = job.scope === "chat"
    ? `Chat: ${(job.chat_jid ?? "").split("@")[0]}`
    : scopeLabels[job.scope] ?? job.scope;

  return (
    <Card className={cn(job.status === "failed" && "border-destructive/40")}>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Header row */}
            <div className="flex items-center gap-2 flex-wrap">
              {job.status === "running" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              {job.status === "queued" && <Clock className="h-4 w-4 text-muted-foreground" />}
              {job.status === "completed" && <CheckCircle2 className="h-4 w-4 text-green-600" />}
              {job.status === "failed" && <XCircle className="h-4 w-4 text-destructive" />}
              {job.status === "paused" && <StopCircle className="h-4 w-4 text-muted-foreground" />}
              <span className="font-medium text-sm">{scopeLabel}</span>
              {job.triggered_by === "auto_connect" && (
                <Badge variant="outline" className="text-[10px] gap-1">
                  <Zap className="h-2.5 w-2.5" />auto
                </Badge>
              )}
              <Badge variant={job.status === "failed" ? "destructive" : "secondary"} className="text-[10px]">
                {job.status}
              </Badge>
            </div>

            {/* Progress stats */}
            <div className="text-xs text-muted-foreground mt-1 flex gap-3 flex-wrap">
              {hasRealProgress && isActive ? (
                <span>
                  Chat {chatsCompleted}/{job.total_chats}
                  {" • "}
                  {job.total_fetched.toLocaleString("pt-BR")} msgs
                  {eta && ` • ${eta}`}
                </span>
              ) : (
                <span>{job.total_fetched.toLocaleString("pt-BR")} mensagens</span>
              )}
              <span>{formatElapsed(job.started_at, job.completed_at)}</span>
            </div>

            {/* Skipped info */}
            {(job.chats_skipped ?? 0) > 0 && (
              <span className="text-[11px] text-muted-foreground/70">
                {job.chats_skipped} chats pulados (já sincronizados)
              </span>
            )}

            {/* Progress bar */}
            {isActive && (
              <Progress value={progressPct} className="mt-2 h-1.5" />
            )}

            {/* Error message */}
            {job.status === "failed" && job.error && (
              <p className="text-xs text-destructive mt-2 break-words" role="alert">
                {job.error}
              </p>
            )}

            {/* Per-chat errors expandable */}
            {errorCount > 0 && (
              <details className="mt-2">
                <summary className="text-xs text-destructive/80 cursor-pointer hover:text-destructive">
                  {errorCount} {errorCount === 1 ? "chat com erro" : "chats com erro"}
                </summary>
                <ul className="text-[11px] text-muted-foreground mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                  {Object.entries(chatErrors).map(([jid, err]) => (
                    <li key={jid} className="break-all">
                      <span className="font-mono text-foreground/60">{jid.split("@")[0]}</span>
                      {": "}
                      {err}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-1">
            {isActive && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleCancel}
                disabled={control.isPending}
                aria-label="Cancelar job"
              >
                <StopCircle className="h-3.5 w-3.5" />
              </Button>
            )}
            {job.status === "failed" && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleRetry}
                disabled={control.isPending}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                Retentar
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
