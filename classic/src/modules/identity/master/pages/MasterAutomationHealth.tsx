/**
 * Onda 2 Fase E / F-E.5 — /master/automation-health
 *
 * Dashboard único com 5 tabs:
 *   - Dead-letter (pending_ai_actions dead_letter)
 *   - Workflows (failed)
 *   - Stuck actions (pending órfãs)
 *   - Webhooks (circuit-broken)
 *   - Audit (mutations service_role)
 *
 * Reprocess action via reprocess-job edge function (master only).
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertTriangle,
  Activity,
  Clock,
  ServerOff,
  RotateCcw,
  Bell,
  History,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  useAutomationHealth,
  useDeadLetterJobs,
  useFailedWorkflows,
  useStuckActions,
  useCircuitBrokenWebhooks,
  useSystemAlerts,
  useResolveAlert,
  useReprocessJob,
  useAuditLog,
  useOrgsCopilotEngine,
  useToggleCopilotEngine,
  type ReprocessType,
} from "@/modules/workflows/hooks/useAutomationHealth";
import AutomationLagTab from "../components/AutomationLagTab";
import WorkflowConfigTab from "../components/WorkflowConfigTab";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function MasterAutomationHealth() {
  const { data: health, isLoading: healthLoading, refetch: refetchHealth } = useAutomationHealth();
  const reprocess = useReprocessJob();

  const handleReprocess = async (type: ReprocessType, id: string, label: string) => {
    try {
      await reprocess.mutateAsync({ type, id });
      toast.success(`Reprocessado: ${label}`);
    } catch (e) {
      toast.error(`Falha: ${e instanceof Error ? e.message : "erro"}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Automation Health</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Visibility de saúde das automações + reprocess de jobs falhados
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetchHealth()}
          disabled={healthLoading}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${healthLoading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <SummaryCard
          icon={AlertTriangle}
          label="Dead-letter (24h)"
          value={health?.dead_letter_count ?? 0}
          severity={(health?.dead_letter_count ?? 0) > 0 ? "warning" : "info"}
        />
        <SummaryCard
          icon={Activity}
          label="Workflows falhados (24h)"
          value={health?.failed_workflows_count ?? 0}
          severity={(health?.failed_workflows_count ?? 0) > 5 ? "error" : "info"}
        />
        <SummaryCard
          icon={Clock}
          label="Actions órfãs (>1h)"
          value={health?.stuck_actions_count ?? 0}
          severity={(health?.stuck_actions_count ?? 0) > 0 ? "warning" : "info"}
        />
        <SummaryCard
          icon={ServerOff}
          label="Webhooks quebrados"
          value={health?.circuit_broken_webhooks ?? 0}
          severity={(health?.circuit_broken_webhooks ?? 0) > 0 ? "warning" : "info"}
        />
        <SummaryCard
          icon={Bell}
          label="Alerts ativos"
          value={health?.unresolved_alerts ?? 0}
          severity={(health?.unresolved_alerts ?? 0) > 0 ? "error" : "info"}
        />
      </div>

      <Tabs defaultValue="lag" className="w-full">
        <TabsList className="grid grid-cols-2 sm:grid-cols-9 gap-1 h-auto">
          <TabsTrigger value="lag">Atraso</TabsTrigger>
          <TabsTrigger value="config">Configuração</TabsTrigger>
          <TabsTrigger value="dead-letter">Dead-Letter</TabsTrigger>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="stuck">Stuck</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="engine">Engine</TabsTrigger>
        </TabsList>

        <TabsContent value="lag">
          <AutomationLagTab />
        </TabsContent>
        <TabsContent value="config">
          <WorkflowConfigTab />
        </TabsContent>
        <TabsContent value="dead-letter">
          <DeadLetterTab onReprocess={handleReprocess} />
        </TabsContent>
        <TabsContent value="workflows">
          <WorkflowsTab onReprocess={handleReprocess} />
        </TabsContent>
        <TabsContent value="stuck">
          <StuckTab onReprocess={handleReprocess} />
        </TabsContent>
        <TabsContent value="webhooks">
          <WebhooksTab />
        </TabsContent>
        <TabsContent value="alerts">
          <AlertsTab />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab />
        </TabsContent>
        <TabsContent value="engine">
          <EngineTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Summary Card ────────────────────────────────────────────────────────────

function SummaryCard({
  icon: Icon,
  label,
  value,
  severity,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  severity: "info" | "warning" | "error";
}) {
  const colorMap = {
    info: "text-muted-foreground",
    warning: "text-amber-500",
    error: "text-red-500",
  } as const;
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <Icon className={`w-5 h-5 ${colorMap[severity]}`} />
          <span className={`text-2xl font-semibold ${colorMap[severity]}`}>{value}</span>
        </div>
        <p className="text-sm text-muted-foreground mt-2">{label}</p>
      </CardContent>
    </Card>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

function DeadLetterTab({ onReprocess }: { onReprocess: (t: ReprocessType, id: string, label: string) => void }) {
  const { data, isLoading } = useDeadLetterJobs();
  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Carregando…</p>;
  if (!data?.length) return <EmptyState message="Sem dead-letter jobs últimos 7d" />;
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead>Org</TableHead>
              <TableHead>Lead</TableHead>
              <TableHead>Erro</TableHead>
              <TableHead>Quando</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.id}>
                <TableCell><Badge variant="secondary">{row.action_type}</Badge></TableCell>
                <TableCell className="font-mono text-xs">{shortId(row.organization_id)}</TableCell>
                <TableCell className="font-mono text-xs">{shortId(row.lead_id)}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-md truncate">
                  {row.error_message}
                </TableCell>
                <TableCell className="text-xs">{relativeTime(row.created_at)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onReprocess("pending_ai_action", row.id, row.action_type)}
                  >
                    <RotateCcw className="w-3 h-3 mr-1" /> Retry
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function WorkflowsTab({ onReprocess }: { onReprocess: (t: ReprocessType, id: string, label: string) => void }) {
  const { data, isLoading } = useFailedWorkflows();
  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Carregando…</p>;
  if (!data?.length) return <EmptyState message="Sem workflows falhados últimos 7d" />;
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workflow</TableHead>
              <TableHead>Org</TableHead>
              <TableHead>Erro</TableHead>
              <TableHead>Node</TableHead>
              <TableHead>Quando</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row: any) => (
              <TableRow key={row.id}>
                <TableCell>{row.workflows?.name ?? row.workflow_id?.slice(0, 8)}</TableCell>
                <TableCell className="font-mono text-xs">{shortId(row.organization_id)}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-md truncate">{row.error}</TableCell>
                <TableCell className="font-mono text-xs">{row.current_node_id ?? "—"}</TableCell>
                <TableCell className="text-xs">{relativeTime(row.started_at)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onReprocess("workflow_execution", row.id, row.workflows?.name ?? row.id)}
                  >
                    <RotateCcw className="w-3 h-3 mr-1" /> Retry
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function StuckTab({ onReprocess }: { onReprocess: (t: ReprocessType, id: string, label: string) => void }) {
  const { data, isLoading } = useStuckActions();
  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Carregando…</p>;
  if (!data?.length) return <EmptyState message="Sem actions órfãs >1h" />;
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead>Org</TableHead>
              <TableHead>Retries</TableHead>
              <TableHead>Próximo retry</TableHead>
              <TableHead>Idade</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.id}>
                <TableCell><Badge variant="outline">{row.action_type}</Badge></TableCell>
                <TableCell className="font-mono text-xs">{shortId(row.organization_id)}</TableCell>
                <TableCell>{row.retry_count}</TableCell>
                <TableCell className="text-xs">{row.next_retry_at ? relativeTime(row.next_retry_at) : "—"}</TableCell>
                <TableCell className="text-xs">{relativeTime(row.created_at)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onReprocess("pending_ai_action", row.id, row.action_type)}
                  >
                    <RotateCcw className="w-3 h-3 mr-1" /> Force retry
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function WebhooksTab() {
  const { data, isLoading } = useCircuitBrokenWebhooks();
  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Carregando…</p>;
  if (!data?.length) return <EmptyState message="Sem webhooks circuit-broken" />;
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Webhook</TableHead>
              <TableHead>Org</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>Falhas</TableHead>
              <TableHead>Razão</TableHead>
              <TableHead>Desativado em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.name}</TableCell>
                <TableCell className="font-mono text-xs">{shortId(row.organization_id)}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-md truncate">{row.url}</TableCell>
                <TableCell>{row.consecutive_failures}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{row.disabled_reason ?? "—"}</TableCell>
                <TableCell className="text-xs">{relativeTime(row.updated_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function AlertsTab() {
  const { data, isLoading } = useSystemAlerts({ resolved: false });
  const resolve = useResolveAlert();
  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Carregando…</p>;
  if (!data?.length) return <EmptyState message="Sem alerts ativos" />;
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Severidade</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Título</TableHead>
              <TableHead>Mensagem</TableHead>
              <TableHead>Quando</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((alert) => (
              <TableRow key={alert.id}>
                <TableCell>
                  <Badge variant={severityVariant(alert.severity)}>{alert.severity}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{alert.category}</TableCell>
                <TableCell className="font-medium">{alert.title}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-md truncate">{alert.message}</TableCell>
                <TableCell className="text-xs">{relativeTime(alert.created_at)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      resolve.mutate(alert.id, {
                        onSuccess: () => toast.success("Alert resolvido"),
                        onError: (e) => toast.error(`Falha: ${e instanceof Error ? e.message : "erro"}`),
                      });
                    }}
                  >
                    Resolver
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function AuditTab() {
  const [tableFilter, setTableFilter] = useState<string | undefined>(undefined);
  const [opFilter, setOpFilter] = useState<"INSERT" | "UPDATE" | "DELETE" | undefined>(undefined);
  const { data, isLoading } = useAuditLog({ tableName: tableFilter, operation: opFilter, limit: 100 });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <History className="w-4 h-4" /> Audit Log (service_role mutations)
        </CardTitle>
        <div className="flex gap-2">
          <select
            className="border rounded px-2 py-1 text-sm bg-background"
            value={tableFilter ?? ""}
            onChange={(e) => setTableFilter(e.target.value || undefined)}
          >
            <option value="">Todas tabelas</option>
            <option value="leads">leads</option>
            <option value="conversations">conversations</option>
            <option value="pending_ai_actions">pending_ai_actions</option>
            <option value="workflow_executions">workflow_executions</option>
          </select>
          <select
            className="border rounded px-2 py-1 text-sm bg-background"
            value={opFilter ?? ""}
            onChange={(e) => setOpFilter((e.target.value as any) || undefined)}
          >
            <option value="">Todas ops</option>
            <option value="INSERT">INSERT</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
          </select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <p className="text-sm text-muted-foreground p-4">Carregando…</p>
        ) : !data?.length ? (
          <EmptyState message="Sem mutations no filtro" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tabela</TableHead>
                <TableHead>Op</TableHead>
                <TableHead>Row ID</TableHead>
                <TableHead>Function</TableHead>
                <TableHead>Quando</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.table_name}</TableCell>
                  <TableCell><Badge variant="outline">{row.operation}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{shortId(row.row_id)}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{row.actor_function ?? "—"}</TableCell>
                  <TableCell className="text-xs">{relativeTime(row.occurred_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Engine Tab (B3 feature flag toggle) ─────────────────────────────────────

function EngineTab() {
  const { data, isLoading } = useOrgsCopilotEngine();
  const toggle = useToggleCopilotEngine();

  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Carregando…</p>;
  if (!data?.length) return <EmptyState message="Sem orgs" />;

  const v2Count = data.filter((o) => o.copilot_engine_version === "v2").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Copilot Engine Version (Trilha 3.B B3)</h3>
          <p className="text-xs text-muted-foreground mt-1">
            v1 = orchestrator atual. v2 = mesma lógica via módulos extraídos (refactor transparente).
            Hoje funcionalmente idênticos. Toggle prepara A/B futura.
          </p>
        </div>
        <Badge variant={v2Count > 0 ? "default" : "outline"}>
          {v2Count}/{data.length} em v2
        </Badge>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organização</TableHead>
                <TableHead>Engine atual</TableHead>
                <TableHead className="text-right">Toggle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((org) => (
                <TableRow key={org.id}>
                  <TableCell className="font-medium">{org.name}</TableCell>
                  <TableCell>
                    <Badge variant={org.copilot_engine_version === "v2" ? "default" : "outline"}>
                      {org.copilot_engine_version}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const next = org.copilot_engine_version === "v1" ? "v2" : "v1";
                        toggle.mutate(
                          { orgId: org.id, version: next },
                          {
                            onSuccess: () => toast.success(`${org.name} → ${next}`),
                            onError: (e) => toast.error(e instanceof Error ? e.message : "Falha"),
                          },
                        );
                      }}
                    >
                      {org.copilot_engine_version === "v1" ? "Ativar v2" : "Voltar v1"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center text-sm text-muted-foreground">{message}</CardContent>
    </Card>
  );
}

function shortId(id: string | null): string {
  if (!id) return "—";
  return id.slice(0, 8);
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
  } catch {
    return iso;
  }
}

function severityVariant(s: SystemAlert["severity"]): "default" | "secondary" | "destructive" | "outline" {
  if (s === "critical" || s === "error") return "destructive";
  if (s === "warning") return "secondary";
  return "outline";
}

import type { SystemAlert } from "@/modules/workflows/hooks/useAutomationHealth";
