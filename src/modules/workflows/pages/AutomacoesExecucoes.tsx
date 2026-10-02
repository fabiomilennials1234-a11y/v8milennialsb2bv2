import { useParams } from "react-router-dom";
import { useWorkflow, useWorkflowExecutions, useWorkflowExecutionSteps, useWorkflowButtonHistory, useRetryWorkflowExecution } from "@/modules/workflows/hooks/useWorkflows";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Activity, CheckCircle2, XCircle, Clock, Pause, AlertTriangle, Loader2, RotateCw, LockKeyhole, Ban } from "lucide-react";
import { KpiTile } from "@/components/ui/bento";
import { PageHeader } from "@/components/ui/page-header";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import SplitAbAnalytics from "@/modules/workflows/components/SplitAbAnalytics";
import { AlertsBanner } from "@/modules/platform/components/system-alerts/AlertsBanner";

// V5: tons de estado do Badge — verde concluído, vermelho falha, azul em curso.
const STATUS_CONFIG: Record<string, { label: string; variant: "info" | "soft" | "success" | "destructive" | "warning"; icon: typeof CheckCircle2 }> = {
  running: { label: "Executando", variant: "info", icon: Loader2 },
  processing: { label: "Processando", variant: "info", icon: Loader2 },
  paused: { label: "Pausado", variant: "soft", icon: Pause },
  completed: { label: "Concluído", variant: "success", icon: CheckCircle2 },
  failed: { label: "Falhou", variant: "destructive", icon: XCircle },
  cancelled: { label: "Cancelado", variant: "soft", icon: XCircle },
  loop_limit_reached: { label: "Limite de Loop", variant: "destructive", icon: AlertTriangle },
  waiting_response: { label: "Aguardando Resposta", variant: "warning", icon: Clock },
};

const STEP_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  success: { label: "Sucesso", color: "text-success" },
  failed: { label: "Falhou", color: "text-destructive" },
  skipped: { label: "Pulado", color: "text-muted-foreground" },
};

const ERROR_LABELS: Record<string, string> = {
  access_denied: "Acesso aos dados revogado",
  context_unavailable: "Contexto removido",
  reference_unavailable: "Referência indisponível",
  invalid_configuration: "Configuração inválida",
  history_insufficient: "Histórico insuficiente",
  history_sync_in_progress: "Histórico em sincronização",
  temporarily_unavailable: "Dados temporariamente indisponíveis",
  execution_version_unavailable: "Versão da execução indisponível",
  loop_limit_reached: "Limite de repetição atingido",
  protected_error: "Detalhe protegido pelas suas permissões atuais",
  execution_failed: "Falha na execução",
};

function errorLabel(code: string | null): string {
  if (!code) return "-";
  return ERROR_LABELS[code] ?? "Falha na execução";
}

