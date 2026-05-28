import { memo, useState } from "react";
import { motion } from "framer-motion";
import { useRankingData } from "@/modules/analytics/hooks/useDashboardMetrics";
import { useCurrentTeamMember } from "@/modules/identity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, Crown, Medal, Award } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props { month: number; year: number }

const positionIcons = [Crown, Medal, Award];
const positionColors = ["text-yellow-500", "text-slate-400", "text-amber-600"];

function RankingTableBase({ month, year }: Props) {
  const { data: rankingData, isLoading } = useRankingData(month, year);
  const { data: currentTeamMember } = useCurrentTeamMember();
  const [tab, setTab] = useState<"closers" | "sdrs">("closers");

  const fmt = (v: number) => v >= 1000 ? `R$ ${(v / 1000).toFixed(0)}K` : `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
  const barColor = (pct: number) => pct >= 80 ? "bg-success" : pct >= 40 ? "bg-primary" : "bg-destructive";

  if (isLoading) return <Card><CardContent className="p-6"><Skeleton className="h-64" /></CardContent></Card>;

  const closers = rankingData?.salesRanking || [];
  const sdrs = rankingData?.meetingsRanking || [];
  const items = tab === "closers" ? closers : sdrs;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" />
            Ranking de Vendas
          </CardTitle>
          <Tabs value={tab} onValueChange={(v) => setTab(v as "closers" | "sdrs")}>
            <TabsList className="h-8">
              <TabsTrigger value="closers" className="text-xs px-3 h-7">Vendas</TabsTrigger>
              <TabsTrigger value="sdrs" className="text-xs px-3 h-7">Reuniões</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        {!items.length ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhum dado de ranking disponível.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 w-10 font-medium text-muted-foreground">#</th>
                  <th className="pb-2 font-medium text-muted-foreground">Nome</th>
                  <th className="pb-2 font-medium text-muted-foreground">{tab === "closers" ? "Vendas (R$)" : "Reuniões"}</th>
                  <th className="pb-2 font-medium text-muted-foreground">{tab === "closers" ? "Nº Vendas" : "Meta"}</th>
                  {tab === "closers" && <th className="pb-2 font-medium text-muted-foreground">Ticket Médio</th>}
                  <th className="pb-2 font-medium text-muted-foreground">Meta</th>
                  <th className="pb-2 font-medium text-muted-foreground min-w-[120px]">% Atingido</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => {
                  const isMe = item.id === currentTeamMember?.id;
                  const Icon = i < 3 ? positionIcons[i] : null;
                  const ticketMedio = tab === "closers" && item.conversions > 0
                    ? item.value / item.conversions : 0;

                  return (
                    <motion.tr
                      key={item.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className={cn("border-b border-border/30", isMe && "bg-primary/5 border-primary/20")}
                    >
                      <td className="py-2.5">
                        {Icon ? <Icon className={cn("w-4 h-4", positionColors[i])} /> : <span className="text-muted-foreground">{item.position}</span>}
                      </td>
                      <td className="py-2.5 font-medium">{item.name}{isMe && <span className="text-xs text-primary ml-1">(você)</span>}</td>
                      <td className="py-2.5">{tab === "closers" ? fmt(item.value) : (item as any).meetings ?? 0}</td>
                      <td className="py-2.5">{tab === "closers" ? item.conversions : item.goal}</td>
                      {tab === "closers" && <td className="py-2.5">{fmt(ticketMedio)}</td>}
                      <td className="py-2.5">{tab === "closers" ? fmt(item.goal) : item.goal}</td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.min(item.goalProgress, 100)}%` }}
                              transition={{ duration: 0.6, delay: i * 0.05 }}
                              className={`h-full rounded-full ${barColor(item.goalProgress)}`}
                            />
                          </div>
                          <span className={`text-xs font-bold min-w-[36px] text-right ${barColor(item.goalProgress).replace("bg-", "text-")}`}>
                            {item.goalProgress}%
                          </span>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const RankingTable = memo(RankingTableBase);
