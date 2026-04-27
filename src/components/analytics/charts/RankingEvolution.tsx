import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Medal } from "lucide-react";
import { type MemberStat } from "@/hooks/useAnalyticsComercial";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { AT } from "../analytics-tokens";

interface Props {
  members: MemberStat[];
}

const POSITION_COLORS: Record<number, string> = {
  1: "bg-chart-1 text-white",
  2: "bg-chart-2 text-white",
  3: "bg-chart-3 text-white",
  4: "bg-orange-500 text-white",
  5: "bg-destructive text-white",
};

export function RankingEvolution({ members }: Props) {
  if (members.length < 2) {
    return (
      <Card>
        <CardHeader><CardTitle className={AT.chartTitle}>Ranking</CardTitle></CardHeader>
        <CardContent>
          <AnalyticsEmptyState message="Necessário pelo menos 2 vendedores com dados." />
        </CardContent>
      </Card>
    );
  }

  const ranked = [...members].sort((a, b) => b.revenue - a.revenue);

  return (
    <Card>
      <CardHeader className="pb-2">
        {/* Note: spec calls for 6-month historical ranking. Phase 1 shows current ranking
            only since historical monthly snapshots require additional data aggregation. */}
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <Medal className="h-4 w-4" />
          Ranking Atual — Por Receita
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {ranked.map((m, idx) => {
            const pos = idx + 1;
            const colorClass = POSITION_COLORS[pos] ?? "bg-muted text-muted-foreground";
            return (
              <div key={m.member_id} className="flex items-center gap-3">
                <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${colorClass}`}>
                  {pos}°
                </span>
                <span className="flex-1 text-sm">{m.member_name}</span>
                <span className="text-sm font-semibold tabular-nums">
                  R$ {(m.revenue / 1000).toFixed(0)}K
                </span>
                <span className="text-xs text-muted-foreground tabular-nums w-16 text-right">
                  {m.deals_won} vendas
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
