import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Users, CheckCircle2, XCircle, Clock, Loader2, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { IconChip, KpiTile } from "@/components/ui/bento";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
interface WorkflowAnalyticsProps {
  workflowId: string;
}

interface WorkflowStats {
  total: number;
  running: number;
  completed: number;
  failed: number;
  waiting: number;
  avgDurationMs: number | null;
}

function useWorkflowStats(workflowId: string) {
  const { organizationId } = useOrganization();

  return useQuery<WorkflowStats>({
    queryKey: ["workflow-stats", workflowId, organizationId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("workflow_executions")
        .select("status, started_at, completed_at")
        .eq("workflow_id", workflowId)
        .eq("organization_id", organizationId!);

      if (error) throw error;

      const rows = (data ?? []) as {
        status: string;
        started_at: string;
        completed_at: string | null;
      }[];

      let total = rows.length;
      let running = 0;
      let completed = 0;
      let failed = 0;
      let waiting = 0;
      let durationSum = 0;
      let durationCount = 0;

      for (const row of rows) {
        switch (row.status) {
          case "running":
            running++;
            break;
          case "completed":
            completed++;
            break;
          case "failed":
          case "loop_limit_reached":
            failed++;
            break;
          case "waiting_response":
          case "paused":
            waiting++;
            break;
        }

        if (row.completed_at && row.started_at) {
          const dur = new Date(row.completed_at).getTime() - new Date(row.started_at).getTime();
          durationSum += dur;
          durationCount++;
        }
      }

      return {
        total,
        running,
        completed,
        failed,
        waiting,
        avgDurationMs: durationCount > 0 ? durationSum / durationCount : null,
      };
    },
    enabled: !!organizationId && !!workflowId,
    staleTime: 60_000,
  });
}

function useWorkflowNodeStats(workflowId: string) {
  return useQuery({
    queryKey: ["workflow-node-stats", workflowId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_workflow_node_stats", {
        p_workflow_id: workflowId,
      });
      if (error) throw error;
      return (data ?? []) as {
        node_id: string;
        executions_count: number;
        success_count: number;
        error_count: number;
        avg_duration_ms: number | null;
      }[];
    },
    enabled: !!workflowId,
    staleTime: 60_000,
  });
}

function formatDuration(ms: number) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}min`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function pct(n: number, total: number) {
  if (total === 0) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

export function WorkflowAnalytics({ workflowId }: WorkflowAnalyticsProps) {
  const { data: stats, isLoading: statsLoading } = useWorkflowStats(workflowId);
  const { data: nodeStats = [], isLoading: nodesLoading } = useWorkflowNodeStats(workflowId);

  const isLoading = statsLoading || nodesLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <AnalyticsTitle />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-[88px] rounded-card" />
          ))}
        </div>
      </div>
    );
  }

  if (!stats || stats.total === 0) {
    return (
      <div className="space-y-4">
        <AnalyticsTitle />
        <div className="flex items-center justify-center rounded-card border border-dashed border-border bg-sunken py-12">
          <p className="text-sm text-muted-foreground">Nenhuma execução registrada</p>
        </div>
      </div>
    );
  }

  const completionRate = pct(stats.completed, stats.total);
  const failureRate = pct(stats.failed, stats.total);

  return (
    <div className="space-y-4">
      <AnalyticsTitle />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <KpiTile icon={Users} tone="neutral" label="Total execuções" value={String(stats.total)} />
        <KpiTile icon={Clock} tone="info" label="Em andamento" value={String(stats.running + stats.waiting)} />
        <KpiTile icon={CheckCircle2} tone="good" label="Concluídos" value={stats.completed} note={completionRate} />
        <KpiTile icon={XCircle} tone="bad" label="Falhas" value={stats.failed} note={failureRate} />
        <KpiTile
          icon={TrendingUp}
          tone="gold"
          label="Tempo médio"
          value={stats.avgDurationMs != null ? formatDuration(stats.avgDurationMs) : "--"}
        />
      </div>

      {/* Per-node stats */}
      {nodeStats.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Desempenho por nó</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {nodeStats.map((node) => {
                const errorRate = node.executions_count > 0
                  ? (node.error_count / node.executions_count) * 100
                  : 0;
                return (
                  <div key={node.node_id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground w-24 truncate">
                        {node.node_id}
                      </span>
                      <span className="tabular-nums">{node.executions_count}x</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="success" className="text-xs tabular-nums">
                        {node.success_count} ok
                      </Badge>
                      {node.error_count > 0 && (
                        <Badge variant="destructive" className="text-xs tabular-nums">
                          {node.error_count} err ({errorRate.toFixed(0)}%)
                        </Badge>
                      )}
                      {node.avg_duration_ms != null && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          ~{formatDuration(node.avg_duration_ms)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AnalyticsTitle() {
  return (
    <div className="flex items-center gap-2.5">
      <IconChip icon={BarChart3} />
      <h3 className="text-base font-bold tracking-tight">Analytics</h3>
    </div>
  );
}
