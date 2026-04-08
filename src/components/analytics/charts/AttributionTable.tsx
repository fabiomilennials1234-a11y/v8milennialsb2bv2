import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin } from "lucide-react";
import { type AttributionRow } from "@/hooks/useAnalyticsOverview";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { AT } from "../analytics-tokens";

interface Props {
  attribution: AttributionRow[];
}

const ORIGIN_LABELS: Record<string, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  whatsapp: "WhatsApp",
  site: "Site",
  remarketing: "Remarketing",
  cal: "Calendário",
  outro: "Outro",
};

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(1)}K`;
  return `R$ ${value.toFixed(0)}`;
}

export function AttributionTable({ attribution }: Props) {
  if (attribution.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
            <MapPin className="h-4 w-4" />
            Atribuição por Origem
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Sem dados de atribuição no período."
            detail="Selecione um período com leads registrados."
          />
        </CardContent>
      </Card>
    );
  }

  const maxConvRate = Math.max(...attribution.map((r) => r.conversion_rate), 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <MapPin className="h-4 w-4" />
          Atribuição por Origem
        </CardTitle>
        <p className={AT.chartSubtitle}>Ordenado por receita</p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left font-medium text-muted-foreground py-2 pr-3">
                  Origem
                </th>
                <th className="text-right font-medium text-muted-foreground py-2 px-2">
                  Leads
                </th>
                <th className="text-right font-medium text-muted-foreground py-2 px-2">
                  Vendas
                </th>
                <th className="text-right font-medium text-muted-foreground py-2 px-2">
                  Receita
                </th>
                <th className="text-left font-medium text-muted-foreground py-2 px-2 min-w-[100px]">
                  Conversão
                </th>
                <th className="text-right font-medium text-muted-foreground py-2 pl-2">
                  CAC Est.
                </th>
              </tr>
            </thead>
            <tbody>
              {attribution.map((row) => (
                <tr
                  key={row.origin}
                  className="border-b border-border/40 hover:bg-muted/30 transition-colors"
                >
                  <td className="py-2 pr-3 font-medium">
                    {ORIGIN_LABELS[row.origin] ?? row.origin}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">
                    {row.lead_count.toLocaleString("pt-BR")}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums font-medium">
                    {row.sales_count.toLocaleString("pt-BR")}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums font-semibold">
                    {formatCurrency(row.revenue)}
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{
                            width: `${Math.min((row.conversion_rate / maxConvRate) * 100, 100)}%`,
                          }}
                        />
                      </div>
                      <span className="tabular-nums w-8 text-right">
                        {row.conversion_rate.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="py-2 pl-2 text-right tabular-nums text-muted-foreground">
                    {row.cac_estimate > 0 ? row.cac_estimate.toFixed(1) + "x" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