export default function AutomacoesExecucoes() {
  const { id } = useParams<{ id: string }>();
  const { data: workflow, isLoading: isLoadingWorkflow } = useWorkflow(id);
  const { data: executions, isLoading: isLoadingExecutions } = useWorkflowExecutions(id);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [retryTargetId, setRetryTargetId] = useState<string | null>(null);
  const retryMutation = useRetryWorkflowExecution();

  const handleRetry = async (executionId: string) => {
    try {
      await retryMutation.mutateAsync(executionId);
      toast.success("Execução repetida com sucesso. O fluxo será retomado a partir do ponto de falha.");
      setRetryTargetId(null);
      setSelectedExecutionId(null);
    } catch (err: any) {
      toast.error(err.message || "Erro ao repetir execução");
    }
  };

  if (isLoadingWorkflow || isLoadingExecutions) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Workflow não encontrado.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Onda 2: alerts dead-letter pattern (workflow execution falhas em padrão) */}
      <AlertsBanner category="dead_letter_pattern" />

      <PageHeader
        back={`/automacoes/${id}`}
        eyebrow="Histórico de execuções"
        title={workflow.name}
      />

      {/* Stats summary — os mesmos cinco números de antes, da mesma lista. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <KpiTile
          label="Total"
          icon={Activity}
          tone="neutral"
          value={(executions?.length ?? 0).toLocaleString("pt-BR")}
        />
        <KpiTile
          label="Concluídos"
          icon={CheckCircle2}
          tone="good"
          value={<span className="text-success">{(executions?.filter(e => e.status === "completed").length ?? 0).toLocaleString("pt-BR")}</span>}
        />
        <KpiTile
          label="Falharam"
          icon={XCircle}
          tone="bad"
          value={<span className="text-destructive">{(executions?.filter(e => e.status === "failed" || e.status === "loop_limit_reached").length ?? 0).toLocaleString("pt-BR")}</span>}
        />
        <KpiTile
          label="Cancelados"
          icon={Ban}
          tone="neutral"
          value={<span className="text-muted-foreground">{(executions?.filter(e => e.status === "cancelled").length ?? 0).toLocaleString("pt-BR")}</span>}
        />
        <KpiTile
          label="Em andamento"
          icon={Loader2}
          tone="info"
          value={<span className="text-insights">{(executions?.filter(e => e.status === "running" || e.status === "processing" || e.status === "paused" || e.status === "waiting_response").length ?? 0).toLocaleString("pt-BR")}</span>}
        />
      </div>

      {/* Split A/B Analytics */}
      {id && <SplitAbAnalytics workflowId={id} />}

      {/* Executions table */}
      {!executions?.length ? (
        <div className="rounded-card border border-dashed border-border bg-card/60 py-12 text-center text-sm text-muted-foreground">
          Nenhuma execução registrada ainda.
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-card-border bg-card shadow-relevo">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Versão</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duração</TableHead>
                <TableHead>Erro</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {executions.map((exec) => {
                const statusConf = STATUS_CONFIG[exec.status] || STATUS_CONFIG.running;
                const StatusIcon = statusConf.icon;
                const duration = exec.completed_at
                  ? formatDuration(new Date(exec.started_at), new Date(exec.completed_at))
                  : exec.status === "running" || exec.status === "processing"
                    ? "Em andamento..."
                    : "-";
                const retryOf = (exec as any).retry_of as string | null;

                return (
                  <TableRow
                    key={exec.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedExecutionId(exec.id)}
                  >
                    <TableCell className="whitespace-nowrap">
                      <div className="text-sm font-semibold tabular-nums">
                        {format(new Date(exec.started_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(exec.started_at), { addSuffix: true, locale: ptBR })}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
                      {exec.version_number ? `v${exec.version_number}` : "Legada"}
                    </TableCell>
                    <TableCell>
                      {exec.data_visible && exec.lead_id ? (
                        <LeadName leadId={exec.lead_id} name={exec.lead_name} />
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground text-sm">
                          <LockKeyhole className="h-3.5 w-3.5" /> Protegido
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant={statusConf.variant} className="gap-1">
                          <StatusIcon className="h-3 w-3" />
                          {statusConf.label}
                        </Badge>
                        {retryOf && (
                          <Badge variant="soft" className="gap-1 text-xs">
                            <RotateCw className="h-2.5 w-2.5" />
                            Retry
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm tabular-nums text-muted-foreground">
                      {duration}
                    </TableCell>
                    <TableCell className={`max-w-[200px] truncate text-sm ${exec.error_code ? "text-destructive" : "text-muted-foreground"}`}>
                      {errorLabel(exec.error_code)}
                    </TableCell>
                    <TableCell>
                      {exec.can_retry && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-[10px]"
                          title="Repetir execução"
                          aria-label="Repetir execução"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRetryTargetId(exec.id);
                          }}
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Steps dialog */}
      <StepsDialog
        executionId={selectedExecutionId}
        canRetry={executions?.find(e => e.id === selectedExecutionId)?.can_retry ?? false}
        dataVisible={executions?.find(e => e.id === selectedExecutionId)?.data_visible ?? false}
        open={!!selectedExecutionId}
        onClose={() => setSelectedExecutionId(null)}
        onRetry={(execId) => setRetryTargetId(execId)}
      />

      {/* Retry confirmation */}
      <AlertDialog open={!!retryTargetId} onOpenChange={(v) => !v && setRetryTargetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Repetir execução?</AlertDialogTitle>
            <AlertDialogDescription>
              O fluxo será retomado a partir do ponto onde falhou, reaproveitando o gatilho e contexto originais.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => retryTargetId && handleRetry(retryTargetId)}
              disabled={retryMutation.isPending}
            >
              {retryMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCw className="h-4 w-4" />
              )}
              Repetir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function LeadName({ leadId, name }: { leadId: string; name: string | null }) {
  return (
    <div>
      {name && <p className="text-sm font-medium">{name}</p>}
      <span className="text-xs font-mono text-muted-foreground">{leadId.slice(0, 8)}...</span>
    </div>
  );
}

function StepsDialog({
  executionId,
  canRetry,
  dataVisible,
  open,
  onClose,
  onRetry,
}: {
  executionId: string | null;
  canRetry: boolean;
  dataVisible: boolean;
  open: boolean;
  onClose: () => void;
  onRetry: (executionId: string) => void;
}) {
  const questions = useWorkflowButtonHistory(executionId ?? undefined);
  const { data: steps, isLoading } = useWorkflowExecutionSteps(dataVisible ? executionId || undefined : undefined);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-8">
            <DialogTitle>Steps da Execução</DialogTitle>
            {canRetry && executionId && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => onRetry(executionId)}
              >
                <RotateCw className="h-3.5 w-3.5" />
                Repetir a partir da falha
              </Button>
            )}
          </div>
        </DialogHeader>

        {questions.isError && <p className="text-sm text-muted-foreground">Histórico das perguntas indisponível ou protegido pelas suas permissões.</p>}
        {!questions.isError && questions.data?.map(question => (
          <div key={question.id} className="rounded-2xl border border-border/70 bg-sunken p-4 text-sm">
            <p className="font-semibold">Pergunta com botões</p>
            <p className="mt-1 text-muted-foreground">{
              question.state === "queued" ? "Aguardando vez na conversa" :
              question.state === "sending" ? "Envio em andamento" :
              question.state === "waiting" ? "Aguardando resposta" :
              question.state === "uncertain" ? (question.send_check_count >= 12 ? "Envio incerto — verificações automáticas esgotadas" : "Verificando resultado do envio") :
              question.state === "cancelled" ? "Pergunta cancelada" :
              question.selected_handle === "send_failure" ? "Falha no envio" :
              question.selected_handle === "timeout" ? "Sem resposta" :
              question.selected_handle === "other_response" ? "Outra resposta recebida" : question.selected_label ? `Botão escolhido: ${question.selected_label}` : "Botão escolhido"
            }</p>
            {question.failure_reason && <p className="mt-2 text-xs text-muted-foreground">{
              question.failure_reason === "provider_rejected" ? "O provedor recusou o envio." :
              question.failure_reason === "image_unavailable" ? "A imagem não estava disponível para envio." : "Não foi possível preparar o envio nesta instância."
            }</p>}
            {question.state === "uncertain" && <p className="mt-2 text-xs text-muted-foreground">A conversa permanece reservada. Nenhum reenvio automático será feito.</p>}
            {question.deadline_at && question.state === "waiting" && <p className="mt-2 text-xs text-muted-foreground">Prazo: {format(new Date(question.deadline_at), "dd/MM HH:mm", {locale:ptBR})}</p>}
          </div>
        ))}
        {!dataVisible ? (
          <div role="status" className="rounded-2xl border border-border/70 bg-sunken p-5 text-sm text-muted-foreground">
            <div className="mb-2 flex items-center gap-2 font-semibold text-foreground">
              <LockKeyhole className="h-4 w-4" /> Detalhes protegidos
            </div>
            Valores, resultados e caminho seguem suas permissões atuais sobre o lead.
          </div>
        ) : isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : !steps?.length ? (
          <p className="text-muted-foreground text-center py-8">Nenhum step registrado.</p>
        ) : (
          <div className="space-y-3">
            {steps.map((step, idx) => {
              const conf = STEP_STATUS_CONFIG[step.status] || STEP_STATUS_CONFIG.success;
              return (
                <div key={step.id} className="flex gap-3 items-start">
                  {/* Step number */}
                  <div className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-muted text-xs font-bold tabular-nums">
                    {idx + 1}
                  </div>

                  {/* Step content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{step.node_label || step.node_type}</span>
                      <Badge variant="soft" className="font-mono text-[11px]">
                        {step.node_type}
                      </Badge>
                      {step.status === "success" && <CheckCircle2 className={`h-4 w-4 ${conf.color}`} aria-label={conf.label} />}
                      {step.status === "failed" && <XCircle className={`h-4 w-4 ${conf.color}`} aria-label={conf.label} />}
                      {step.status === "skipped" && <span className="text-xs text-muted-foreground">pulado</span>}
                    </div>

                    {(step.output_data as any)?.retry_attempt != null && (
                      <Badge variant="soft" className="text-xs gap-1 mt-0.5">
                        <RotateCw className="h-2.5 w-2.5" />
                        Tentativa {(step.output_data as any).retry_attempt}
                      </Badge>
                    )}

                    {step.error_code && (
                      <p className="mt-1 text-xs font-medium text-destructive">{errorLabel(step.error_code)}</p>
                    )}

                    {step.node_type === "split_ab" && step.output_data && (
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="info" className="text-xs">
                          Variante: {(step.output_data as any).chosenVariant}
                        </Badge>
                        {(step.output_data as any).reused && (
                          <Badge variant="soft" className="text-xs">Reutilizada</Badge>
                        )}
                        {(step.output_data as any).roll != null && (
                          <span className="text-xs text-muted-foreground">
                            Roll: {(step.output_data as any).roll}
                          </span>
                        )}
                      </div>
                    )}

                    {step.node_type !== "split_ab" && step.output_data && Object.keys(step.output_data).length > 0 && (
                      <pre className="mt-1 overflow-x-auto rounded-xl bg-sunken p-2.5 text-xs">
                        {JSON.stringify(step.output_data, null, 2)}
                      </pre>
                    )}

                    <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                      {format(new Date(step.executed_at), "HH:mm:ss.SSS", { locale: ptBR })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}
