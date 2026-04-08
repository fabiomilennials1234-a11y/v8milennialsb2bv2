import { AlertTriangle, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type StageAnalysis as StageAnalysisItem } from "@/hooks/useAnalyticsPipesFunis";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { AT } from "../analytics-tokens";

interface Props {
  stages: StageAnalysisItem[];
}

// Find worst transition (lowest conversion_pct)
function findWorstIndex(stages: StageAnalysisItem[]): number {
  if (stages.length === 0) return -1;
  let minPct = Infinity;
  let worstIdx = 0;
  stages.forEach((s, i) => {
    if (s.conversion_pct < minPct) {
      minPct = s.conversion_pct;
      worstIdx = i;
    }
  });
  return worstIdx;
}

function getPctColor(pct: number): string {
  if (pct >= 60) return "text-green-600 dark:text-green-400";
  if (pct >= 35) return "text-orange-500";
  return "text-destructive";
}

export function StageAnalysis({ stages }: Props) {
  if (!stages || stages.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className={AT.chartTitle}>Análise de Transições</CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Sem dados de transição para o período"
            detail="É necessário ter leads que passaram pelo funil para ver esta análise."
          />
        </CardContent>
      </Card>
    );
  }

  const worstIdx = findWorstIndex(stages);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={AT.chartTitle}>Análise de Transições</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {stages.map((stage, i) => {
          const isWorst = i === worstIdx;
          const prevStage = i > 0 ? stages[i - 1] : null;
          const delta =
            prevStage != null ? stage.conversion_pct - prevStage.conversion_pct : null;

          return (
            <div
              key={stage.transition_name}
              className={`rounded-lg border p-3 transition-colors ${
                isWorst
                  ? "border-l-4 border-l-destructive border-destructive/30 bg-destructive/5"
                  : "border-border bg-card"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {isWorst && (
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="text-xs font-medium">{stage.transition_name}</div>
                    {stage.primary_loss_status && (
                      <div className="text-xs text-muted-foreground">
                        Principal perda: <span className="font-medium">{stage.primary_loss_status}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end shrink-0">
                  <span className={`text-lg font-bold ${getPctColor(stage.conversion_pct)}`}>
                    {stage.conversion_pct}%
                  </span>
                  {delta !== null && (
                    <span
                      className={`text-xs flex items-center gap-0.5 ${
                        delta >= 0 ? "text-green-600" : "text-destructive"
                      }`}
                    >
                      {delta >= 0 ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : (
                        <TrendingDown className="h-3 w-3" />
                      )}
                      {Math.abs(delta).toFixed(1)}pp
                    </span>
                  )}
                </div>
              </div>

              {stage.lost_count > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  {stage.lost_count} leads perdidos nesta etapa
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
