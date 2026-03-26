import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import { type MemberStat } from "@/hooks/useAnalyticsComercial";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";

interface Props {
  members: MemberStat[];
}

export function SellerTrend({ members }: Props) {
  if (members.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Tendência Individual</CardTitle></CardHeader>
        <CardContent>
          <AnalyticsEmptyState message="Sem dados de vendedores." />
        </CardContent>
      </Card>
    );
  }

  const avgRevenue = members.reduce((s, m) => s + m.revenue, 0) / members.length;

  const sorted = [...members]
    .map((m) => ({
      ...m,
      deviation: avgRevenue > 0 ? ((m.revenue - avgRevenue) / avgRevenue) * 100 : 0,
    }))
    .sort((a, b) => b.deviation - a.deviation);

  const maxAbs = Math.max(...sorted.map((m) => Math.abs(m.deviation)), 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Tendência Individual — vs Média do Time
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {sorted.map((m) => {
          const pctVal = m.deviation;
          const isPositive = pctVal >= 0;
          const barWidth = Math.min(Math.abs(pctVal) / maxAbs * 50, 50);

          let color = "bg-success";
          let textColor = "text-success";
          if (pctVal < -10) { color = "bg-destructive"; textColor = "text-destructive"; }
          else if (pctVal < 0) { color = "bg-orange-500"; textColor = "text-orange-500"; }

          return (
            <div key={m.member_id} className="flex items-center gap-3">
              <span className="text-xs w-20 truncate">{m.member_name}</span>
              <div className="flex-1 relative h-5">
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border" />
                <div
                  className={`absolute top-0.5 h-4 rounded ${color}`}
                  style={{
                    [isPositive ? "left" : "right"]: "50%",
                    width: `${barWidth}%`,
                  }}
                />
              </div>
              <span className={`text-xs font-semibold w-14 text-right tabular-nums ${textColor}`}>
                {isPositive ? "+" : ""}{Math.round(pctVal)}%
              </span>
            </div>
          );
        })}
        <div className="text-[10px] text-muted-foreground text-center pt-1">
          Linha central = média do time. Barras mostram desvio individual.
        </div>
      </CardContent>
    </Card>
  );
}
