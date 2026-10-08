import { Clock, Users, TrendingUp, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { type EngagementKPIs as KPIs } from "@/modules/analytics/hooks/useAnalyticsEngajamento";
import { AT } from "../analytics-tokens";

interface Props {
  data: KPIs;
}

export function formatResponseTime(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const CARDS = [
  {
    key: "our_avg_response_seconds" as const,
    label: "Tempo Resposta (Nós)",
    subtitle: "Nosso tempo médio de resposta",
    icon: Clock,
    iconColor: "text-blue-500",
    bgColor: "bg-blue-500/10",
    format: (v: number) => formatResponseTime(v),
    thresholdGood: 240,   // <4min green
    thresholdWarn: 420,   // 4-7min orange, else red
    lowerIsBetter: true,
  },
  {
    key: "client_avg_response_seconds" as const,
    label: "Tempo Resposta (Cliente)",
    subtitle: "Tempo médio que o cliente leva para responder",
    icon: Users,
    iconColor: "text-purple-500",
    bgColor: "bg-purple-500/10",
    format: (v: number) => formatResponseTime(v),
    thresholdGood: 3600,  // <1h
    thresholdWarn: 86400, // <1d
    lowerIsBetter: true,
  },
  {
    key: "response_rate_pct" as const,
    label: "Taxa de Resposta",
    subtitle: "Leads que responderam nosso contato",
    icon: TrendingUp,
    iconColor: "text-green-500",
    bgColor: "bg-green-500/10",
    format: (v: number) => `${v.toFixed(1)}%`,
    thresholdGood: 50,
    thresholdWarn: 30,
    lowerIsBetter: false,
  },
  {
    key: "close_rate_pct" as const,
    label: "Taxa de Fechamento",
    subtitle: "Leads convertidos em vendas",
    icon: CheckCircle2,
    iconColor: "text-orange-500",
    bgColor: "bg-orange-500/10",
    format: (v: number) => `${v.toFixed(1)}%`,
    thresholdGood: 20,
    thresholdWarn: 10,
    lowerIsBetter: false,
  },
];

function valueColor(
  value: number,
  thresholdGood: number,
  thresholdWarn: number,
  lowerIsBetter: boolean,
): string {
  if (lowerIsBetter) {
    if (value <= thresholdGood) return "text-green-600 dark:text-green-400";
    if (value <= thresholdWarn) return "text-yellow-600 dark:text-yellow-400";
    return "text-destructive";
  }
  if (value >= thresholdGood) return "text-green-600 dark:text-green-400";
  if (value >= thresholdWarn) return "text-yellow-600 dark:text-yellow-400";
  return "text-destructive";
}

export function EngagementKPIs({ data }: Props) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {CARDS.map((card) => {
        const Icon = card.icon;
        const raw = data[card.key];
        const color = valueColor(
          raw,
          card.thresholdGood,
          card.thresholdWarn,
          card.lowerIsBetter,
        );
        return (
          <Card key={card.key}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className={AT.metricLabel}>
                    {card.label}
                  </p>
                  <p className={`${AT.valueMd} mt-1 ${color}`}>
                    {card.format(raw)}
                  </p>
                  <p className={`${AT.metricSublabel} mt-0.5 leading-tight`}>
                    {card.subtitle}
                  </p>
                </div>
                <div className={`rounded-full p-2 ml-2 shrink-0 ${card.bgColor}`}>
                  <Icon className={`h-4 w-4 ${card.iconColor}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
