import { motion } from "framer-motion";
import { Trophy, Medal, Award, TrendingUp, Zap, Star, Crown, Flame, Calendar } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { TopThreePodium, LeaderboardCard } from "@/components/gamification/LeaderboardCard";
import { MiniProgressRing } from "@/components/gamification/ProgressRing";
import badgeIcon from "@/assets/badge-icon.png";
import { useRankingData } from "@/hooks/useDashboardMetrics";

interface RankingUser {
  id: string;
  name: string;
  role: "Closer" | "SDR";
  value: number;
  conversions?: number;
  meetings?: number;
  goalProgress: number;
  position: number;
}

const positionStyles = {
  1: { icon: Crown, color: "text-yellow-500", bg: "bg-gradient-to-br from-yellow-400 to-amber-500", border: "border-yellow-400" },
  2: { icon: Medal, color: "text-slate-400", bg: "bg-gradient-to-br from-slate-300 to-slate-400", border: "border-slate-400" },
  3: { icon: Award, color: "text-amber-600", bg: "bg-gradient-to-br from-amber-600 to-amber-700", border: "border-amber-600" },
};

function RankingCard({ user, showValue = true }: { user: RankingUser; showValue?: boolean }) {
  const isTop3 = user.position <= 3;
  const styles = positionStyles[user.position as keyof typeof positionStyles];
  const Icon = styles?.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: user.position * 0.05 }}
      whileHover={{ scale: 1.01, x: 4 }}
      className={`relative overflow-hidden rounded-xl border p-4 transition-all ${
        user.position === 1 
          ? "bg-gradient-to-r from-yellow-400/10 to-transparent border-yellow-400/50 shadow-lg shadow-yellow-400/10" 
          : isTop3 
          ? `bg-gradient-to-r from-${user.position === 2 ? 'slate' : 'amber'}-400/5 to-transparent ${styles.border}/30` 
          : "bg-card border-border hover:border-primary/30"
      }`}
    >
      {/* Shimmer effect for #1 */}
      {user.position === 1 && (
        <motion.div
          className="absolute inset-0 -translate-x-full"
          animate={{ translateX: ["100%", "-100%"] }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear", repeatDelay: 2 }}
          style={{
            background: "linear-gradient(90deg, transparent, rgba(245, 197, 24, 0.1), transparent)",
          }}
        />
      )}

      <div className="relative flex items-center gap-4">
        {/* Position */}
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
          isTop3 ? styles.bg : "bg-muted"
        }`}>
          {Icon ? (
            <Icon className="w-6 h-6 text-white" />
          ) : (
            <span className="text-lg font-bold text-muted-foreground">
              {user.position}º
            </span>
          )}
        </div>

        {/* Avatar */}
        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
          isTop3 ? "bg-white/20 border-2 " + styles.border : "bg-accent"
        }`}>
          <span className={`text-lg font-semibold ${isTop3 ? "text-foreground" : "text-accent-foreground"}`}>
            {user.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
          </span>
        </div>

        {/* Info */}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{user.name}</h3>
            {user.goalProgress >= 100 && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="flex items-center gap-1 px-2 py-0.5 bg-success/10 rounded-full"
              >
                <Star className="w-3 h-3 text-success fill-success" />
                <span className="text-xs font-medium text-success">Meta!</span>
              </motion.div>
            )}
            {user.goalProgress >= 80 && user.goalProgress < 100 && (
              <div className="flex items-center gap-1 px-2 py-0.5 bg-orange-500/10 rounded-full">
                <Flame className="w-3 h-3 text-orange-500" />
              </div>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{user.role}</p>
        </div>

        {/* Stats */}
        <div className="text-right">
          {showValue ? (
            <>
              <p className="text-xl font-bold">R$ {user.value.toLocaleString("pt-BR")}</p>
              <p className="text-sm text-muted-foreground">
                {user.conversions || 0} vendas
              </p>
            </>
          ) : (
            <>
              <p className="text-xl font-bold">{user.meetings || 0}</p>
              <p className="text-sm text-muted-foreground">reuniões</p>
            </>
          )}
        </div>

        {/* Goal Progress Ring */}
        <MiniProgressRing 
          progress={user.goalProgress} 
          color={user.goalProgress >= 100 ? "success" : "primary"} 
        />
      </div>
    </motion.div>
  );
}

