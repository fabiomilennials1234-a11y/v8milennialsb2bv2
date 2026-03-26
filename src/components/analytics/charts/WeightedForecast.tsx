import { DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type WeightedForecastStage } from "@/hooks/useAnalyticsPipesFunis";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";

interface Props {
  stages: WeightedForecastStage[];
  forecastTotal: number;
}

const STAGE_LABELS: Record<string, string> = {
  marcar_compromisso: "Marcar Compromisso",
  reativar: "Reativar",
  compromisso_marcado: "Compromisso Marcado",
  esfriou: "Esfriou",
  futuro: "Futuro",
};

function fmt(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(0)}K`;
  return `R$ ${value.toFixed(0)}`;
}

function pctBadgeColor(prob: number): string {
  if (prob >= 0.6) return "bg-green-500/15 text-green-700 dark:text-green-400";
  if (prob >= 0.3) return "bg-orange-500/15 text-orange-600";
  return "bg-red-500/15 text-red-600";
}

export function WeightedForecast({ stages, forecastTotal }: Props) {
  if (!stages || stages.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Previsão Ponderada
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Sem propostas ativas com valor no período"
            detail="Adicione valores às propostas para ver a previsão ponderada."
          />
        </CardContent>
      </Card>
    );
  }

  const totalValue = stages.reduce((s, st) => s + st.total_value, 0);
  const totalDeals = stages.reduce((s, st) => s + st.deal_count, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <DollarSign className="h-4 w-4" />
          Previsão Ponderada
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-2 font-medium">Etapa</th>
                <th className="text-center py-2 font-medium">Deals</th>
                <th className="text-right py-2 font-medium">Valor Total</th>
                <th className="text-center py-2 font-medium">Prob. Vitória</th>
                <th className="text-right py-2 font-medium">Valor Ponderado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stages.map((stage) => (
                <tr key={stage.stage_name} className="hover:bg-muted/40 transition-colors">
                  <td className="py-2 font-medium">
                    {STAGE_LABELS[stage.stage_name] ?? stage.stage_name}
                  </td>
                  <td className="py-2 text-center text-muted-foreground">
                    {stage.deal_count}
                  </td>
                  <td className="py-2 text-right">{fmt(stage.total_value)}</td>
                  <td className="py-2 text-center">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 font-semibold text-xs ${pctBadgeColor(stage.win_probability)}`}
                    >
                      {Math.round(stage.win_probability * 100)}%
                    </span>
                  </td>
                  <td className="py-2 text-right font-semibold text-primary">
                    {fmt(stage.weighted_value)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-2">Total</td>
                <td className="py-2 text-center text-muted-foreground">{totalDeals}</td>
                <td className="py-2 text-right">{fmt(totalValue)}</td>
                <td className="py-2" />
                <td className="py-2 text-right text-primary">{fmt(forecastTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
