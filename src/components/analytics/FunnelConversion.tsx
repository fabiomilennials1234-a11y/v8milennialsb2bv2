import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GitBranch, ArrowDown, Loader2 } from "lucide-react";
import { useFunnelConversion } from "@/hooks/useAnalytics";
import { useAnalyticsFilters } from "@/hooks/useAnalyticsFilters";
import { AT } from "./analytics-tokens";
import { AnalyticsEmptyState } from "./AnalyticsEmptyState";

const PIPELINE_OPTIONS = [
  { value: "whatsapp", label: "Qualificação" },
  { value: "confirmacao", label: "Confirmação" },
  { value: "propostas", label: "Propostas" },
];

const FUNNEL_COLORS = [
  "bg-indigo-500",
  "bg-blue-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-purple-500",
];

export function FunnelConversion() {
  const [pipeline, setPipeline] = useState("whatsapp");
  const { startStr, endStr } = useAnalyticsFilters();
  const { data: stages, isLoading } = useFunnelConversion(pipeline, startStr, endStr);

  const maxValue = stages && stages.length > 0 ? Math.max(...stages.map((s) => s.total_entered)) : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
            <GitBranch className="h-4 w-4" />
            Conversão por Etapa
          </CardTitle>
          <Select value={pipeline} onValueChange={setPipeline}>
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PIPELINE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className={AT.chartSubtitle}>
          Taxa de conversão entre etapas do funil
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : !stages || stages.length === 0 ? (
          <AnalyticsEmptyState
            message="Sem dados de funil para este pipeline"
            detail="Movimente leads entre etapas para gerar dados de conversão."
          />
        ) : (
          <div className="space-y-1">
            {stages.map((stage, i) => {
              const widthPct = maxValue > 0 ? (stage.total_entered / maxValue) * 100 : 0;
              const colorClass = FUNNEL_COLORS[i % FUNNEL_COLORS.length];
              return (
                <div key={stage.stage_id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium truncate max-w-[50%]">
                      {stage.stage_name}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className={AT.valueSm}>{stage.total_entered}</span>
                      {i > 0 && (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          stage.conversion_rate >= 50
                            ? "bg-emerald-500/10 text-emerald-500"
                            : stage.conversion_rate >= 25
                            ? "bg-amber-500/10 text-amber-500"
                            : "bg-destructive/10 text-destructive"
                        }`}>
                          {stage.conversion_rate.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="h-6 bg-muted rounded-md overflow-hidden">
                    <div
                      className={`h-full ${colorClass} rounded-md transition-all duration-700 ease-out`}
                      style={{ width: `${Math.max(widthPct, 2)}%` }}
                    />
                  </div>
                  {i < stages.length - 1 && (
                    <div className="flex justify-center py-0.5">
                      <ArrowDown className="h-3 w-3 text-muted-foreground/40" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
