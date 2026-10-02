/**
 * Operations Center — Master Admin
 *
 * 3 abas: Visão Geral, Logs de Runtime, Uso por Organização
 */

import { useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  RotateCcw,
  Skull,
  Timer,
  XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PageHeader } from "@/components/ui/page-header";
import { KpiRow, KpiTile } from "@/components/ui/bento";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  useOperationsOverview,
  useRuntimeLogs,
  useUsageByOrg,
  useJobsOverview,
  useAutomationJobs,
  useRetryDeadLetter,
  type RuntimeLog,
  type AutomationJob,
} from "../hooks/useMasterOperations";
import { ApiStatusTab } from "../components/ApiStatusTab";

// ─── Aba 1: Visão Geral ─────────────────────────────────

function OverviewTab() {
  const [interval, setInterval_] = useState("24 hours");
  const { data, isLoading, refetch } = useOperationsOverview(interval);

  const errorRate = data && data.jobs_total > 0
    ? ((data.jobs_error / data.jobs_total) * 100)
    : 0;
  const isHighError = errorRate > 5;

  const periodLabel: Record<string, string> = {
    "24 hours": "24h",
    "7 days": "7 dias",
    "30 days": "30 dias",
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Select value={interval} onValueChange={setInterval_}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24 hours">Últimas 24h</SelectItem>
            <SelectItem value="7 days">Últimos 7 dias</SelectItem>
            <SelectItem value="30 days">Últimos 30 dias</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" />
          Atualizar
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <KpiRow cols={4}>
          <KpiTile
            label={`Jobs Executados (${periodLabel[interval]})`}
            icon={Activity}
            tone="info"
            value={data?.jobs_total ?? 0}
          />
          <KpiTile
            label="Jobs com Erro"
            icon={XCircle}
            tone={isHighError ? "bad" : "neutral"}
            className={cn(isHighError && "border-destructive/40 bg-destructive/5")}
            value={<span className={cn(isHighError && "text-destructive")}>{data?.jobs_error ?? 0}</span>}
          />
          <KpiTile
            label="Taxa de Erro"
            icon={AlertTriangle}
            tone={isHighError ? "bad" : "neutral"}
            className={cn(isHighError && "border-destructive/40 bg-destructive/5")}
            value={<span className={cn(isHighError && "text-destructive")}>{errorRate.toFixed(1)}%</span>}
          />
          <KpiTile
            label="Organizações Ativas"
            icon={Building2}
            tone="good"
            value={data?.orgs_active ?? 0}
          />
        </KpiRow>
      )}
    </div>
  );
}

// ─── Aba 2: Logs de Runtime ──────────────────────────────

// Os mapas abaixo pintam `<Badge variant="outline">` — a variante padrão (ouro)
// vazaria o `hover:bg-primary` por cima do tom.
const STATUS_BADGE: Record<string, { class: string; label: string }> = {
  success: { class: "bg-success/10 text-success-strong border-success/20", label: "success" },
  error: { class: "bg-destructive/10 text-destructive border-destructive/20", label: "error" },
  skipped: { class: "bg-muted text-muted-foreground border-border", label: "skipped" },
};

const MODULES = [
  "pipe_dispatch",
  "copilot",
  "campaign",
  "webhook",
  "followup",
  "outbound",
  "permission",
];

