import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useSalesCycleAnalysis, type SalesCycleStage } from "@/modules/analytics/hooks/useAnalytics";
import { useAnalyticsFilters } from "@/modules/analytics/hooks/useAnalyticsFilters";
import { useAnalyticsPipelineOptions } from "@/modules/analytics/hooks/useAnalyticsPipelineOptions";
import { AT } from "./analytics-tokens";
import { AnalyticsEmptyState } from "./AnalyticsEmptyState";

type GroupBy = "transition" | "summary";

function formatHours(hours: number): string {
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}

const BAR_COLORS = ["#6366f1", "#3b82f6", "#f59e0b", "#22c55e", "#ef4444", "#8b5cf6"];

export function SalesCycleChart() {
  const [groupBy, setGroupBy] = useState<GroupBy>("transition");
  // SCRUM-631: o funil deixa de ser o slug fixo "propostas" — qualquer funil
  // da org, por pipeline_id. Default: funil de fechamento (comportamento legado).
  const { options, closingDefault } = useAnalyticsPipelineOptions();
  const [pipeline, setPipeline] = useState<string | null>(null);
  const selectedPipeline = pipeline ?? closingDefault;
  const { startStr, endStr } = useAnalyticsFilters();
  const { data: stages, isLoading } = useSalesCycleAnalysis(selectedPipeline, startStr, endStr);

  const chartData = useMemo(() => {
    if (!stages || stages.length === 0) return [];

    if (groupBy === "transition") {
      return stages.slice(0, 8).map((s: SalesCycleStage) => ({
        name: `${s.from_stage} → ${s.to_stage}`,
        avg: Number(s.avg_hours.toFixed(1)),
        median: Number(s.median_hours.toFixed(1)),
        count: s.transition_count,
      }));
    }

    // Summary: aggregate by to_stage
    const byStage = new Map<string, { total: number; count: number }>();
    stages.forEach((s: SalesCycleStage) => {
      const prev = byStage.get(s.to_stage) ?? { total: 0, count: 0 };
      byStage.set(s.to_stage, {
        total: prev.total + Number(s.avg_hours) * s.transition_count,
        count: prev.count + s.transition_count,
      });
    });
    return Array.from(byStage.entries()).map(([stage, v]) => ({
      name: stage,
      avg: Number((v.total / v.count).toFixed(1)),
      median: 0,
      count: v.count,
    }));
  }, [stages, groupBy]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
            <Clock className="h-4 w-4" />
            Ciclo de Vendas
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={selectedPipeline ?? undefined} onValueChange={setPipeline}>
              <SelectTrigger className="w-[150px] h-8 text-xs">
                <SelectValue placeholder="Funil" />
              </SelectTrigger>
              <SelectContent>
                {options.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {opt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="transition">Por Transição</SelectItem>
                <SelectItem value="summary">Por Etapa</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className={AT.chartSubtitle}>
          Tempo médio entre movimentações no pipeline
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : chartData.length === 0 ? (
          <AnalyticsEmptyState
            message="Sem dados de ciclo de vendas"
            detail="Necessário leads com movimentações entre etapas."
          />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
              <XAxis
                type="number"
                tickFormatter={formatHours}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={120}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: number) => [formatHours(value), "Tempo Médio"]}
                labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
              />
              <Bar dataKey="avg" radius={[0, 4, 4, 0]} maxBarSize={24}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
