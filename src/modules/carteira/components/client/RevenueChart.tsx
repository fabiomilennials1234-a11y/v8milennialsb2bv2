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
import { IconChip } from "@/components/ui/bento";

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-card-border bg-card px-3 py-2 text-xs shadow-relevo-alto">
      <p className="mb-1 font-bold capitalize text-foreground">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="tabular-nums text-muted-foreground">
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
      <div className="animate-pulse rounded-card border border-card-border bg-card p-5 shadow-relevo">
        <div className="mb-4 h-4 w-40 rounded bg-muted" />
        <div className="h-[240px] rounded-xl bg-muted" />
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="rounded-card border border-card-border bg-card p-8 text-center text-sm text-muted-foreground shadow-relevo">
        Sem dados de receita para exibir.
      </div>
    );
  }

  return (
    <section className="rounded-card border border-card-border bg-card p-5 shadow-relevo">
      <div className="mb-4 flex items-center gap-2">
        <IconChip icon={TrendingUp} tone="gold" />
        <h3 className="text-[15px] font-bold tracking-[-0.02em] text-foreground">Receita mensal</h3>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          últimos {chartData.length} meses
        </span>
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
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: "hsl(var(--border))" }} />
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

      <div className="mt-3 flex items-center gap-4 text-[11px] font-medium text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full bg-primary" /> Aprovado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full bg-muted-foreground" /> Pendente
        </span>
      </div>
    </section>
  );
}
