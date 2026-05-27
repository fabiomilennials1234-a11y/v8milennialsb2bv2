import { Card, CardContent } from "@/components/ui/card";
import { Users, DollarSign, Target, TrendingUp, ArrowDownRight, Percent } from "lucide-react";
import type { UtmKpis } from "@/modules/analytics/hooks/useAnalyticsUtms";

interface Props {
  kpis: UtmKpis;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 });
}

export function UtmKpiCards({ kpis }: Props) {
  const cards = [
    {
      label: "Total de Leads",
      value: kpis.totalLeads.toLocaleString("pt-BR"),
      icon: Users,
    },
    {
      label: "Total Investido",
      value: formatCurrency(kpis.totalSpend),
      icon: DollarSign,
    },
    {
      label: "CPL",
      value: formatCurrency(kpis.avgCpl),
      icon: ArrowDownRight,
    },
    {
      label: "Conversão",
      value: `${kpis.avgConversionRate.toFixed(1)}%`,
      icon: Percent,
    },
    {
      label: "ROAS",
      value: kpis.roas.toFixed(2) + "x",
      icon: TrendingUp,
    },
    {
      label: "CAC",
      value: formatCurrency(kpis.cac),
      icon: Target,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 mb-1">
              <card.icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{card.label}</span>
            </div>
            <p className="text-lg font-semibold tabular-nums">{card.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
