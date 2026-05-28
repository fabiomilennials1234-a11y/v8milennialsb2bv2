import { memo } from "react";
import { motion } from "framer-motion";
import { Target, Users, User, TrendingUp } from "lucide-react";
import { GoalProgress } from "./GoalProgress";
import { MetaComparativeChart } from "./MetaComparativeChart";
import { SegmentBenchmark } from "./SegmentBenchmark";
import { WeeklyChart } from "./WeeklyChart";
import { useDashboardMetrics } from "@/modules/analytics/hooks/useDashboardMetrics";
import { useTeamGoals, useIndividualGoals } from "@/modules/engagement/hooks/useGoals";
import { useCurrentTeamMember } from "@/modules/identity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WinLossAnalysis } from "@/modules/analytics/components/analytics/WinLossAnalysis";
import { AnalyticsErrorBoundary } from "@/modules/analytics/components/analytics/AnalyticsErrorBoundary";
import { NextBestActionsPanel } from "@/components/ai/NextBestActionsPanel";


interface TabInteligenciaProps {
  month: number;
  year: number;
  isAdmin: boolean;
}

function TabInteligenciaBase({ month, year, isAdmin }: TabInteligenciaProps) {
  const { data: metrics } = useDashboardMetrics(month, year);
  const { data: totalMetrics } = useDashboardMetrics(month, year, null);
  const { data: teamGoals, isLoading: goalsLoading } = useTeamGoals(month, year);
  const { data: individualGoals } = useIndividualGoals(month, year);
  const { data: currentTeamMember } = useCurrentTeamMember();

  const now = new Date();
  const dayOfMonth = month === now.getMonth() + 1 && year === now.getFullYear()
    ? now.getDate()
    : new Date(year, month, 0).getDate();
  const daysInMonth = new Date(year, month, 0).getDate();
  const expectedProgress = (dayOfMonth / daysInMonth) * 100;

  const faturamentoGoal = teamGoals?.find((g) => g.type === "faturamento");
  const clientesGoal = teamGoals?.find((g) => g.type === "clientes");
  const reunioesGoal = teamGoals?.find((g) => g.type === "reunioes");

  const displayMetrics = isAdmin ? metrics : totalMetrics;

  // Determine rhythm status
  const getRhythm = (current: number, goal: number) => {
    const expected = (goal * expectedProgress) / 100;
    if (current >= expected * 1.1) return { label: "Acima da meta", color: "text-success" };
    if (current >= expected * 0.9) return { label: "No ritmo", color: "text-primary" };
    return { label: "Abaixo do ritmo", color: "text-destructive" };
  };

  if (goalsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Row 0: AI Next-Best Actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <NextBestActionsPanel limit={5} compact />
      </motion.div>

      {/* Row 1: Metas detalhadas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Meta do Time */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                Metas da Equipe
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {faturamentoGoal && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">Faturamento</span>
                    <span className={`text-xs font-medium ${getRhythm(displayMetrics?.vendaTotal || 0, faturamentoGoal.target_value).color}`}>
                      {getRhythm(displayMetrics?.vendaTotal || 0, faturamentoGoal.target_value).label}
                    </span>
                  </div>
                  <GoalProgress
                    title=""
                    current={displayMetrics?.vendaTotal || 0}
                    goal={faturamentoGoal.target_value}
                    unit="R$ "
                  />
                </div>
              )}
              {clientesGoal && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">Novos Clientes</span>
                    <span className={`text-xs font-medium ${getRhythm(displayMetrics?.novosClientes || 0, clientesGoal.target_value).color}`}>
                      {getRhythm(displayMetrics?.novosClientes || 0, clientesGoal.target_value).label}
                    </span>
                  </div>
                  <GoalProgress
                    title=""
                    current={displayMetrics?.novosClientes || 0}
                    goal={clientesGoal.target_value}
                  />
                </div>
              )}
              {reunioesGoal && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">Reuniões</span>
                    <span className={`text-xs font-medium ${getRhythm(displayMetrics?.reunioesComparecidas || 0, reunioesGoal.target_value).color}`}>
                      {getRhythm(displayMetrics?.reunioesComparecidas || 0, reunioesGoal.target_value).label}
                    </span>
                  </div>
                  <GoalProgress
                    title=""
                    current={displayMetrics?.reunioesComparecidas || 0}
                    goal={reunioesGoal.target_value}
                  />
                </div>
              )}
              {!faturamentoGoal && !clientesGoal && !reunioesGoal && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhuma meta configurada para este mês.
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Metas Individuais */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <User className="w-4 h-4 text-primary" />
                Metas Individuais
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                {individualGoals?.salesGoals?.map((g) => (
                  <div key={g.id} className={`p-2 rounded-lg ${g.id === currentTeamMember?.id ? "bg-primary/5 border border-primary/20" : ""}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium truncate">{g.name}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${g.percentage >= 80 ? "text-success" : g.percentage >= 40 ? "text-primary" : "text-destructive"}`}>
                          {g.percentage}%
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(g.percentage, 100)}%` }}
                        transition={{ duration: 0.8, delay: 0.2 }}
                        className={`h-full rounded-full ${g.percentage >= 80 ? "bg-success" : g.percentage >= 40 ? "bg-primary" : "bg-destructive"}`}
                      />
                    </div>
                  </div>
                ))}
                {individualGoals?.meetingsGoals?.map((g) => (
                  <div key={g.id} className={`p-2 rounded-lg ${g.id === currentTeamMember?.id ? "bg-primary/5 border border-primary/20" : ""}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium truncate">{g.name}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${g.percentage >= 80 ? "text-success" : g.percentage >= 40 ? "text-primary" : "text-destructive"}`}>
                          {g.percentage}%
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(g.percentage, 100)}%` }}
                        transition={{ duration: 0.8, delay: 0.2 }}
                        className={`h-full rounded-full ${g.percentage >= 80 ? "bg-success" : g.percentage >= 40 ? "bg-primary" : "bg-destructive"}`}
                      />
                    </div>
                  </div>
                ))}
                {(!individualGoals?.salesGoals?.length && !individualGoals?.meetingsGoals?.length) && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhuma meta individual configurada.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Row 2: Comparativo meta esperada vs real */}
      {faturamentoGoal && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <MetaComparativeChart
            dailySales={displayMetrics?.dailySales || []}
            goalTarget={faturamentoGoal.target_value}
            month={month}
            year={year}
          />
        </motion.div>
      )}

      {/* Row 3: Benchmark do segmento */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <SegmentBenchmark month={month} year={year} />
      </motion.div>

      {/* Row 4: Win/Loss Analysis */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
      >
        <AnalyticsErrorBoundary>
          <WinLossAnalysis />
        </AnalyticsErrorBoundary>
      </motion.div>

      {/* Row 5: Gráfico semanal */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <WeeklyChart />
      </motion.div>
    </div>
  );
}

export const TabInteligencia = memo(TabInteligenciaBase);
