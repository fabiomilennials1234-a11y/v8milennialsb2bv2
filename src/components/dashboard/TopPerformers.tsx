import { motion } from "framer-motion";
import { Trophy, Crown, Medal, Award, TrendingUp, Flame } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useRankingData } from "@/hooks/useDashboardMetrics";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

const positionIcons = [Crown, Medal, Award];
const positionColors = ["text-yellow-500", "text-slate-400", "text-amber-600"];
const positionBg = [
  "bg-gradient-to-br from-yellow-400/20 to-amber-500/20",
  "bg-gradient-to-br from-slate-300/20 to-slate-400/20",
  "bg-gradient-to-br from-amber-600/20 to-amber-700/20",
];

export function TopPerformers() {
  const now = new Date();
  const navigate = useNavigate();
  const { data: rankingData, isLoading } = useRankingData(now.getMonth() + 1, now.getFullYear());

  const topClosers = rankingData?.closerRanking?.slice(0, 3) || [];
  const topSDRs = rankingData?.sdrRanking?.slice(0, 3) || [];

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" />
            Top Performers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const formatCurrency = (value: number) => {
    if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}K`;
    return `R$ ${value.toLocaleString("pt-BR")}`;
  };

  return (
    <Card className="cursor-pointer hover:border-primary/30 transition-colors" onClick={() => navigate("/ranking")}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" />
            Top Performers
          </div>
          <Badge variant="outline" className="text-xs">Ver ranking</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Top Closers */}
        <div>
          <p className="text-xs text-muted-foreground mb-2 font-medium">CLOSERS</p>
          <div className="space-y-2">
            {topClosers.length > 0 ? topClosers.map((closer, index) => {
              const Icon = positionIcons[index];
              return (
                <motion.div
                  key={closer.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className={cn(
                    "flex items-center gap-3 p-2 rounded-lg",
                    positionBg[index]
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center",
                    index === 0 ? "bg-yellow-500" : index === 1 ? "bg-slate-400" : "bg-amber-600"
                  )}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{closer.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {closer.conversions} vendas
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-sm">{formatCurrency(closer.value)}</p>
                    {closer.goalProgress >= 80 && (
                      <Flame className="w-3 h-3 text-orange-500 ml-auto" />
                    )}
                  </div>
                </motion.div>
              );
            }) : (
              <p className="text-sm text-muted-foreground text-center py-2">
                Nenhum closer com vendas
              </p>
            )}
          </div>
        </div>

        {/* Top SDRs */}
        <div>
          <p className="text-xs text-muted-foreground mb-2 font-medium">SDRs</p>
          <div className="space-y-2">
            {topSDRs.length > 0 ? topSDRs.map((sdr, index) => {
              const Icon = positionIcons[index];
              return (
                <motion.div
                  key={sdr.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: (index + 3) * 0.1 }}
                  className={cn(
                    "flex items-center gap-3 p-2 rounded-lg",
                    positionBg[index]
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center",
                    index === 0 ? "bg-yellow-500" : index === 1 ? "bg-slate-400" : "bg-amber-600"
                  )}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{sdr.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {sdr.meetings} reuniões
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-sm">{sdr.goalProgress}%</p>
                    {sdr.goalProgress >= 80 && (
                      <Flame className="w-3 h-3 text-orange-500 ml-auto" />
                    )}
                  </div>
                </motion.div>
              );
            }) : (
              <p className="text-sm text-muted-foreground text-center py-2">
                Nenhum SDR com reuniões
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
