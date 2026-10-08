import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users2 } from "lucide-react";
import { type SellerProfitability as SellerProfitabilityData } from "@/modules/analytics/hooks/useAnalyticsFinanceiro";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { AT } from "../analytics-tokens";

interface Props {
  data: SellerProfitabilityData[];
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(1)}k`;
  return `R$ ${value.toFixed(0)}`;
}

function roiColor(roi: number): string {
  if (roi >= 6) return "text-green-600 bg-green-50 dark:bg-green-950";
  if (roi >= 3) return "text-yellow-600 bg-yellow-50 dark:bg-yellow-950";
  return "text-destructive bg-red-50 dark:bg-red-950";
}

function roiLabel(roi: number): string {
  return `${roi.toFixed(1)}x`;
}

export function SellerProfitability({ data }: Props) {
  if (!data.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className={AT.chartTitle}>Rentabilidade por Vendedor</CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState message="Sem dados de vendedores no período." />
        </CardContent>
      </Card>
    );
  }

  const maxRevenue = Math.max(...data.map((d) => d.revenue));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <Users2 className="h-4 w-4" />
          Rentabilidade por Vendedor
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Vendedor</th>
                <th className="text-left py-2 pr-3 font-medium text-muted-foreground min-w-[100px]">Receita</th>
                <th className="text-right py-2 pr-3 font-medium text-muted-foreground">Comissão</th>
                <th className="text-right py-2 pr-3 font-medium text-muted-foreground">Margem</th>
                <th className="text-right py-2 font-medium text-muted-foreground">ROI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((seller) => (
                <tr key={seller.member_id} className="hover:bg-muted/30 transition-colors">
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">
                    {seller.member_name.split(" ").slice(0, 2).join(" ")}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="space-y-1">
                      <div className="text-right text-xs font-medium">{formatCurrency(seller.revenue)}</div>
                      <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 bg-primary rounded-full"
                          style={{
                            width: maxRevenue > 0 ? `${(seller.revenue / maxRevenue) * 100}%` : "0%",
                          }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right text-muted-foreground">
                    {formatCurrency(seller.commission_total)}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <span className={seller.margin >= 60 ? "text-green-600" : seller.margin >= 30 ? "text-yellow-600" : "text-destructive"}>
                      {seller.margin.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <span className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${roiColor(seller.roi)}`}>
                      {roiLabel(seller.roi)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-green-100 border border-green-600" />
            ROI &gt;6x
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-yellow-100 border border-yellow-600" />
            3–6x
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-red-100 border border-red-600" />
            &lt;3x
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
