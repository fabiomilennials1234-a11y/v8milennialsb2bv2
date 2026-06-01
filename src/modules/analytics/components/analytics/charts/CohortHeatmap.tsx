import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";
import { type CohortRow } from "@/modules/analytics/hooks/useAnalyticsOverview";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { AT } from "../analytics-tokens";

interface Props {
  cohortData: CohortRow[];
}

function pctToColor(pct: number): string {
  // Darker purple = higher retention
  if (pct >= 90) return "bg-purple-700 text-white";
  if (pct >= 75) return "bg-purple-600 text-white";
  if (pct >= 60) return "bg-purple-500 text-white";
  if (pct >= 45) return "bg-purple-400 text-white";
  if (pct >= 30) return "bg-purple-300 text-purple-900";
  if (pct >= 15) return "bg-purple-200 text-purple-800";
  if (pct > 0) return "bg-purple-100 text-purple-700";
  return "bg-muted text-muted-foreground";
}

const MAX_MONTHS = 6;

export function CohortHeatmap({ cohortData }: Props) {
  if (cohortData.length < 2) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
            <Users className="h-4 w-4" />
            Retenção por Coorte
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Necessário pelo menos 2 meses de dados de vendas."
            detail="A análise de coorte requer dados históricos suficientes para calcular retenção."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <Users className="h-4 w-4" />
          Retenção por Coorte
        </CardTitle>
        <p className={AT.chartSubtitle}>
          % de clientes retidos por mês após aquisição
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="text-left font-medium text-muted-foreground py-1 pr-3 whitespace-nowrap">
                  Coorte
                </th>
                {Array.from({ length: MAX_MONTHS }, (_, i) => (
                  <th
                    key={i}
                    className="text-center font-medium text-muted-foreground py-1 px-1 min-w-[52px]"
                  >
                    M{i}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohortData.map((row) => {
                const retentionMap = new Map(
                  row.retention.map((r) => [r.month_index, r.pct]),
                );
                return (
                  <tr key={row.cohort_month} className="border-t border-border/30">
                    <td className="py-1 pr-3 font-medium text-muted-foreground whitespace-nowrap">
                      {row.cohort_month}
                    </td>
                    {Array.from({ length: MAX_MONTHS }, (_, i) => {
                      const pct = retentionMap.get(i);
                      return (
                        <td key={i} className="py-1 px-1 text-center">
                          {pct !== undefined ? (
                            <span
                              className={`inline-block rounded px-1.5 py-0.5 font-semibold tabular-nums ${pctToColor(pct)}`}
                            >
                              {pct}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground/30">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Intensidade:</span>
          {[
            { label: "≥90%", cls: "bg-purple-700" },
            { label: "≥60%", cls: "bg-purple-500" },
            { label: "≥30%", cls: "bg-purple-300" },
            { label: "<30%", cls: "bg-purple-100" },
          ].map(({ label, cls }) => (
            <div key={label} className="flex items-center gap-1">
              <div className={`w-3 h-3 rounded ${cls}`} />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
