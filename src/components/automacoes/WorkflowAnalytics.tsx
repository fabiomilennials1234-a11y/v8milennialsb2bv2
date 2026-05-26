import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Users, CheckCircle2, XCircle, Clock, Loader2, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">Analytics</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!stats || stats.total === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">Analytics</h3>
        </div>
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">Nenhuma execucao registrada</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const completionRate = pct(stats.completed, stats.total);
  const failureRate = pct(stats.failed, stats.total);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">Analytics</h3>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          label="Total execucoes"
          value={String(stats.total)}
        />
        <StatCard
          icon={<Clock className="h-4 w-4 text-blue-400" />}
          label="Em andamento"
          value={String(stats.running + stats.waiting)}
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          label="Concluidos"
          value={`${stats.completed} (${completionRate})`}
        />
        <StatCard
          icon={<XCircle className="h-4 w-4 text-red-500" />}
          label="Falhas"
          value={`${stats.failed} (${failureRate})`}
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4 text-amber-500" />}
          label="Tempo medio"
          value={stats.avgDurationMs != null ? formatDuration(stats.avgDurationMs) : "--"}
        />
      </div>

      {/* Per-node stats */}
      {nodeStats.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Desempenho por no</CardTitle>
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
                      <Badge variant="secondary" className="text-xs tabular-nums">
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

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          {icon}
        </div>
        <p className="text-xl font-bold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
