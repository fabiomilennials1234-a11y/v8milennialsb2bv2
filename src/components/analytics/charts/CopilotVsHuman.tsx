import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot } from "lucide-react";
import { type CopilotVsHuman as CopilotVsHumanData } from "@/hooks/useAnalyticsEngajamento";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { formatResponseTime } from "./EngagementKPIs";
import { AT } from "../analytics-tokens";

interface Props {
  data: CopilotVsHumanData;
}

interface MetricRowDef {
  label: string;
  copilotVal: (d: NonNullable<CopilotVsHumanData["copilot"]>) => string;
  humanVal:   (d: NonNullable<CopilotVsHumanData["human"]>)   => string;
  // raw numbers for comparison
  copilotNum: (d: NonNullable<CopilotVsHumanData["copilot"]>) => number;
  humanNum:   (d: NonNullable<CopilotVsHumanData["human"]>)   => number;
  lowerIsBetter: boolean;
}

const METRICS: MetricRowDef[] = [
  {
    label: "Tempo 1ª Resposta",
    copilotVal: (d) => formatResponseTime(d.avg_response),
    humanVal:   (d) => formatResponseTime(d.avg_response),
    copilotNum: (d) => d.avg_response,
    humanNum:   (d) => d.avg_response,
    lowerIsBetter: true,
  },
  {
    label: "Taxa de Resposta",
    copilotVal: (d) => `${d.response_rate.toFixed(1)}%`,
    humanVal:   (d) => `${d.response_rate.toFixed(1)}%`,
    copilotNum: (d) => d.response_rate,
    humanNum:   (d) => d.response_rate,
    lowerIsBetter: false,
  },
  {
    label: "Taxa de Qualificação",
    copilotVal: (d) => `${d.qualification_rate.toFixed(1)}%`,
    humanVal:   (d) => `${d.qualification_rate.toFixed(1)}%`,
    copilotNum: (d) => d.qualification_rate,
    humanNum:   (d) => d.qualification_rate,
    lowerIsBetter: false,
  },
  {
    label: "Cobertura",
    copilotVal: (d) => `${d.coverage_pct.toFixed(1)}%`,
    humanVal:   (d) => `${d.coverage_pct.toFixed(1)}%`,
    copilotNum: (d) => d.coverage_pct,
    humanNum:   (d) => d.coverage_pct,
    lowerIsBetter: false,
  },
];

function winnerClass(meWin: boolean, other: boolean): string {
  if (meWin && !other) return "bg-green-500/10 text-green-700 dark:text-green-400 font-semibold";
  if (!meWin && other) return "bg-destructive/10 text-destructive";
  return "text-foreground";
}

export function CopilotVsHuman({ data }: Props) {
  const hasCopilot =
    data.copilot !== null &&
    (data.copilot.avg_response > 0 ||
      data.copilot.response_rate > 0 ||
      data.copilot.coverage_pct > 0);

  if (!hasCopilot) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
            <Bot className="h-4 w-4" />
            Copilot vs. Humano
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Sem dados de Copilot detectados"
            detail="As mensagens processadas pelo agente de IA aparecerão aqui quando disponíveis."
          />
        </CardContent>
      </Card>
    );
  }

  const copilot = data.copilot!;
  const human   = data.human ?? {
    avg_response: 0,
    response_rate: 0,
    qualification_rate: 0,
    coverage_pct: 0,
    cost_per_lead: 0,
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <Bot className="h-4 w-4" />
          Copilot vs. Humano
        </CardTitle>
        <p className={AT.chartSubtitle}>
          Comparação de eficiência: agente IA vs. equipe humana
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left font-medium text-muted-foreground py-2 pr-3">
                  Métrica
                </th>
                <th className="text-center font-medium text-muted-foreground py-2 px-3">
                  🤖 Copilot
                </th>
                <th className="text-center font-medium text-muted-foreground py-2 pl-3">
                  👤 Humano
                </th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((metric) => {
                const cn = metric.copilotNum(copilot);
                const hn = metric.humanNum(human);

                const copilotBetter = metric.lowerIsBetter
                  ? cn > 0 && (cn < hn || hn === 0)
                  : cn > hn;
                const humanBetter = metric.lowerIsBetter
                  ? hn > 0 && (hn < cn || cn === 0)
                  : hn > cn;

                return (
                  <tr key={metric.label} className="border-b border-border/30">
                    <td className="py-2 pr-3 text-muted-foreground">
                      {metric.label}
                    </td>
                    <td className={`py-2 px-3 text-center rounded-l`}>
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] tabular-nums ${winnerClass(copilotBetter, humanBetter)}`}
                      >
                        {metric.copilotVal(copilot)}
                      </span>
                    </td>
                    <td className="py-2 pl-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] tabular-nums ${winnerClass(humanBetter, copilotBetter)}`}
                      >
                        {metric.humanVal(human)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-4 mt-3 pt-2 border-t border-border">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-green-500/20 border border-green-500/40" />
            <span className="text-[10px] text-muted-foreground">Melhor</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-destructive/10 border border-destructive/30" />
            <span className="text-[10px] text-muted-foreground">Pior</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
