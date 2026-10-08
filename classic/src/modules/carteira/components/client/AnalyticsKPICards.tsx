import { usePortfolioKPIs } from "@/modules/carteira/hooks/usePortfolioKPIs";
import { usePortfolioTrends } from "@/modules/carteira/hooks/usePortfolioTrends";
import {
  generateSparklinePath,
  deriveKPIDelta,
  type DeltaDirection,
} from "@/lib/analytics-helpers";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  DollarSign,
  Heart,
  RefreshCw,
  AlertTriangle,
  ShoppingCart,
  Receipt,
} from "lucide-react";

interface SparklineProps {
  points: number[];
  width?: number;
  height?: number;
  color?: string;
}

function Sparkline({ points, width = 64, height = 24, color = "currentColor" }: SparklineProps) {
  if (points.length < 2) return null;
  const path = generateSparklinePath(points, width, height);
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface KPICardProps {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  delta?: { delta: number; direction: DeltaDirection };
  sparkline?: number[];
  sparkColor?: string;
  sub?: string;
  valueClassName?: string;
}

function KPICard({ label, value, icon, delta, sparkline, sparkColor, sub, valueClassName }: KPICardProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
          {label}
        </span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className={cn("text-xl font-bold tabular-nums leading-tight", valueClassName ?? "text-foreground")}>
            {value}
          </span>
          <div className="flex items-center gap-1.5">
            {delta && delta.direction !== "neutral" && (
              <span className={cn(
                "text-[10px] font-semibold tabular-nums",
                delta.direction === "up" ? "text-emerald-400" : "text-red-400",
              )}>
                {delta.direction === "up" ? "↑" : "↓"}{delta.delta}%
              </span>
            )}
            {sub && (
              <span className="text-[10px] text-muted-foreground">{sub}</span>
            )}
          </div>
        </div>
        {sparkline && sparkline.length >= 2 && (
          <Sparkline points={sparkline} color={sparkColor} />
        )}
      </div>
    </div>
  );
}

export function AnalyticsKPICards() {
  const { data: kpis, isLoading: kpisLoading } = usePortfolioKPIs();
  const { data: trends, isLoading: trendsLoading } = usePortfolioTrends();

  const isLoading = kpisLoading || trendsLoading;

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse">
            <div className="h-3 bg-muted rounded w-2/3 mb-2" />
            <div className="h-6 bg-muted rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (!kpis || kpis.total_clients === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-8 text-center">
        <p className="text-sm font-medium text-muted-foreground">Sem dados para analytics</p>
      </div>
    );
  }

  const rev = trends?.revenue_monthly ?? [];
  const revenueValues = rev.map((r) => r.approved + r.pending);
  const approvedValues = rev.map((r) => r.approved);
  const currentRevenue = rev.length > 0 ? rev[rev.length - 1].approved + rev[rev.length - 1].pending : 0;
  const prevRevenue = rev.length > 1 ? rev[rev.length - 2].approved + rev[rev.length - 2].pending : 0;
  const revenueDelta = deriveKPIDelta(currentRevenue, prevRevenue);

  const healthPoints = (trends?.health_daily ?? []).map((h) => h.avg_score);

  const retentionPoints = (trends?.retention_monthly ?? []).map((r) => r.rate);
  const currentRetention = retentionPoints.length > 0 ? retentionPoints[retentionPoints.length - 1] : 0;
  const prevRetention = retentionPoints.length > 1 ? retentionPoints[retentionPoints.length - 2] : 0;
  const retentionDelta = deriveKPIDelta(currentRetention, prevRetention);

  const ticketValues = approvedValues.length > 0 && kpis.total_clients > 0
    ? approvedValues.map((v) => v / kpis.total_clients)
    : [];
  const ticketDelta = deriveKPIDelta(
    kpis.avg_ticket,
    ticketValues.length > 1 ? ticketValues[ticketValues.length - 2] : 0,
  );

  const overduePercent = kpis.total_clients > 0
    ? Math.round((kpis.overdue_count / kpis.total_clients) * 100)
    : 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      <KPICard
        label="Receita Recorrente"
        value={formatBRL(kpis.total_recurring)}
        icon={<DollarSign size={14} />}
        delta={revenueDelta}
        sparkline={revenueValues}
        sparkColor="hsl(var(--primary))"
        sub="vs mês anterior"
      />
      <KPICard
        label="Health Médio"
        value={kpis.avg_health}
        icon={<Heart size={14} />}
        sparkline={healthPoints}
        sparkColor={kpis.avg_health >= 70 ? "#34d399" : kpis.avg_health >= 50 ? "#fbbf24" : "#f87171"}
        sub="/100"
        valueClassName={
          kpis.avg_health >= 70 ? "text-emerald-400" :
          kpis.avg_health >= 50 ? "text-amber-400" : "text-red-400"
        }
      />
      <KPICard
        label="Taxa Retenção"
        value={`${currentRetention}%`}
        icon={<RefreshCw size={14} />}
        delta={retentionDelta}
        sparkline={retentionPoints}
        sparkColor="#34d399"
        sub="M1 últimos meses"
      />
      <KPICard
        label="Churn Previsto"
        value={trends?.churn_summary.count ?? 0}
        icon={<AlertTriangle size={14} />}
        sub={trends?.churn_summary.total_value ? formatBRL(trends.churn_summary.total_value) + " em risco" : undefined}
        valueClassName={(trends?.churn_summary.count ?? 0) > 0 ? "text-red-400" : undefined}
      />
      <KPICard
        label="Recompra Atrasada"
        value={kpis.overdue_count}
        icon={<ShoppingCart size={14} />}
        sub={`${overduePercent}% da base`}
        valueClassName={kpis.overdue_count > 0 ? "text-destructive" : undefined}
      />
      <KPICard
        label="Ticket Médio"
        value={formatBRL(kpis.avg_ticket)}
        icon={<Receipt size={14} />}
        delta={ticketDelta}
        sparkline={ticketValues}
        sparkColor="hsl(var(--primary))"
        sub="vs mês anterior"
      />
    </div>
  );
}
