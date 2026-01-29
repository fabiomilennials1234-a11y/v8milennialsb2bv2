import { motion } from "framer-motion";
import { Target, Users, TrendingUp, Calendar, Zap, Trophy, Flame, Star, Crown, Award } from "lucide-react";
import { GoalProgress } from "@/components/dashboard/GoalProgress";
import { ProgressRing } from "@/components/gamification/ProgressRing";
import { AchievementBadge, BadgeType } from "@/components/gamification/AchievementBadge";
import { useTeamGoals, useIndividualGoals } from "@/hooks/useGoals";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

function getPositionIcon(position: number) {
  if (position === 1) return Crown;
  if (position === 2) return Award;
  if (position === 3) return Trophy;
  return null;
}

function getPositionStyle(position: number) {
  if (position === 1) return "from-yellow-400 to-amber-500 border-yellow-400";
  if (position === 2) return "from-slate-300 to-slate-400 border-slate-400";
  if (position === 3) return "from-amber-600 to-amber-700 border-amber-600";
  return "from-muted to-muted border-border";
}

export default function Metas() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(year, month, 0).getDate();
  const expectedProgress = (dayOfMonth / daysInMonth) * 100;

  const { data: teamGoals, isLoading: goalsLoading } = useTeamGoals(month, year);
  const { data: individualGoals, isLoading: individualLoading } = useIndividualGoals(month, year);
  const { data: metrics, isLoading: metricsLoading } = useDashboardMetrics(month, year);

  const isLoading = goalsLoading || individualLoading || metricsLoading;

  // Find specific goals and their current values
  const faturamentoGoal = teamGoals?.find((g) => g.type === "faturamento");
  const clientesGoal = teamGoals?.find((g) => g.type === "clientes");
  const reunioesGoal = teamGoals?.find((g) => g.type === "reunioes");
  const conversaoGoal = teamGoals?.find((g) => g.type === "conversao");

  // Use real metrics
  const currentFaturamento = metrics?.vendaTotal || 0;
  const currentClientes = metrics?.novosClientes || 0;
  const currentReunioes = metrics?.reunioesComparecidas || 0;
  const currentConversao = metrics?.reunioesMarcadas 
    ? (metrics.reunioesComparecidas / metrics.reunioesMarcadas) * 100 
    : 0;

  // Calculate percentages
  const faturamentoProgress = faturamentoGoal 
    ? (currentFaturamento / faturamentoGoal.target_value) * 100 
    : 0;
  const clientesProgress = clientesGoal 
    ? (currentClientes / clientesGoal.target_value) * 100 
    : 0;
  const reunioesProgress = reunioesGoal 
    ? (currentReunioes / reunioesGoal.target_value) * 100 
    : 0;

  // Calculate expected vs actual
  const expectedFaturamento = faturamentoGoal 
    ? (faturamentoGoal.target_value * expectedProgress) / 100 
    : 0;
  const faturamentoDiff = expectedFaturamento > 0 
    ? ((currentFaturamento - expectedFaturamento) / expectedFaturamento) * 100 
    : 0;

  // Generate achievements based on progress
  const achievements: Array<{ type: BadgeType; title: string; earned: boolean }> = [
    { type: "first_sale", title: "Primeira Venda", earned: currentClientes >= 1 },
    { type: "bronze", title: "Bronze", earned: faturamentoProgress >= 50 },
    { type: "silver", title: "Prata", earned: faturamentoProgress >= 75 },
    { type: "gold", title: "Ouro", earned: faturamentoProgress >= 100 },
    { type: "overachiever", title: "Superação", earned: faturamentoProgress >= 120 },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-bold flex items-center gap-2"
          >
            <Target className="w-6 h-6 text-primary" />
            Metas & Conquistas
          </motion.h1>
          <p className="text-muted-foreground mt-1">
            Acompanhe o progresso e desbloqueie conquistas
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-lg">
          <Zap className="w-5 h-5 text-primary" />
          <span className="font-medium">
            {format(now, "MMMM yyyy", { locale: ptBR })}
          </span>
          <span className="text-muted-foreground">• Dia {dayOfMonth}/{daysInMonth}</span>
        </div>
      </div>

      {/* Achievements Row */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card rounded-xl border border-border p-6"
      >
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Star className="w-5 h-5 text-primary fill-primary" />
          Suas Conquistas
        </h2>
        <div className="flex items-center gap-6 overflow-x-auto pb-2">
          {achievements.map((achievement, index) => (
            <motion.div
              key={achievement.type}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.1 }}
            >
              <AchievementBadge
                type={achievement.type}
                title={achievement.title}
                earned={achievement.earned}
                size="md"
              />
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Main Progress Rings */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {faturamentoGoal && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-xl border border-border p-6 flex flex-col items-center"
            >
              <ProgressRing
                progress={faturamentoProgress}
                icon={Target}
                label="Faturamento"
                value={`R$ ${(currentFaturamento / 1000).toFixed(0)}K`}
                color={faturamentoProgress >= 100 ? "success" : "primary"}
                size={140}
              />
              <p className="text-xs text-muted-foreground mt-2">
                Meta: R$ {(faturamentoGoal.target_value / 1000).toFixed(0)}K
              </p>
            </motion.div>
          )}
          
          {clientesGoal && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-card rounded-xl border border-border p-6 flex flex-col items-center"
            >
              <ProgressRing
                progress={clientesProgress}
                icon={Users}
                label="Novos Clientes"
                value={currentClientes.toString()}
                color={clientesProgress >= 100 ? "success" : "primary"}
                size={140}
              />
              <p className="text-xs text-muted-foreground mt-2">
                Meta: {clientesGoal.target_value} clientes
              </p>
            </motion.div>
          )}
          
          {reunioesGoal && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-card rounded-xl border border-border p-6 flex flex-col items-center"
            >
              <ProgressRing
                progress={reunioesProgress}
                icon={Calendar}
                label="Reuniões"
                value={currentReunioes.toString()}
                color={reunioesProgress >= 100 ? "success" : "warning"}
                size={140}
              />
              <p className="text-xs text-muted-foreground mt-2">
                Meta: {reunioesGoal.target_value} reuniões
              </p>
            </motion.div>
          )}
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-card rounded-xl border border-border p-6 flex flex-col items-center"
          >
            <ProgressRing
              progress={expectedProgress}
              icon={TrendingUp}
              label="Progresso do Mês"
              color={faturamentoDiff >= 0 ? "success" : "destructive"}
              size={140}
            />
            <p className={`text-xs mt-2 font-medium ${faturamentoDiff >= 0 ? "text-success" : "text-destructive"}`}>
              {faturamentoDiff >= 0 ? "+" : ""}{faturamentoDiff.toFixed(0)}% vs esperado
            </p>
          </motion.div>
        </div>
      )}

      {/* Progress Indicator Card */}
      {faturamentoGoal && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-xl p-6 border-2 ${
            faturamentoDiff >= 0 
              ? "bg-success/5 border-success/30" 
              : "bg-destructive/5 border-destructive/30"
          }`}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              {faturamentoDiff >= 0 ? (
                <Flame className="w-5 h-5 text-success" />
              ) : (
                <TrendingUp className="w-5 h-5 text-destructive" />
              )}
              Onde você deveria estar hoje
            </h2>
            <span className="text-sm text-muted-foreground">
              {expectedProgress.toFixed(1)}% do mês
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-card/80 rounded-lg">
              <p className="text-sm text-muted-foreground mb-1">Faturamento Esperado</p>
              <p className="text-2xl font-bold text-primary">
                R$ {Math.round(expectedFaturamento).toLocaleString("pt-BR")}
              </p>
            </div>
            <div className="p-4 bg-card/80 rounded-lg">
              <p className="text-sm text-muted-foreground mb-1">Faturamento Atual</p>
              <p className="text-2xl font-bold text-success">
                R$ {currentFaturamento.toLocaleString("pt-BR")}
              </p>
            </div>
            <div className={`p-4 rounded-lg ${faturamentoDiff >= 0 ? "bg-success/10" : "bg-destructive/10"}`}>
              <p className="text-sm text-muted-foreground mb-1">Diferença</p>
              <p className={`text-2xl font-bold ${faturamentoDiff >= 0 ? "text-success" : "text-destructive"}`}>
                {faturamentoDiff >= 0 ? "+" : ""}{faturamentoDiff.toFixed(0)}%
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Individual Goals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Metas por Closer */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-card rounded-xl border border-border p-6"
        >
          <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
            <Trophy className="w-5 h-5 text-primary" />
            Ranking Closers
          </h2>
          {individualLoading ? (
            <div className="space-y-4">
              {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : individualGoals?.closerGoals && individualGoals.closerGoals.length > 0 ? (
            <div className="space-y-3">
              {individualGoals.closerGoals
                .sort((a, b) => b.percentage - a.percentage)
                .map((vendedor, index) => {
                  const position = index + 1;
                  const PositionIcon = getPositionIcon(position);
                  const isTop3 = position <= 3;
                  
                  return (
                    <motion.div 
                      key={vendedor.id} 
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className={`flex items-center gap-4 p-3 rounded-xl border transition-all hover:scale-[1.02] ${
                        isTop3 
                          ? `bg-gradient-to-r ${getPositionStyle(position)} bg-opacity-10 border-opacity-50` 
                          : "bg-muted/30 border-transparent hover:border-border"
                      }`}
                    >
                      {/* Position */}
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        isTop3 ? `bg-gradient-to-br ${getPositionStyle(position)}` : "bg-muted"
                      }`}>
                        {PositionIcon ? (
                          <PositionIcon className={`w-5 h-5 ${isTop3 ? "text-white" : "text-muted-foreground"}`} />
                        ) : (
                          <span className="text-sm font-bold text-muted-foreground">{position}</span>
                        )}
                      </div>

                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-semibold text-accent-foreground">
                          {vendedor.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                        </span>
                      </div>
                      
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium truncate">{vendedor.name}</span>
                          <span className={`text-sm font-bold ${
                            vendedor.percentage >= 100 ? "text-success" : "text-muted-foreground"
                          }`}>
                            {vendedor.percentage}%
                          </span>
                        </div>
                        <div className="progress-bar">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(vendedor.percentage, 100)}%` }}
                            transition={{ duration: 0.6, delay: index * 0.1 }}
                            className={`progress-fill ${
                              vendedor.percentage >= 100 ? "bg-success" : "gradient-gold"
                            }`}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          R$ {vendedor.current.toLocaleString("pt-BR")} / R$ {vendedor.goal.toLocaleString("pt-BR")}
                        </p>
                      </div>

                      {/* Streak/Fire for top performers */}
                      {vendedor.percentage >= 80 && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-orange-500/10 rounded-full">
                          <Flame className="w-4 h-4 text-orange-500" />
                        </div>
                      )}
                    </motion.div>
                  );
                })}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-4">
              Nenhuma meta individual para closers.
            </p>
          )}
        </motion.div>

        {/* Metas por SDR */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-card rounded-xl border border-border p-6"
        >
          <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-chart-5" />
            Ranking SDRs (Reuniões)
          </h2>
          {individualLoading ? (
            <div className="space-y-4">
              {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : individualGoals?.sdrGoals && individualGoals.sdrGoals.length > 0 ? (
            <div className="space-y-3">
              {individualGoals.sdrGoals
                .sort((a, b) => b.percentage - a.percentage)
                .map((sdr, index) => {
                  const position = index + 1;
                  const PositionIcon = getPositionIcon(position);
                  const isTop3 = position <= 3;
                  
                  return (
                    <motion.div 
                      key={sdr.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className={`flex items-center gap-4 p-3 rounded-xl border transition-all hover:scale-[1.02] ${
                        isTop3 
                          ? `bg-gradient-to-r ${getPositionStyle(position)} bg-opacity-10 border-opacity-50` 
                          : "bg-muted/30 border-transparent hover:border-border"
                      }`}
                    >
                      {/* Position */}
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        isTop3 ? `bg-gradient-to-br ${getPositionStyle(position)}` : "bg-muted"
                      }`}>
                        {PositionIcon ? (
                          <PositionIcon className={`w-5 h-5 ${isTop3 ? "text-white" : "text-muted-foreground"}`} />
                        ) : (
                          <span className="text-sm font-bold text-muted-foreground">{position}</span>
                        )}
                      </div>

                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-semibold text-primary">
                          {sdr.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                        </span>
                      </div>
                      
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium truncate">{sdr.name}</span>
                          <span className={`text-sm font-bold ${
                            sdr.percentage >= 100 ? "text-success" : "text-muted-foreground"
                          }`}>
                            {sdr.percentage}%
                          </span>
                        </div>
                        <div className="progress-bar">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(sdr.percentage, 100)}%` }}
                            transition={{ duration: 0.6, delay: index * 0.1 }}
                            className={`progress-fill ${
                              sdr.percentage >= 100 ? "bg-success" : "bg-chart-5"
                            }`}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {sdr.current} / {sdr.goal} reuniões comparecidas
                        </p>
                      </div>

                      {/* Streak/Fire for top performers */}
                      {sdr.percentage >= 80 && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-orange-500/10 rounded-full">
                          <Flame className="w-4 h-4 text-orange-500" />
                        </div>
                      )}
                    </motion.div>
                  );
                })}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-4">
              Nenhuma meta individual para SDRs.
            </p>
          )}
        </motion.div>
      </div>
    </div>
  );
}
