import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type FunnelStage } from "@/hooks/useAnalyticsPipesFunis";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";

interface Props {
  stages: FunnelStage[];
}

const STAGE_COLORS = [
  "#6366f1",
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
];

// Find the worst conversion step (biggest drop between consecutive stages)
function findBottleneckIndex(stages: FunnelStage[]): number {
  let maxDrop = 0;
  let bottleneck = -1;
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1].count;
    const curr = stages[i].count;
    const drop = prev > 0 ? (prev - curr) / prev : 0;
    if (drop > maxDrop) {
      maxDrop = drop;
      bottleneck = i;
    }
  }
  return bottleneck;
}

export function FullFunnel({ stages }: Props) {
  if (!stages || stages.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Funil Completo</CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Sem dados de funil para o período selecionado"
            detail="Selecione um período com leads para visualizar o funil."
          />
        </CardContent>
      </Card>
    );
  }

  const maxCount = stages[0]?.count ?? 1;
  const bottleneckIndex = findBottleneckIndex(stages);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Funil Completo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {stages.map((stage, i) => {
          const widthPct = maxCount > 0 ? Math.round((stage.count / maxCount) * 100) : 0;
          const isBottleneck = i === bottleneckIndex;
          const color = STAGE_COLORS[i % STAGE_COLORS.length];
          const prevStage = i > 0 ? stages[i - 1] : null;
          const convPct =
            prevStage && prevStage.count > 0
              ? Math.round((stage.count / prevStage.count) * 100)
              : null;

          return (
            <div key={stage.stage_name}>
              {/* Conversion indicator between stages */}
              {i > 0 && (
                <div className={`flex items-center gap-2 py-0.5 px-2 text-xs ${isBottleneck ? "text-destructive" : "text-muted-foreground"}`}>
                  {isBottleneck && <AlertTriangle className="h-3 w-3 shrink-0" />}
                  <span>
                    Conv: {convPct ?? 0}%
                    {" · "}
                    {prevStage && prevStage.count - stage.count > 0
                      ? `${prevStage.count - stage.count} saíram`
                      : ""}
                    {stage.avg_days > 0
                      ? ` · avg ${stage.avg_days}d`
                      : ""}
                  </span>
                </div>
              )}

              {/* Bar */}
              <div className="flex items-center gap-3">
                {/* Funnel bar — centered, tapers */}
                <div className="flex-1 flex justify-center">
                  <div
                    className="rounded transition-all duration-300 flex items-center justify-center"
                    style={{
                      width: `${Math.max(widthPct, 10)}%`,
                      backgroundColor: isBottleneck ? "#ef4444" : color,
                      minHeight: "36px",
                      opacity: isBottleneck ? 1 : 0.85,
                    }}
                  >
                    <span className="text-white text-xs font-semibold px-2 py-1 text-center leading-tight">
                      {stage.count}
                      {" · "}
                      {stage.cumulative_pct}%
                    </span>
                  </div>
                </div>
                {/* Stage label */}
                <div className="w-28 shrink-0">
                  <span
                    className={`text-xs font-medium ${isBottleneck ? "text-destructive" : "text-foreground"}`}
                  >
                    {stage.stage_name}
                  </span>
                  {stage.lost_count > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {stage.lost_count} perdidos
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
