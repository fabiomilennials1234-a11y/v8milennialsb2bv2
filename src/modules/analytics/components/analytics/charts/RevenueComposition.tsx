import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign } from "lucide-react";
import { type RevenueByType } from "@/modules/analytics/hooks/useAnalyticsFinanceiro";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { AT } from "../analytics-tokens";

interface Props {
  data: RevenueByType[];
  totalRevenue: number;
}

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

const TYPE_LABELS: Record<string, string> = {
  mrr: "Recorrência",
  projeto: "Projeto",
  unitario: "Unitário",
  physical: "Físico",
  digital: "Digital",
  service: "Serviço",
  outros: "Outros",
};

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(1)}k`;
  return `R$ ${value.toFixed(0)}`;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: RevenueByType }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md text-xs">
      <p className="font-medium mb-1">{TYPE_LABELS[item.product_type] ?? item.product_type}</p>
      <p className="text-muted-foreground">{formatCurrency(item.total_revenue)}</p>
      <p className="text-muted-foreground">{item.pct}% do total</p>
      <p className="text-muted-foreground">{item.deal_count} deal{item.deal_count !== 1 ? "s" : ""}</p>
    </div>
  );
}

export function RevenueComposition({ data, totalRevenue }: Props) {
  if (!data.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className={AT.chartTitle}>Composição de Receita</CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState message="Sem dados de receita no período." />
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map((d) => ({
    ...d,
    name: TYPE_LABELS[d.product_type] ?? d.product_type,
    value: d.total_revenue,
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <DollarSign className="h-4 w-4" />
          Composição de Receita
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={70}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
              >
                {chartData.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={COLORS[index % COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: "11px" }}
                formatter={(value, entry) => {
                  const item = (entry as { payload?: RevenueByType }).payload;
                  return item
                    ? `${value} — ${formatCurrency(item.total_revenue)} (${item.pct}%)`
                    : value;
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Center label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style={{ top: "-12px" }}>
            <span className="text-xs text-muted-foreground">Total</span>
            <span className="text-base font-bold">{formatCurrency(totalRevenue)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
