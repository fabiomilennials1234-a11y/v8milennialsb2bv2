import { memo } from "react";
import { motion } from "framer-motion";
import { Trophy, Crown, Medal, Award, Flame } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useRankingData } from "@/hooks/useDashboardMetrics";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

const positionIcons = [Crown, Medal, Award];
const positionBg = [
  "bg-yellow-500/10",
  "bg-slate-400/10",
  "bg-amber-600/10",
];
const positionIconBg = [
  "bg-yellow-500",
  "bg-slate-400",
  "bg-amber-600",
];

function TopPerformersBase() {
  const now = new Date();
  const navigate = useNavigate();
  const { data: rankingData, isLoading } = useRankingData(now.getMonth() + 1, now.getFullYear());

  const topClosers = rankingData?.salesRanking?.slice(0, 3) || [];
  const topSDRs = rankingData?.meetingsRanking?.slice(0, 3) || [];

  const formatCurrency = (value: number) => {
    if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}K`;
    return `R$ ${value.toLocaleString("pt-BR")}`;
  };

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border border-border p-5">
        <p className="stat-card-label mb-4">Top Performers</p>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-card rounded-lg border border-border p-5 cursor-pointer hover:border-primary/30 transition-colors"
      onClick={() => navigate("/dashboard?tab=time")}
    >
      <div className="flex items-center justify-between mb-4">
        <p className="stat-card-label flex items-center gap-1.5">
          <Trophy className="w-3.5 h-3.5 text-primary/60" />
          Top Performers
        </p>
        <Badge variant="outline" className="text-[10px] py-0">Ver ranking</Badge>
      </div>

      {/* Top Closers */}
      <div className="mb-4">
        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-2">Vendedores</p>
        <div className="space-y-1.5">
          {topClosers.length > 0 ? topClosers.map((closer, index) => {
            const Icon = positionIcons[index];
            return (
              <motion.div
                key={closer.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.08 }}
                className={cn("flex items-center gap-2.5 p-2 rounded-lg", positionBg[index])}
              >
                <div className={cn("w-7 h-7 rounded-full flex items-center justify-center", positionIconBg[index])}>
                  <Icon className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[13px] truncate">{closer.name}</p>
                </div>
                <div className="text-right flex items-center gap-1.5">
                  <p className="font-bold text-[13px] tabular-nums">{formatCurrency(closer.value)}</p>
                  {closer.goalProgress >= 80 && (
                    <Flame className="w-3 h-3 text-orange-500" />
                  )}
                </div>
              </motion.div>
            );
          }) : (
            <p className="text-xs text-muted-foreground/50 text-center py-2">
              Nenhum vendedor com vendas
            </p>
          )}
        </div>
      </div>

      {/* Top SDRs */}
      <div>
        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-2">Reuniões</p>
        <div className="space-y-1.5">
          {topSDRs.length > 0 ? topSDRs.map((sdr, index) => {
            const Icon = positionIcons[index];
            return (
              <motion.div
                key={sdr.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: (index + 3) * 0.08 }}
                className={cn("flex items-center gap-2.5 p-2 rounded-lg", positionBg[index])}
              >
                <div className={cn("w-7 h-7 rounded-full flex items-center justify-center", positionIconBg[index])}>
                  <Icon className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[13px] truncate">{sdr.name}</p>
                </div>
                <div className="text-right flex items-center gap-1.5">
                  <p className="font-bold text-[13px] tabular-nums">{sdr.goalProgress}%</p>
                  {sdr.goalProgress >= 80 && (
                    <Flame className="w-3 h-3 text-orange-500" />
                  )}
                </div>
              </motion.div>
            );
          }) : (
            <p className="text-xs text-muted-foreground/50 text-center py-2">
              Nenhum vendedor com reuniões
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export const TopPerformers = memo(TopPerformersBase);
