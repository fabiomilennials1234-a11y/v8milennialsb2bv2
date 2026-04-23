/**
 * SyncProgressCard — renderiza status de 1 history_sync_job.
 *
 * States:
 *  - queued: spinner + "Na fila"
 *  - running: progress bar estimada
 *  - completed: check + total_fetched
 *  - failed: error message + Retry button
 */
import { CheckCircle2, Loader2, XCircle, RefreshCw, Clock, StopCircle } from "lucide-react";
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

function formatElapsed(started: string | null, completed: string | null): string {
  if (!started) return "—";
  const end = completed ? new Date(completed) : new Date();
  const elapsedMs = end.getTime() - new Date(started).getTime();
  const m = Math.floor(elapsedMs / 60000);
  const s = Math.floor((elapsedMs % 60000) / 1000);
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function SyncProgressCard({ job }: Props) {
  const control = useControlHistorySyncJob();
  const isActive = job.status === "running" || job.status === "queued";

  const estimatedTotal =
    job.scope === "full"
      ? Math.max(job.total_fetched * 2, 1000)
      : job.max_messages_per_chat * job.max_chats;
  const progressPct = Math.min(100, Math.round((job.total_fetched / estimatedTotal) * 100));

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

  return (
    <Card className={cn(job.status === "failed" && "border-destructive/40")}>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {job.status === "running" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              {job.status === "queued" && <Clock className="h-4 w-4 text-muted-foreground" />}
              {job.status === "completed" && <CheckCircle2 className="h-4 w-4 text-green-600" />}
              {job.status === "failed" && <XCircle className="h-4 w-4 text-destructive" />}
              {job.status === "paused" && <StopCircle className="h-4 w-4 text-muted-foreground" />}
              <span className="font-medium text-sm">
                {job.scope === "default" && "Sync padrão (30d)"}
                {job.scope === "full" && "Sync completo"}
                {job.scope === "chat" && `Chat específico: ${job.chat_jid ?? ""}`}
              </span>
              <Badge variant={job.status === "failed" ? "destructive" : "secondary"} className="text-[10px]">
                {job.status}
              </Badge>
            </div>

            <div className="text-xs text-muted-foreground mt-1 flex gap-3 flex-wrap">
              <span>{job.total_fetched} mensagens</span>
              <span>
                duração: {formatElapsed(job.started_at, job.completed_at)}
              </span>
            </div>

            {isActive && (
              <Progress value={progressPct} className="mt-2 h-1.5" />
            )}

            {job.status === "failed" && job.error && (
              <p className="text-xs text-destructive mt-2 break-words" role="alert">
                {job.error}
              </p>
            )}
          </div>

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
