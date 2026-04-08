import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Lightbulb, TrendingUp, AlertTriangle, Star } from "lucide-react";
import { type OverviewInsight } from "@/hooks/useAnalyticsOverview";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { AT } from "../analytics-tokens";

interface Props {
  insights: OverviewInsight[];
}

const INSIGHT_CONFIG: Record<
  OverviewInsight["type"],
  {
    borderColor: string;
    bgColor: string;
    textColor: string;
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  oportunidade: {
    borderColor: "border-l-success",
    bgColor: "bg-success/5",
    textColor: "text-success",
    label: "Oportunidade",
    Icon: Star,
  },
  alerta: {
    borderColor: "border-l-destructive",
    bgColor: "bg-destructive/5",
    textColor: "text-destructive",
    label: "Alerta",
    Icon: AlertTriangle,
  },
  tendencia: {
    borderColor: "border-l-purple-500",
    bgColor: "bg-purple-500/5",
    textColor: "text-purple-500",
    label: "Tendência",
    Icon: TrendingUp,
  },
  padrao: {
    borderColor: "border-l-orange-500",
    bgColor: "bg-orange-500/5",
    textColor: "text-orange-500",
    label: "Padrão",
    Icon: Lightbulb,
  },
};

export function AutomatedInsights({ insights }: Props) {
  if (insights.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
            <Lightbulb className="h-4 w-4" />
            Insights Automatizados
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Nenhum insight identificado no período."
            detail="Aguarde mais dados para gerar insights automaticamente."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <Lightbulb className="h-4 w-4" />
          Insights Automatizados
        </CardTitle>
        <p className={AT.chartSubtitle}>
          Análises geradas automaticamente com base nos dados do período
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {insights.slice(0, 4).map((insight, i) => {
          const config = INSIGHT_CONFIG[insight.type];
          const { Icon } = config;
          return (
            <div
              key={i}
              className={`border-l-4 rounded-r-lg pl-4 pr-3 py-3 ${config.borderColor} ${config.bgColor}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`h-3.5 w-3.5 ${config.textColor}`} />
                <span className={`text-xs font-semibold uppercase tracking-wide ${config.textColor}`}>
                  {config.label}
                </span>
              </div>
              <div className="text-sm font-medium mb-0.5">{insight.title}</div>
              <div className="text-xs text-muted-foreground leading-relaxed">
                {insight.description}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
