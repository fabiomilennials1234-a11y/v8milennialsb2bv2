import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { usePortfolioTrends } from "@/modules/carteira/hooks/usePortfolioTrends";
import { formatRevenueData } from "@/lib/analytics-helpers";
import { formatBRL } from "@/lib/format";
import { TrendingUp } from "lucide-react";

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg text-xs">
      <p className="font-medium text-foreground mb-1 capitalize">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="text-muted-foreground">
          <span
            className="inline-block w-2 h-2 rounded-full mr-1.5"
            style={{ backgroundColor: p.color }}
          />
          {p.dataKey === "approved" ? "Aprovado" : "Pendente"}: {formatBRL(p.value)}
        </p>
      ))}
    </div>
  );
}

export function RevenueChart() {
  const { data: trends, isLoading } = usePortfolioTrends();

  const chartData = useMemo(
    () => formatRevenueData(trends?.revenue_monthly ?? []),
    [trends?.revenue_monthly],
  );

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 animate-pulse">
        <div className="h-4 bg-muted rounded w-40 mb-4" />
        <div className="h-[240px] bg-muted rounded" />
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 text-center text-sm text-muted-foreground">
        Sem dados de receita para exibir.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Receita Mensal</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">últimos {chartData.length} meses</span>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gradApproved" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradPending" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.2} />
              <stop offset="95%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
            width={52}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="approved"
            stroke="hsl(var(--primary))"
            fill="url(#gradApproved)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="pending"
            stroke="hsl(var(--muted-foreground))"
            fill="url(#gradPending)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-primary rounded-full" /> Aprovado
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-muted-foreground rounded-full border-dashed" /> Pendente
        </span>
      </div>
    </div>
  );
}
