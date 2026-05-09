import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Loader2, Trophy, Phone, Mail, Calendar } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useAnalyticsComercial, type MemberStat } from "@/hooks/useAnalyticsComercial";
import { AT } from "./analytics-tokens";
import { AnalyticsEmptyState } from "./AnalyticsEmptyState";

const MEDAL_COLORS = ["text-amber-400", "text-zinc-400", "text-orange-700"];

export function ActivityMetrics() {
  const { data: comercialData, isLoading } = useAnalyticsComercial();

  const leaderboard = useMemo(() => {
    if (!comercialData?.member_stats) return [];
    return [...comercialData.member_stats]
      .map((m: MemberStat) => ({
        name: m.member_name,
        leads: m.leads_handled,
        meetings: m.meetings_attended,
        proposals: m.proposals_total,
        won: m.deals_won,
        revenue: m.revenue / 100,
        score: m.deals_won * 3 + m.meetings_attended * 2 + m.proposals_total + m.leads_handled * 0.5,
      }))
      .sort((a, b) => b.score - a.score);
  }, [comercialData]);

  const chartData = useMemo(() => {
    return leaderboard.slice(0, 8).map((m) => ({
      name: m.name.split(" ")[0], // First name only for chart
      Leads: m.leads,
      "Reuniões": m.meetings,
      Propostas: m.proposals,
      Vendas: m.won,
    }));
  }, [leaderboard]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <Activity className="h-4 w-4" />
          Atividades por Vendedor
        </CardTitle>
        <p className={AT.chartSubtitle}>
          Volume de atividades e leaderboard do time
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : leaderboard.length === 0 ? (
          <AnalyticsEmptyState
            message="Sem dados de atividade"
            detail="Atividades aparecem quando o time movimenta leads, agenda reuniões e envia propostas."
          />
        ) : (
          <div className="space-y-5">
            {/* Leaderboard */}
            <div className="space-y-1.5">
              {leaderboard.slice(0, 5).map((member, i) => (
                <div
                  key={member.name}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                    i === 0 ? "bg-primary/5 border border-primary/20" : "bg-muted/30"
                  }`}
                >
                  <div className="flex items-center justify-center w-6 h-6 flex-shrink-0">
                    {i < 3 ? (
                      <Trophy className={`h-4 w-4 ${MEDAL_COLORS[i]}`} />
                    ) : (
                      <span className="text-xs font-bold text-muted-foreground">{i + 1}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium truncate block">{member.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
                    <div className="flex items-center gap-1" title="Leads">
                      <Phone className="h-3 w-3" />
                      <span className="tabular-nums">{member.leads}</span>
                    </div>
                    <div className="flex items-center gap-1" title="Reuniões">
                      <Calendar className="h-3 w-3" />
                      <span className="tabular-nums">{member.meetings}</span>
                    </div>
                    <div className="flex items-center gap-1" title="Propostas">
                      <Mail className="h-3 w-3" />
                      <span className="tabular-nums">{member.proposals}</span>
                    </div>
                    <span className={`font-bold ${i === 0 ? "text-primary" : "text-foreground"} tabular-nums`}>
                      {member.won}v
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Stacked Bar Chart */}
            {chartData.length > 0 && (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ left: 0, right: 8 }}>
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 10 }}
                  />
                  <Bar dataKey="Leads" stackId="a" fill="#6366f1" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Reuniões" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Propostas" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Vendas" stackId="a" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
