import { useParams, Link } from "react-router-dom";
import { useWorkflow, useWorkflowExecutions, useWorkflowExecutionSteps } from "@/hooks/useWorkflows";
import { useState } from "react";
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
import { ArrowLeft, CheckCircle2, XCircle, Clock, Pause, AlertTriangle, Loader2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { WorkflowExecution, WorkflowExecutionStep, WorkflowExecutionStatus, WorkflowStepStatus } from "@/types/workflow";
import SplitAbAnalytics from "@/components/automacoes/SplitAbAnalytics";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof CheckCircle2 }> = {
  running: { label: "Executando", variant: "default", icon: Loader2 },
  processing: { label: "Processando", variant: "default", icon: Loader2 },
  paused: { label: "Pausado", variant: "secondary", icon: Pause },
  completed: { label: "Concluído", variant: "default", icon: CheckCircle2 },
  failed: { label: "Falhou", variant: "destructive", icon: XCircle },
  loop_limit_reached: { label: "Limite de Loop", variant: "destructive", icon: AlertTriangle },
  waiting_response: { label: "Aguardando Resposta", variant: "outline", icon: Clock },
};

const STEP_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  success: { label: "Sucesso", color: "text-green-600" },
  failed: { label: "Falhou", color: "text-red-600" },
  skipped: { label: "Pulado", color: "text-gray-400" },
};

export default function AutomacoesExecucoes() {
  const { id } = useParams<{ id: string }>();
  const { data: workflow, isLoading: isLoadingWorkflow } = useWorkflow(id);
  const { data: executions, isLoading: isLoadingExecutions } = useWorkflowExecutions(id);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);

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
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to={`/automacoes/${id}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{workflow.name}</h1>
          <p className="text-sm text-muted-foreground">
            Histórico de execuções
          </p>
        </div>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Total"
          value={executions?.length ?? 0}
        />
        <StatCard
          label="Concluídos"
          value={executions?.filter(e => e.status === "completed").length ?? 0}
          className="text-green-600"
        />
        <StatCard
          label="Falharam"
          value={executions?.filter(e => e.status === "failed" || e.status === "loop_limit_reached").length ?? 0}
          className="text-red-600"
        />
        <StatCard
          label="Em andamento"
          value={executions?.filter(e => e.status === "running" || e.status === "processing" || e.status === "paused" || e.status === "waiting_response").length ?? 0}
          className="text-blue-600"
        />
      </div>

      {/* Split A/B Analytics */}
      {id && <SplitAbAnalytics workflowId={id} />}

      {/* Executions table */}
      {!executions?.length ? (
        <div className="text-center py-12 text-muted-foreground">
          Nenhuma execução registrada ainda.
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duração</TableHead>
                <TableHead>Erro</TableHead>
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

                return (
                  <TableRow
                    key={exec.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedExecutionId(exec.id)}
                  >
                    <TableCell className="whitespace-nowrap">
                      <div className="text-sm">
                        {format(new Date(exec.started_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(exec.started_at), { addSuffix: true, locale: ptBR })}
                      </div>
                    </TableCell>
                    <TableCell>
                      {exec.lead_id ? (
                        <LeadName leadId={exec.lead_id} />
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusConf.variant} className="gap-1">
                        <StatusIcon className="h-3 w-3" />
                        {statusConf.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {duration}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm text-red-600">
                      {exec.error || "-"}
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
        open={!!selectedExecutionId}
        onClose={() => setSelectedExecutionId(null)}
      />
    </div>
  );
}

function StatCard({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="border rounded-lg p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${className || ""}`}>{value}</p>
    </div>
  );
}

function LeadName({ leadId }: { leadId: string }) {
  // Simple display — could be enhanced with a query
  return (
    <span className="text-sm font-mono text-muted-foreground">
      {leadId.slice(0, 8)}...
    </span>
  );
}

function StepsDialog({
  executionId,
  open,
  onClose,
}: {
  executionId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: steps, isLoading } = useWorkflowExecutionSteps(executionId || undefined);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Steps da Execução</DialogTitle>
        </DialogHeader>

        {isLoading ? (
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
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                    {idx + 1}
                  </div>

                  {/* Step content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{step.node_label || step.node_type}</span>
                      <Badge variant="outline" className="text-xs">
                        {step.node_type}
                      </Badge>
                      {step.status === "success" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                      {step.status === "failed" && <XCircle className="h-4 w-4 text-red-500" />}
                      {step.status === "skipped" && <span className="text-xs text-gray-400">pulado</span>}
                    </div>

                    {step.error && (
                      <p className="text-xs text-red-600 mt-1">{step.error}</p>
                    )}

                    {step.node_type === "split_ab" && step.output_data && (
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          Variante: {(step.output_data as any).chosenVariant}
                        </Badge>
                        {(step.output_data as any).reused && (
                          <Badge variant="secondary" className="text-xs">Reutilizada</Badge>
                        )}
                        {(step.output_data as any).roll != null && (
                          <span className="text-xs text-muted-foreground">
                            Roll: {(step.output_data as any).roll}
                          </span>
                        )}
                      </div>
                    )}

                    {step.node_type !== "split_ab" && step.output_data && Object.keys(step.output_data).length > 0 && (
                      <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto">
                        {JSON.stringify(step.output_data, null, 2)}
                      </pre>
                    )}

                    <p className="text-xs text-muted-foreground mt-1">
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
