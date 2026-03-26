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
import { BarChart3 } from "lucide-react";
import { type TicketByType } from "@/hooks/useAnalyticsFinanceiro";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";

interface Props {
  data: TicketByType[];
}

const TYPE_COLORS: Record<string, string> = {
  mrr: "hsl(var(--chart-1))",
  projeto: "hsl(var(--chart-2))",
  unitario: "hsl(var(--chart-3))",
  physical: "hsl(var(--chart-4))",
  digital: "hsl(var(--chart-5))",
  service: "hsl(var(--chart-1))",
  outros: "hsl(var(--muted-foreground))",
};

const TYPE_LABELS: Record<string, string> = {
  mrr: "MRR",
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
          <span className="font-medium">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function TicketEvolution({ data }: Props) {
  if (!data.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Evolução do Ticket Médio</CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState message="Sem dados de ticket no período." />
        </CardContent>
      </Card>
    );
  }

  // Build pivot: months as rows, product_types as keys
  const months = [...new Set(data.map((d) => d.month_label))];
  const types = [...new Set(data.map((d) => d.product_type))];

  const pivoted = months.map((month) => {
    const row: Record<string, number | string> = { month_label: month };
    types.forEach((type) => {
      const match = data.find((d) => d.month_label === month && d.product_type === type);
      row[type] = match ? match.avg_ticket : 0;
    });
    return row;
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Evolução do Ticket Médio
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={pivoted} barGap={2} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="month_label"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(v) => formatCurrency(v)}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: "11px" }} />
            {types.map((type) => (
              <Bar
                key={type}
                dataKey={type}
                name={TYPE_LABELS[type] ?? type}
                fill={TYPE_COLORS[type] ?? "hsl(var(--chart-1))"}
                radius={[3, 3, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
