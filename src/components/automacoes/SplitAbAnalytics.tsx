import { useState, useEffect, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FlaskConical,
  Users,
  MessageSquare,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { useSplitAbMetrics, useSplitAbNodes } from "@/hooks/useSplitAbMetrics";
import type { SplitAbVariantMetrics } from "@/types/workflow";

interface SplitAbAnalyticsProps {
  workflowId: string;
}

function getCompletionRate(v: SplitAbVariantMetrics) {
  return v.total_executions > 0 ? v.completed / v.total_executions : 0;
}

function getFailureRate(v: SplitAbVariantMetrics) {
  return v.total_executions > 0 ? v.failed / v.total_executions : 0;
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function SplitAbAnalytics({ workflowId }: SplitAbAnalyticsProps) {
  const nodesQuery = useSplitAbNodes(workflowId);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();

  const nodes = nodesQuery.data ?? [];

  // Auto-select first node
  useEffect(() => {
    if (nodes.length > 0 && !selectedNodeId) {
      setSelectedNodeId(nodes[0].id);
    }
  }, [nodes, selectedNodeId]);

  const metricsQuery = useSplitAbMetrics(workflowId, selectedNodeId);
  const metrics = metricsQuery.data ?? [];

  const bestVariantId = useMemo(() => {
    if (metrics.length <= 1) return null;
    let best: SplitAbVariantMetrics | null = null;
    for (const v of metrics) {
      if (!best || getCompletionRate(v) > getCompletionRate(best)) {
        best = v;
      }
    }
    return best?.variant_id ?? null;
  }, [metrics]);

  const totals = useMemo(() => {
    let leads = 0;
    let executions = 0;
    for (const v of metrics) {
      leads += v.total_leads;
      executions += v.total_executions;
    }
    return { leads, executions };
  }, [metrics]);

  const bestVariant = useMemo(() => {
    if (!bestVariantId) return null;
    return metrics.find((v) => v.variant_id === bestVariantId) ?? null;
  }, [metrics, bestVariantId]);

  // Don't render if no split nodes exist
  if (nodesQuery.isSuccess && nodes.length === 0) return null;
  // Still loading nodes — don't render yet
  if (nodesQuery.isLoading) return null;

  const isLoadingMetrics = metricsQuery.isLoading;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-purple-600" />
          <h3 className="text-lg font-semibold">Split A/B — Experimento</h3>
        </div>
        {nodes.length > 1 && (
          <Select value={selectedNodeId} onValueChange={setSelectedNodeId}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Selecionar node" />
            </SelectTrigger>
            <SelectContent>
              {nodes.map((n) => (
                <SelectItem key={n.id} value={n.id}>
                  {n.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Loading state */}
      {isLoadingMetrics && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoadingMetrics && metrics.length === 0 && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">
              Nenhuma execucao registrada para este split ainda.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Data loaded */}
      {!isLoadingMetrics && metrics.length > 0 && (
        <>
          {/* Summary row */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total de leads
                </CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totals.leads}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total de execucoes
                </CardTitle>
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totals.executions}</div>
              </CardContent>
            </Card>

            <Card className="border-green-200 bg-green-50/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Melhor variante
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                {bestVariant ? (
                  <div>
                    <div className="text-2xl font-bold">
                      {bestVariant.variant_label}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {pct(getCompletionRate(bestVariant))} taxa de conclusao
                    </p>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">—</div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Variant comparison cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {metrics.map((v) => {
              const isBest =
                bestVariantId !== null && v.variant_id === bestVariantId;
              const trafficShare =
                totals.leads > 0 ? v.total_leads / totals.leads : 0;

              return (
                <Card
                  key={v.variant_id}
                  className={
                    isBest ? "border-green-300 ring-1 ring-green-200" : ""
                  }
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base">
                        {v.variant_label}
                      </CardTitle>
                      <div className="flex items-center gap-1">
                        {isBest && (
                          <Badge
                            variant="default"
                            className="bg-green-600 text-white"
                          >
                            Melhor
                          </Badge>
                        )}
                        <Badge variant="outline">{pct(trafficShare)}</Badge>
                      </div>
                    </div>
                    <CardDescription>
                      {v.total_leads} leads | {v.total_executions} execucoes
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {/* Messages sent */}
                    <FunnelRow
                      icon={
                        <MessageSquare className="h-4 w-4 text-blue-500" />
                      }
                      label="Mensagens enviadas"
                      count={v.messages_sent}
                    />
                    {/* Completed */}
                    <FunnelRow
                      icon={
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      }
                      label="Concluidos"
                      count={v.completed}
                      rate={pct(getCompletionRate(v))}
                    />
                    {/* Failed */}
                    <FunnelRow
                      icon={<XCircle className="h-4 w-4 text-red-500" />}
                      label="Falhas"
                      count={v.failed}
                      rate={pct(getFailureRate(v))}
                    />
                    {/* Waiting response */}
                    <FunnelRow
                      icon={<Clock className="h-4 w-4 text-yellow-500" />}
                      label="Aguardando resposta"
                      count={v.waiting_response}
                    />
                    {/* In progress */}
                    <FunnelRow
                      icon={<Clock className="h-4 w-4 text-blue-400" />}
                      label="Em andamento"
                      count={v.in_progress}
                    />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function FunnelRow({
  icon,
  label,
  count,
  rate,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  rate?: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-1.5 font-medium">
        <span>{count}</span>
        {rate && (
          <span className="text-xs text-muted-foreground">({rate})</span>
        )}
      </div>
    </div>
  );
}

export default SplitAbAnalytics;
