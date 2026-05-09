import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Scale, Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useWinLossAnalysis, type WinLossItem } from "@/hooks/useAnalytics";
import { useAnalyticsFilters } from "@/hooks/useAnalyticsFilters";
import { AT } from "./analytics-tokens";
import { AnalyticsEmptyState } from "./AnalyticsEmptyState";

const REASON_LABELS: Record<string, string> = {
  sem_budget: "Sem budget",
  concorrencia: "Concorrência",
  timing: "Timing errado",
  follow_up_fraco: "Follow-up fraco",
  produto_nao_adequado: "Produto não adequado",
  outro: "Outro",
  "Não informado": "Não informado",
};

const PIE_COLORS = ["#ef4444", "#f97316", "#eab308", "#6366f1", "#8b5cf6", "#ec4899", "#94a3b8"];

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(1)}K`;
  return `R$ ${value.toFixed(0)}`;
}

export function WinLossAnalysis() {
  const { startStr, endStr } = useAnalyticsFilters();
  const { data: lossReasons, isLoading } = useWinLossAnalysis(startStr, endStr);

  const pieData = useMemo(() => {
    if (!lossReasons) return [];
    return lossReasons.map((r: WinLossItem) => ({
      name: REASON_LABELS[r.loss_reason] ?? r.loss_reason,
      value: r.count,
      totalValue: Number(r.total_value) / 100,
      pct: Number(r.pct),
    }));
  }, [lossReasons]);

  const totalLost = pieData.reduce((s, d) => s + d.value, 0);
  const totalLostValue = pieData.reduce((s, d) => s + d.totalValue, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <Scale className="h-4 w-4" />
          Análise Win/Loss
        </CardTitle>
        <p className={AT.chartSubtitle}>
          Motivos de perda e valor deixado na mesa
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : pieData.length === 0 ? (
          <AnalyticsEmptyState
            message="Sem dados de perda registrados"
            detail="Preencha o motivo ao mover deals para 'Perdido' no funil de propostas."
          />
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-center">
                <TrendingDown className="h-4 w-4 text-destructive mx-auto mb-1" />
                <div className={`${AT.valueMd} text-destructive`}>{totalLost}</div>
                <div className="text-[10px] text-muted-foreground">Deals Perdidos</div>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-center">
                <TrendingUp className="h-4 w-4 text-amber-500 mx-auto mb-1" />
                <div className={`${AT.valueMd} text-amber-500`}>{formatCurrency(totalLostValue)}</div>
                <div className="text-[10px] text-muted-foreground">Valor Perdido</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Pie Chart */}
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={2}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Breakdown bars */}
              <div className="space-y-2">
                {pieData.map((item, i) => (
                  <div key={item.name}>
                    <div className="flex justify-between mb-0.5">
                      <div className="flex items-center gap-1.5">
                        <div
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        <span className="text-xs text-muted-foreground">{item.name}</span>
                      </div>
                      <span className="text-xs font-medium">{item.pct.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${item.pct}%`,
                          backgroundColor: PIE_COLORS[i % PIE_COLORS.length],
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
