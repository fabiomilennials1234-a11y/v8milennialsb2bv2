import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe } from "lucide-react";
import { type ResponseByOriginRow } from "@/hooks/useAnalyticsEngajamento";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { formatResponseTime } from "./EngagementKPIs";
import { AT } from "../analytics-tokens";

interface Props {
  data: ResponseByOriginRow[];
}

function RateBar({
  value,
  color,
}: {
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden min-w-[60px]">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
      <span className="text-xs tabular-nums w-10 text-right">{value.toFixed(1)}%</span>
    </div>
  );
}

const ORIGIN_LABELS: Record<string, string> = {
  indicacao:        "Indicação",
  instagram:        "Instagram",
  facebook:         "Facebook",
  google:           "Google",
  site:             "Site",
  linkedin:         "LinkedIn",
  youtube:          "YouTube",
  tiktok:           "TikTok",
  whatsapp:         "WhatsApp",
  email:            "E-mail",
  evento:           "Evento",
  outbound:         "Outbound",
  outro:            "Outro",
};

export function ResponseByOrigin({ data }: Props) {
  if (!data.length) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
            <Globe className="h-4 w-4" />
            Engajamento por Origem
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Sem dados de origem no período"
            detail="Necessário pelo menos 3 leads por origem para exibir."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <Globe className="h-4 w-4" />
          Engajamento por Origem
        </CardTitle>
        <p className={AT.chartSubtitle}>
          Taxa de resposta e fechamento por canal de aquisição
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left font-medium text-muted-foreground py-2 pr-3">
                  Origem
                </th>
                <th className="text-left font-medium text-muted-foreground py-2 pr-3 min-w-[130px]">
                  Taxa Resposta
                </th>
                <th className="text-left font-medium text-muted-foreground py-2 pr-3 min-w-[130px]">
                  Taxa Fechamento
                </th>
                <th className="text-right font-medium text-muted-foreground py-2 pr-3 whitespace-nowrap">
                  T. Resp.
                </th>
                <th className="text-right font-medium text-muted-foreground py-2 pr-3 whitespace-nowrap">
                  Leads
                </th>
                <th className="text-right font-medium text-muted-foreground py-2 whitespace-nowrap">
                  Vendas
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr
                  key={row.origin}
                  className="border-b border-border/30 hover:bg-muted/20 transition-colors"
                >
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">
                    {ORIGIN_LABELS[row.origin] ?? row.origin}
                  </td>
                  <td className="py-2 pr-3">
                    <RateBar value={row.response_rate} color="bg-blue-500" />
                  </td>
                  <td className="py-2 pr-3">
                    <RateBar value={row.close_rate} color="bg-green-500" />
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                    {formatResponseTime(row.avg_response_seconds)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.lead_count}</td>
                  <td className="py-2 text-right tabular-nums">{row.sales_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