export default function Ranking() {
  const now = new Date();
  const { data: rankingData, isLoading } = useRankingData(now.getMonth() + 1, now.getFullYear());

  const closers: RankingUser[] = rankingData?.closerRanking || [];
  const sdrs: RankingUser[] = rankingData?.sdrRanking || [];
  const leader = closers[0];

  // Transform for podium
  const podiumUsers = closers.slice(0, 3).map(c => ({
    id: c.id,
    name: c.name,
    value: c.value,
    position: c.position,
    goalProgress: c.goalProgress,
  }));

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-bold flex items-center gap-3"
          >
            <Trophy className="w-7 h-7 text-primary" />
            Ranking de Vendas
          </motion.h1>
          <p className="text-muted-foreground mt-1">
            Acompanhe a performance do time em tempo real
          </p>
        </div>
        <img src={badgeIcon} alt="" className="w-16 h-16 opacity-80" />
      </div>

      {/* Podium for Top 3 Closers */}
      {isLoading ? (
        <Skeleton className="h-[300px] rounded-2xl" />
      ) : closers.length >= 3 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-accent to-accent/80 rounded-2xl p-8 text-accent-foreground relative overflow-hidden"
        >
          {/* Background decoration */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-10 left-10 w-32 h-32 bg-primary rounded-full blur-3xl" />
            <div className="absolute bottom-10 right-10 w-40 h-40 bg-primary rounded-full blur-3xl" />
          </div>

          <div className="relative">
            <div className="text-center mb-4">
              <h2 className="text-lg font-medium opacity-80">🏆 Top Vendedores do Mês</h2>
            </div>

            <TopThreePodium users={podiumUsers} />
          </div>
        </motion.div>
      ) : leader ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-accent to-accent/80 rounded-2xl p-8 text-accent-foreground"
        >
          <div className="text-center">
            <h2 className="text-lg font-medium opacity-80">Líder do Mês</h2>
            <div className="flex items-center justify-center gap-3 mt-2">
              <Zap className="w-6 h-6 text-primary" />
              <span className="text-3xl font-bold">{leader.name}</span>
              <Zap className="w-6 h-6 text-primary" />
            </div>
            <p className="text-4xl font-bold text-primary mt-2">
              R$ {leader.value.toLocaleString("pt-BR")}
            </p>
            <p className="opacity-60 mt-1">{leader.goalProgress}% da meta atingida</p>
          </div>
        </motion.div>
      ) : (
        <div className="bg-muted/50 rounded-2xl p-8 text-center">
          <p className="text-muted-foreground">Nenhum dado de ranking disponível.</p>
          <p className="text-sm text-muted-foreground mt-2">Cadastre closers e registre vendas.</p>
        </div>
      )}

      {/* Full Rankings */}
      <Tabs defaultValue="closers" className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="closers" className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Closers ({closers.length})
          </TabsTrigger>
          <TabsTrigger value="sdrs" className="flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            SDRs ({sdrs.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="closers" className="space-y-3">
          {isLoading ? (
            Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-20" />)
          ) : closers.length > 0 ? (
            closers.map((user) => (
              <RankingCard key={user.id} user={user} />
            ))
          ) : (
            <p className="text-muted-foreground text-center py-8">Nenhum closer cadastrado.</p>
          )}
        </TabsContent>

        <TabsContent value="sdrs" className="space-y-3">
          {isLoading ? (
            Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-20" />)
          ) : sdrs.length > 0 ? (
            sdrs.map((user) => (
              <RankingCard key={user.id} user={user} showValue={false} />
            ))
          ) : (
            <p className="text-muted-foreground text-center py-8">Nenhum SDR cadastrado.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
