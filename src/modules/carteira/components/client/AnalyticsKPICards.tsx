import { usePortfolioKPIs } from "@/modules/carteira/hooks/usePortfolioKPIs";
import { usePortfolioTrends } from "@/modules/carteira/hooks/usePortfolioTrends";
import {
  generateSparklinePath,
  deriveKPIDelta,
  type DeltaDirection,
} from "@/lib/analytics-helpers";
import { formatBRL } from "@/lib/format";
import { KpiTile, ValueUnit } from "@/components/ui/bento";
import {
  DollarSign,
  HeartPulse,
  RefreshCw,
  AlertTriangle,
  ShoppingCart,
  Receipt,
} from "lucide-react";

/*
 * V5 (2026-10): os seis cartões viram `KpiTile` com o mini-gráfico embaixo.
 * Mesmos números, mesmas tendências. As cores das linhas deixam de ser hex
 * (#34d399/#fbbf24/#f87171) e passam a ser token — o escuro deixa de quebrar.
 */
const SPARK_W = 120;
const SPARK_H = 30;

function Sparkline({ points, color = "currentColor" }: { points: number[]; color?: string }) {
  if (points.length < 2) return null;
  const path = generateSparklinePath(points, SPARK_W, SPARK_H);
  return (
    <svg
      viewBox={`-1 -2 ${SPARK_W + 2} ${SPARK_H + 4}`}
      preserveAspectRatio="none"
      className="h-8 w-full overflow-visible"
      aria-hidden
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** `deriveKPIDelta` devolve o módulo + a direção; o tile quer o número com sinal. */
function signedDelta(d: { delta: number; direction: DeltaDirection }): number | undefined {
  if (d.direction === "neutral") return undefined;
  return d.direction === "up" ? d.delta : -d.delta;
}

const TOKEN = {
  gold: "hsl(var(--primary))",
  good: "hsl(var(--success))",
  warn: "hsl(var(--warning))",
  bad: "hsl(var(--destructive))",
};

export function AnalyticsKPICards() {
  const { data: kpis, isLoading: kpisLoading } = usePortfolioKPIs();
  const { data: trends, isLoading: trendsLoading } = usePortfolioTrends();

  const isLoading = kpisLoading || trendsLoading;

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {["Receita recorrente", "Health médio", "Taxa de retenção", "Churn previsto", "Recompra atrasada", "Ticket médio"].map(
          (label) => (
            <KpiTile key={label} label={label} value="·" loading />
          ),
        )}
      </div>
    );
  }

  if (!kpis || kpis.total_clients === 0) {
    return (
      <div className="rounded-card border border-dashed border-border bg-card/60 px-6 py-8 text-center">
        <p className="text-sm font-bold text-muted-foreground">Sem dados para analytics</p>
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

  // Mesmas faixas de antes (70/50).
  const healthBand = kpis.avg_health >= 70 ? "good" : kpis.avg_health >= 50 ? "warn" : "bad";
  const healthText =
    healthBand === "good" ? "text-success" : healthBand === "warn" ? "text-warning-strong" : "text-destructive";

  const churnCount = trends?.churn_summary.count ?? 0;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
      <KpiTile
        label="Receita recorrente"
        value={formatBRL(kpis.total_recurring)}
        icon={DollarSign}
        tone="gold"
        delta={signedDelta(revenueDelta)}
        deltaLabel="vs mês anterior"
        note="vs mês anterior"
      >
        {revenueValues.length >= 2 && <Sparkline points={revenueValues} color={TOKEN.gold} />}
      </KpiTile>

      <KpiTile
        label="Health médio"
        value={
          <span className={healthText}>
            {kpis.avg_health}
            <ValueUnit>/100</ValueUnit>
          </span>
        }
        icon={HeartPulse}
        tone={healthBand === "good" ? "good" : healthBand === "bad" ? "bad" : "neutral"}
      >
        {healthPoints.length >= 2 && <Sparkline points={healthPoints} color={TOKEN[healthBand]} />}
      </KpiTile>

      <KpiTile
        label="Taxa de retenção"
        value={`${currentRetention}%`}
        icon={RefreshCw}
        tone="good"
        delta={signedDelta(retentionDelta)}
        deltaLabel="M1 últimos meses"
        note="M1 últimos meses"
      >
        {retentionPoints.length >= 2 && <Sparkline points={retentionPoints} color={TOKEN.good} />}
      </KpiTile>

      <KpiTile
        label="Churn previsto"
        value={
          <span className={churnCount > 0 ? "text-destructive" : undefined}>
            {churnCount.toLocaleString("pt-BR")}
          </span>
        }
        icon={AlertTriangle}
        tone={churnCount > 0 ? "bad" : "neutral"}
        note={trends?.churn_summary.total_value ? formatBRL(trends.churn_summary.total_value) + " em risco" : undefined}
      />

      <KpiTile
        label="Recompra atrasada"
        value={
          <span className={kpis.overdue_count > 0 ? "text-destructive" : undefined}>
            {kpis.overdue_count.toLocaleString("pt-BR")}
          </span>
        }
        icon={ShoppingCart}
        tone={kpis.overdue_count > 0 ? "bad" : "neutral"}
        note={`${overduePercent}% da base`}
      />

      <KpiTile
        label="Ticket médio"
        value={formatBRL(kpis.avg_ticket)}
        icon={Receipt}
        tone="info"
        delta={signedDelta(ticketDelta)}
        deltaLabel="vs mês anterior"
        note="vs mês anterior"
      >
        {ticketValues.length >= 2 && <Sparkline points={ticketValues} color={TOKEN.gold} />}
      </KpiTile>
    </div>
  );
}
