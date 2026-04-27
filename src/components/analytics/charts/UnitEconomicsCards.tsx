import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";
import { type UnitEconomics } from "@/hooks/useAnalyticsOverview";
import { AT } from "../analytics-tokens";

interface Props {
  data: UnitEconomics;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(1)}K`;
  return `R$ ${value.toFixed(0)}`;
}

function healthColor(ratio: number): {
  bg: string;
  text: string;
  label: string;
} {
  if (ratio >= 3) return { bg: "bg-success/10", text: "text-success", label: "Saudável" };
  if (ratio >= 1.5) return { bg: "bg-yellow-500/10", text: "text-yellow-600", label: "Atenção" };
  return { bg: "bg-destructive/10", text: "text-destructive", label: "Crítico" };
}

export function UnitEconomicsCards({ data }: Props) {
  const { bg, text, label } = healthColor(data.ltv_cac_ratio);

  const cards = [
    {
      label: "CAC Estimado",
      value: formatCurrency(data.cac_estimate),
      subtitle: "Custo de aquisição por cliente",
      badge: "estimado",
      badgeVariant: "secondary" as const,
    },
    {
      label: "LTV Estimado",
      value: formatCurrency(data.ltv_estimate),
      subtitle: "Valor do tempo de vida do cliente",
      badge: "estimado",
      badgeVariant: "secondary" as const,
    },
    {
      label: "LTV / CAC",
      value: `${data.ltv_cac_ratio.toFixed(1)}x`,
      subtitle: "Razão ideal: acima de 3x",
      badge: label,
      badgeVariant: undefined,
      badgeCls: `${bg} ${text} border-0`,
    },
    {
      label: "Payback",
      value: `${data.payback_months.toFixed(0)} meses`,
      subtitle: "Tempo para recuperar o CAC",
      badge: undefined,
    },
    {
      label: "Churn Estimado",
      value: `${data.churn_rate_estimate.toFixed(1)}%`,
      subtitle: "Taxa de cancelamento estimada",
      badge: undefined,
    },
    {
      label: "Receita em Risco",
      value: formatCurrency(data.revenue_churn_estimate),
      subtitle: "Receita de contratos encerrados",
      badge: undefined,
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <TrendingUp className="h-4 w-4" />
          Unit Economics
        </CardTitle>
        <p className={AT.chartSubtitle}>
          Métricas estimadas com base nos dados do período
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {cards.map((card) => (
            <div
              key={card.label}
              className="rounded-lg border border-border bg-card p-3 flex flex-col gap-1"
            >
              <div className="flex items-center justify-between gap-1 flex-wrap">
                <span className={AT.metricLabel}>{card.label}</span>
                {card.badge && (
                  card.badgeCls ? (
                    <Badge className={`text-[10px] px-1.5 py-0 h-4 ${card.badgeCls}`}>
                      {card.badge}
                    </Badge>
                  ) : (
                    <Badge variant={card.badgeVariant} className="text-[10px] px-1.5 py-0 h-4">
                      {card.badge}
                    </Badge>
                  )
                )}
              </div>
              <div className={AT.valueMd}>{card.value}</div>
              <div className={`${AT.metricSublabel} leading-tight`}>
                {card.subtitle}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
