import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Loader2 } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useRevenueAttribution, type RevenueAttribution as RevenueAttrType } from "@/modules/analytics/hooks/useAnalytics";
import { useAnalyticsFilters } from "@/modules/analytics/hooks/useAnalyticsFilters";
import { AT } from "./analytics-tokens";
import { AnalyticsEmptyState } from "./AnalyticsEmptyState";

const PIE_COLORS = ["#6366f1", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(1)}K`;
  return `R$ ${value.toFixed(0)}`;
}

const ORIGIN_LABELS: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  whatsapp: "WhatsApp",
  indicacao: "Indicação",
  site: "Site",
  linkedin: "LinkedIn",
  outbound: "Outbound",
  unknown: "Desconhecido",
};

export function RevenueAttribution() {
  const { startStr, endStr } = useAnalyticsFilters();
  const { data: attributions, isLoading } = useRevenueAttribution(startStr, endStr);

  const pieData = useMemo(() => {
    if (!attributions) return [];
    return attributions
      .filter((a: RevenueAttrType) => a.total_revenue > 0)
      .map((a: RevenueAttrType) => ({
        name: ORIGIN_LABELS[a.origin] ?? a.origin,
        value: Number(a.total_revenue) / 100,
        wonCount: a.won_count,
        avgDeal: Number(a.avg_deal_value) / 100,
        convRate: Number(a.conversion_rate),
      }));
  }, [attributions]);

  const totalRevenue = pieData.reduce((s, d) => s + d.value, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <DollarSign className="h-4 w-4" />
          Receita por Origem
        </CardTitle>
        <p className={AT.chartSubtitle}>
          Distribuição de receita por canal de aquisição
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : pieData.length === 0 ? (
          <AnalyticsEmptyState
            message="Sem dados de receita por origem"
            detail="Necessário vendas fechadas com origem identificada."
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Pie Chart */}
            <div className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={85}
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
                    formatter={(value: number) => [formatCurrency(value), "Receita"]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Table */}
            <div className="space-y-2">
              {pieData.map((item, i) => {
                const pct = totalRevenue > 0 ? (item.value / totalRevenue) * 100 : 0;
                return (
                  <div key={item.name} className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium truncate">{item.name}</span>
                        <span className={AT.valueSm}>{formatCurrency(item.value)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted-foreground">
                          {pct.toFixed(1)}% do total
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {item.wonCount} vendas
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {item.convRate.toFixed(1)}% conv.
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
