import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Scale } from "lucide-react";
import { type LossReason } from "@/modules/analytics/hooks/useAnalyticsComercial";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { AT } from "../analytics-tokens";

interface Props {
  lossReasons: LossReason[];
  totalLost: number;
  totalLossReasons: number;
}

const REASON_LABELS: Record<string, string> = {
  sem_budget: "Sem budget",
  concorrencia: "Concorrência",
  timing: "Timing errado",
  follow_up_fraco: "Follow-up fraco",
  produto_nao_adequado: "Produto não adequado",
  outro: "Outro",
};

export function WinLossAnalysis({ lossReasons, totalLost, totalLossReasons }: Props) {
  if (totalLossReasons < 20) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
            <Scale className="h-4 w-4" />
            Análise Win/Loss
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Dados insuficientes para análise Win/Loss"
            detail={`${totalLossReasons} de 20 motivos de perda registrados. Preencha o motivo ao mover deals para "Perdido".`}
          />
        </CardContent>
      </Card>
    );
  }

  const totalReasons = lossReasons.reduce((s, r) => s + r.cnt, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <Scale className="h-4 w-4" />
          Motivos de Perda
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {lossReasons.map((r) => {
          const pctVal = totalReasons > 0 ? Math.round((r.cnt / totalReasons) * 100) : 0;
          return (
            <div key={r.loss_reason}>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-muted-foreground">
                  {REASON_LABELS[r.loss_reason] ?? r.loss_reason}
                </span>
                <span className="text-xs font-medium">{pctVal}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-destructive rounded-full transition-all"
                  style={{ width: `${pctVal}%` }}
                />
              </div>
            </div>
          );
        })}
        <div className="text-xs text-muted-foreground pt-2 border-t border-border">
          {totalLost} deals perdidos no período ({totalLossReasons} com motivo registrado)
        </div>
      </CardContent>
    </Card>
  );
}