function RuntimeLogsTab() {
  const [statusFilter, setStatusFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [intervalFilter, setIntervalFilter] = useState("24 hours");
  const [page, setPage] = useState(0);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const PAGE_SIZE = 50;

  const { data, isLoading, refetch } = useRuntimeLogs({
    status: statusFilter || undefined,
    module: moduleFilter || undefined,
    interval: intervalFilter,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const toggleRow = (id: string) => {
    setExpandedRow(expandedRow === id ? null : id);
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={statusFilter || "__all__"} onValueChange={(v) => { setStatusFilter(v === "__all__" ? "" : v); setPage(0); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os status</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="skipped">Skipped</SelectItem>
          </SelectContent>
        </Select>

        <Select value={moduleFilter || "__all__"} onValueChange={(v) => { setModuleFilter(v === "__all__" ? "" : v); setPage(0); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Módulo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os módulos</SelectItem>
            {MODULES.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={intervalFilter} onValueChange={(v) => { setIntervalFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1 hour">Última hora</SelectItem>
            <SelectItem value="24 hours">Últimas 24h</SelectItem>
            <SelectItem value="7 days">Últimos 7 dias</SelectItem>
            <SelectItem value="30 days">Últimos 30 dias</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" />
          Atualizar
        </Button>

        <span className="text-sm text-muted-foreground ml-auto">
          {total} registro{total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[600px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="w-[160px]">Data/Hora</TableHead>
                  <TableHead className="w-[120px]">Módulo</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead>Organização</TableHead>
                  <TableHead>Erro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Nenhum log encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <LogRow
                      key={log.id}
                      log={log}
                      isExpanded={expandedRow === log.id}
                      onToggle={() => toggleRow(log.id)}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {page + 1} de {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
            Próxima
          </Button>
        </div>
      )}
    </div>
  );
}

function LogRow({ log, isExpanded, onToggle }: { log: RuntimeLog; isExpanded: boolean; onToggle: () => void }) {
  const badge = STATUS_BADGE[log.status] || STATUS_BADGE.skipped;
  const hasDetails = log.status === "error" && (log.error_message || log.payload_snapshot);

  return (
    <>
      <TableRow
        className={cn(hasDetails && "cursor-pointer hover:bg-accent/50")}
        onClick={hasDetails ? onToggle : undefined}
      >
        <TableCell className="px-2">
          {hasDetails && (
            isExpanded
              ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
              : <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="text-sm tabular-nums">
          {format(new Date(log.created_at), "dd/MM HH:mm:ss", { locale: ptBR })}
        </TableCell>
        <TableCell>
          <Badge variant="outline" className="font-mono text-xs">
            {log.module}
          </Badge>
        </TableCell>
        <TableCell className="text-sm max-w-[200px] truncate">{log.action}</TableCell>
        <TableCell>
          <Badge variant="outline" className={badge.class}>{badge.label}</Badge>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground truncate max-w-[160px]">
          {log.organization?.name || "-"}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">
          {log.error_message || "-"}
        </TableCell>
      </TableRow>
      {isExpanded && hasDetails && (
        <TableRow className="bg-destructive/5">
          <TableCell colSpan={7} className="p-4">
            <div className="space-y-3 text-sm">
              {log.error_message && (
                <div>
                  <span className="font-medium text-destructive">Mensagem de erro:</span>
                  <pre className="mt-1 p-3 bg-background rounded-lg border text-xs whitespace-pre-wrap break-words">
                    {log.error_message}
                  </pre>
                </div>
              )}
              {log.payload_snapshot && (
                <div>
                  <span className="font-medium">Payload:</span>
                  <pre className="mt-1 p-3 bg-background rounded-lg border text-xs whitespace-pre-wrap break-words">
                    {JSON.stringify(log.payload_snapshot, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── Aba 3: Uso por Organização ──────────────────────────

function UsageByOrgTab() {
  const [interval, setInterval_] = useState("7 days");
  const { data: orgs, isLoading, refetch } = useUsageByOrg(interval);

  const CHURN_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

  const isChurnRisk = (lastActivity: string) => {
    return Date.now() - new Date(lastActivity).getTime() > CHURN_THRESHOLD_MS;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select value={interval} onValueChange={setInterval_}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7 days">Últimos 7 dias</SelectItem>
            <SelectItem value="30 days">Últimos 30 dias</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" />
          Atualizar
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[600px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organização</TableHead>
                  <TableHead className="text-right">Leads Criados</TableHead>
                  <TableHead className="text-right">Cards Movidos</TableHead>
                  <TableHead className="text-right">Mensagens</TableHead>
                  <TableHead className="text-right">Total Eventos</TableHead>
                  <TableHead>Última Atividade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : !orgs?.length ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      Nenhum dado de uso no período
                    </TableCell>
                  </TableRow>
                ) : (
                  orgs.map((org) => {
                    const churn = isChurnRisk(org.ultima_atividade);
                    return (
                      <TableRow key={org.organization_id} className={cn(churn && "bg-destructive/5")}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {org.organization_name}
                            {churn && (
                              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 text-xs">
                                risco churn
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{org.leads_criados}</TableCell>
                        <TableCell className="text-right tabular-nums">{org.cards_movidos}</TableCell>
                        <TableCell className="text-right tabular-nums">{org.mensagens_enviadas}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{org.total_events}</TableCell>
                        <TableCell className={cn("text-sm", churn ? "text-destructive font-medium" : "text-muted-foreground")}>
                          {formatDistanceToNow(new Date(org.ultima_atividade), { addSuffix: true, locale: ptBR })}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Aba 4: Jobs ─────────────────────────────────────────

// `failed` e `retrying` eram laranja e amarelo — no V5 os dois cairiam em
// `warning`. `retrying` vai para o ouro suave para continuar distinguível.
const JOB_STATUS_BADGE: Record<string, { class: string; label: string }> = {
  running: { class: "bg-insights/10 text-insights border-insights/20", label: "running" },
  success: { class: "bg-success/10 text-success-strong border-success/20", label: "success" },
  failed: { class: "bg-warning/15 text-warning-strong border-warning/30", label: "failed" },
  retrying: { class: "bg-primary-soft text-primary-soft-foreground border-transparent", label: "retrying" },
  dead_letter: { class: "bg-destructive/10 text-destructive border-destructive/20", label: "dead letter" },
};

/** Paleta categórica (não é status): só separa um motor do outro num relance. */
const SOURCE_ENGINE_BADGE: Record<string, { class: string; label: string }> = {
  pipe_dispatch: { class: "bg-insights/10 text-insights border-insights/20", label: "Pipe Dispatch" },
  copilot: { class: "bg-primary-soft text-primary-soft-foreground border-transparent", label: "Copilot" },
  campaign: { class: "bg-tinta text-tinta-foreground border-transparent", label: "Campaign" },
  followup: { class: "bg-card text-foreground border-border", label: "Follow-up" },
  webhook: { class: "bg-warning/15 text-warning-strong border-warning/30", label: "Webhook" },
  workflow: { class: "bg-muted text-foreground/80 border-transparent", label: "Workflow" },
};

function JobsTab() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("");
  const [engineFilter, setEngineFilter] = useState("");
  const [intervalFilter, setIntervalFilter] = useState("24 hours");
  const [page, setPage] = useState(0);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const PAGE_SIZE = 50;

  const { data: overview, isLoading: overviewLoading, refetch: refetchOverview } = useJobsOverview(intervalFilter);
  const { data: jobsData, isLoading: jobsLoading, refetch: refetchJobs } = useAutomationJobs({
    status: statusFilter || undefined,
    sourceEngine: engineFilter || undefined,
    interval: intervalFilter,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const retryMutation = useRetryDeadLetter();

  const jobs = jobsData?.jobs ?? [];
  const total = jobsData?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const hasDeadLetters = (overview?.dead_letter ?? 0) > 0;

  const refetchAll = () => {
    refetchOverview();
    refetchJobs();
  };

  const handleRetry = async (jobId: string) => {
    try {
      const result = await retryMutation.mutateAsync(jobId);
      toast({
        title: result.success ? "Retry iniciado" : "Falha no retry",
        description: result.message,
        variant: result.success ? "default" : "destructive",
      });
    } catch {
      toast({ title: "Erro", description: "Falha ao executar retry", variant: "destructive" });
    }
  };

  const formatDuration = (startedAt: string, finishedAt: string | null) => {
    if (!finishedAt) return "-";
    const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}min`;
  };

  const intervalLabel: Record<string, string> = {
    "1 hour": "1h",
    "24 hours": "24h",
    "7 days": "7d",
  };

  return (
    <div className="space-y-5">
      {/* Dead letter banner */}
      {hasDeadLetters && (
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/30 rounded-2xl">
          <Skull className="w-5 h-5 text-destructive shrink-0" />
          <div className="flex-1">
            <span className="font-medium text-destructive">
              {overview!.dead_letter} job{overview!.dead_letter !== 1 ? "s" : ""} em dead letter nas últimas {intervalLabel[intervalFilter] || "24h"}
            </span>
            <span className="text-sm text-destructive ml-2">
              — jobs que falharam após todas as tentativas
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-destructive/30 text-destructive hover:bg-destructive/10"
            onClick={() => { setStatusFilter("dead_letter"); setPage(0); }}
          >
            Ver dead letters
          </Button>
        </div>
      )}

      {/* Overview cards */}
      {overviewLoading ? (
        <div className="flex items-center justify-center h-24">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <KpiRow cols={3} className="lg:grid-cols-6">
          <KpiTile label="Total" icon={Activity} tone="info" value={overview?.total ?? 0} />
          <KpiTile
            label="Sucesso"
            icon={CheckCircle2}
            tone="good"
            value={<span className="text-success-strong">{overview?.success ?? 0}</span>}
          />
          <KpiTile
            label="Falhados"
            icon={XCircle}
            value={<span className="text-warning-strong">{overview?.failed ?? 0}</span>}
          />
          <KpiTile label="Retrying" icon={RotateCcw} tone="gold" value={overview?.retrying ?? 0} />
          <KpiTile
            label="Running"
            icon={Timer}
            tone="info"
            value={<span className="text-insights">{overview?.running ?? 0}</span>}
          />
          <KpiTile
            label="Dead Letter"
            icon={Skull}
            tone={hasDeadLetters ? "bad" : "neutral"}
            className={cn(hasDeadLetters && "border-destructive/40 bg-destructive/5")}
            value={<span className={cn(hasDeadLetters && "text-destructive")}>{overview?.dead_letter ?? 0}</span>}
          />
        </KpiRow>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={statusFilter || "__all__"} onValueChange={(v) => { setStatusFilter(v === "__all__" ? "" : v); setPage(0); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os status</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="retrying">Retrying</SelectItem>
            <SelectItem value="dead_letter">Dead Letter</SelectItem>
          </SelectContent>
        </Select>

        <Select value={engineFilter || "__all__"} onValueChange={(v) => { setEngineFilter(v === "__all__" ? "" : v); setPage(0); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Source Engine" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os engines</SelectItem>
            <SelectItem value="pipe_dispatch">Pipe Dispatch</SelectItem>
            <SelectItem value="copilot">Copilot</SelectItem>
            <SelectItem value="campaign">Campaign</SelectItem>
            <SelectItem value="followup">Follow-up</SelectItem>
            <SelectItem value="webhook">Webhook</SelectItem>
            <SelectItem value="workflow">Workflow</SelectItem>
          </SelectContent>
        </Select>

        <Select value={intervalFilter} onValueChange={(v) => { setIntervalFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1 hour">Última hora</SelectItem>
            <SelectItem value="24 hours">Últimas 24h</SelectItem>
            <SelectItem value="7 days">Últimos 7 dias</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={refetchAll}>
          <RefreshCw className="w-4 h-4" />
          Atualizar
        </Button>

        <span className="text-sm text-muted-foreground ml-auto">
          {total} job{total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[600px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="w-[140px]">Data/Hora</TableHead>
                  <TableHead className="w-[130px]">Engine</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="w-[160px]">Entity</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[80px]">Duração</TableHead>
                  <TableHead className="w-[60px]">Retries</TableHead>
                  <TableHead className="w-[200px]">Erro</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobsLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : jobs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      Nenhum job encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  jobs.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      isExpanded={expandedRow === job.id}
                      onToggle={() => setExpandedRow(expandedRow === job.id ? null : job.id)}
                      onRetry={() => handleRetry(job.id)}
                      isRetrying={retryMutation.isPending}
                      formatDuration={formatDuration}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {page + 1} de {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
            Próxima
          </Button>
        </div>
      )}
    </div>
  );
}

function JobRow({
  job,
  isExpanded,
  onToggle,
  onRetry,
  isRetrying,
  formatDuration,
}: {
  job: AutomationJob;
  isExpanded: boolean;
  onToggle: () => void;
  onRetry: () => void;
  isRetrying: boolean;
  formatDuration: (s: string, f: string | null) => string;
}) {
  const statusBadge = JOB_STATUS_BADGE[job.status] || JOB_STATUS_BADGE.failed;
  const engineBadge = SOURCE_ENGINE_BADGE[job.source_engine] || { class: "bg-muted text-muted-foreground border-border", label: job.source_engine };
  const isDeadLetter = job.status === "dead_letter";
  const hasDetails = job.error_message || job.payload_snapshot;
  const canRetry = isDeadLetter || job.status === "failed";

  return (
    <>
      <TableRow
        className={cn(
          hasDetails && "cursor-pointer hover:bg-accent/50",
          isDeadLetter && "bg-destructive/5",
        )}
        onClick={hasDetails ? onToggle : undefined}
      >
        <TableCell className="px-2">
          {hasDetails && (
            isExpanded
              ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
              : <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="text-sm tabular-nums">
          {format(new Date(job.created_at), "dd/MM HH:mm:ss", { locale: ptBR })}
        </TableCell>
        <TableCell>
          <Badge variant="outline" className={engineBadge.class}>{engineBadge.label}</Badge>
        </TableCell>
        <TableCell className="text-sm max-w-[160px] truncate font-mono text-xs">{job.action_type}</TableCell>
        <TableCell className="text-sm text-muted-foreground truncate max-w-[160px] font-mono text-xs">
          {job.entity_type}:{job.entity_id?.slice(0, 8)}
        </TableCell>
        <TableCell>
          <Badge variant="outline" className={statusBadge.class}>{statusBadge.label}</Badge>
        </TableCell>
        <TableCell className="text-sm tabular-nums text-muted-foreground">
          {formatDuration(job.started_at, job.finished_at)}
        </TableCell>
        <TableCell className="text-sm tabular-nums text-center">
          {job.retry_count > 0 ? `${job.retry_count}/${job.max_retries}` : "-"}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">
          {job.error_message || "-"}
        </TableCell>
        <TableCell>
          {canRetry && (
            <Button
              variant="outline"
              size="sm"
              className={cn("h-7 text-xs", isDeadLetter && "border-destructive/30 text-destructive hover:bg-destructive/10")}
              disabled={isRetrying}
              onClick={(e) => { e.stopPropagation(); onRetry(); }}
            >
              {isRetrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3 mr-1" />}
              Retry
            </Button>
          )}
        </TableCell>
      </TableRow>
      {isExpanded && hasDetails && (
        <TableRow className={cn(isDeadLetter ? "bg-destructive/5" : "bg-accent/30")}>
          <TableCell colSpan={10} className="p-4">
            <div className="space-y-3 text-sm">
              {job.error_message && (
                <div>
                  <span className="font-medium text-destructive">Mensagem de erro:</span>
                  <pre className="mt-1 p-3 bg-background rounded-lg border text-xs whitespace-pre-wrap break-words">
                    {job.error_message}
                  </pre>
                </div>
              )}
              {job.payload_snapshot && (
                <div>
                  <span className="font-medium">Payload:</span>
                  <pre className="mt-1 p-3 bg-background rounded-lg border text-xs whitespace-pre-wrap break-words">
                    {JSON.stringify(job.payload_snapshot, null, 2)}
                  </pre>
                </div>
              )}
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>ID: {job.id}</span>
                {job.source_table && <span>Source: {job.source_table}/{job.source_id?.slice(0, 8)}</span>}
                <span>Org: {(job as unknown as { organization?: { name: string } })?.organization?.name || job.organization_id?.slice(0, 8)}</span>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── Página Principal ────────────────────────────────────

export default function MasterOperations() {
  return (
    <Tabs defaultValue="overview" className="space-y-5">
      <PageHeader
        title="Operations Center"
        subtitle="Monitoramento de jobs, erros e uso por organização"
        tabs={
          <TabsList variant="pill">
            <TabsTrigger value="overview">Visão Geral</TabsTrigger>
            <TabsTrigger value="logs">Logs de Runtime</TabsTrigger>
            <TabsTrigger value="usage">Uso por Organização</TabsTrigger>
            <TabsTrigger value="jobs">Jobs</TabsTrigger>
            <TabsTrigger value="apis">APIs</TabsTrigger>
          </TabsList>
        }
      />

      <TabsContent value="overview" className="mt-0">
        <OverviewTab />
      </TabsContent>

      <TabsContent value="logs" className="mt-0">
        <RuntimeLogsTab />
      </TabsContent>

      <TabsContent value="usage" className="mt-0">
        <UsageByOrgTab />
      </TabsContent>

      <TabsContent value="jobs" className="mt-0">
        <JobsTab />
      </TabsContent>

      <TabsContent value="apis" className="mt-0">
        <ApiStatusTab />
      </TabsContent>
    </Tabs>
  );
}
