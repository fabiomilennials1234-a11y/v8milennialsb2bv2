import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import { type MRREvolutionPoint } from "@/hooks/useAnalyticsFinanceiro";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";

interface Props {
  data: MRREvolutionPoint[];
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(1)}k`;
  return `R$ ${value.toFixed(0)}`;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; fill: string }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md text-xs space-y-1">
      <p className="font-medium">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.fill }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium">{formatCurrency(Math.abs(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

export function MRREvolution({ data }: Props) {
  if (!data.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Evolução de MRR</CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState message="Sem dados de MRR no período." />
        </CardContent>
      </Card>
    );
  }

  const totalNewMRR = data.reduce((acc, d) => acc + d.new_mrr, 0);
  const totalChurned = data.reduce((acc, d) => acc + d.churned_mrr_estimate, 0);
  const netChange = totalNewMRR - totalChurned;

  // Make churned negative for stacked display
  const chartData = data.map((d) => ({
    ...d,
    churned_neg: -d.churned_mrr_estimate,
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Evolução de MRR
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="month_label"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(v) => formatCurrency(Math.abs(v))}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: "11px" }} />
            <Bar
              dataKey="new_mrr"
              name="Novo MRR"
              fill="hsl(var(--chart-2))"
              radius={[3, 3, 0, 0]}
            />
            <Bar
              dataKey="churned_neg"
              name="Churn estimado"
              fill="hsl(var(--destructive))"
              radius={[0, 0, 3, 3]}
            />
          </BarChart>
        </ResponsiveContainer>

        {/* Summary row */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <div className="rounded-lg bg-muted/40 p-2 text-center">
            <p className="text-xs text-muted-foreground">Novo MRR</p>
            <p className="text-sm font-semibold text-green-600">{formatCurrency(totalNewMRR)}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-2 text-center">
            <p className="text-xs text-muted-foreground">Churn MRR</p>
            <p className="text-sm font-semibold text-destructive">{formatCurrency(totalChurned)}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-2 text-center">
            <p className="text-xs text-muted-foreground">Net Change</p>
            <p className={`text-sm font-semibold ${netChange >= 0 ? "text-green-600" : "text-destructive"}`}>
              {netChange >= 0 ? "+" : ""}{formatCurrency(netChange)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
