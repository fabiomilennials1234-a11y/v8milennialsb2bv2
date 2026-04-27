import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin } from "lucide-react";
import { type CACByOrigin } from "@/hooks/useAnalyticsFinanceiro";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { AT } from "../analytics-tokens";

interface Props {
  data: CACByOrigin[];
}

function cacColor(cac: number, minCac: number, maxCac: number): string {
  if (maxCac === minCac) return "text-primary";
  const normalized = (cac - minCac) / (maxCac - minCac);
  if (normalized <= 0.33) return "text-green-600";
  if (normalized <= 0.66) return "text-yellow-600";
  return "text-destructive";
}

function cacBg(cac: number, minCac: number, maxCac: number): string {
  if (maxCac === minCac) return "bg-muted";
  const normalized = (cac - minCac) / (maxCac - minCac);
  if (normalized <= 0.33) return "bg-green-50 dark:bg-green-950/20";
  if (normalized <= 0.66) return "bg-yellow-50 dark:bg-yellow-950/20";
  return "bg-red-50 dark:bg-red-950/20";
}

export function CACByOriginTrend({ data }: Props) {
  if (!data.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className={AT.chartTitle}>CAC por Origem</CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState message="Sem dados de origem no período." />
        </CardContent>
      </Card>
    );
  }

  const validCacs = data.filter((d) => d.cac_estimate > 0).map((d) => d.cac_estimate);
  const minCac = validCacs.length ? Math.min(...validCacs) : 0;
  const maxCac = validCacs.length ? Math.max(...validCacs) : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <MapPin className="h-4 w-4" />
          CAC por Origem
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Origem</th>
                <th className="text-right py-2 pr-3 font-medium text-muted-foreground">Leads</th>
                <th className="text-right py-2 pr-3 font-medium text-muted-foreground">Vendas</th>
                <th className="text-right py-2 font-medium text-muted-foreground">CAC (leads/venda)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((row) => (
                <tr key={row.origin} className="hover:bg-muted/30 transition-colors">
                  <td className="py-2 pr-3 font-medium capitalize">{row.origin || "—"}</td>
                  <td className="py-2 pr-3 text-right text-muted-foreground">{row.lead_count}</td>
                  <td className="py-2 pr-3 text-right text-muted-foreground">{row.sales_count}</td>
                  <td className="py-2 text-right">
                    {row.cac_estimate > 0 ? (
                      <span
                        className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${cacColor(row.cac_estimate, minCac, maxCac)} ${cacBg(row.cac_estimate, minCac, maxCac)}`}
                      >
                        {row.cac_estimate.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          CAC = leads gerados ÷ vendas fechadas por origem (proxy simplificado).
        </p>
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-green-100 border border-green-600" />
            Baixo
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-yellow-100 border border-yellow-600" />
            Médio
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-red-100 border border-red-600" />
            Alto
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
