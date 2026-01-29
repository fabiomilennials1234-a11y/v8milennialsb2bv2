import { motion } from "framer-motion";
import {
  Fuel,
  Calendar,
  CheckCircle2,
  XCircle,
  TrendingUp,
  DollarSign,
  Target,
  Gauge,
  Activity,
  BarChart3,
  Flag,
} from "lucide-react";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { GoalProgress } from "@/components/dashboard/GoalProgress";
import { FunnelChart } from "@/components/dashboard/FunnelChart";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { PerformanceChart } from "@/components/dashboard/PerformanceChart";
import { ConversionChart } from "@/components/dashboard/ConversionChart";
import { WeeklyChart } from "@/components/dashboard/WeeklyChart";
import { TopPerformers } from "@/components/dashboard/TopPerformers";
import { SalesBreakdown } from "@/components/dashboard/SalesBreakdown";
import { QuickStats } from "@/components/dashboard/QuickStats";
import { PriorityLeads } from "@/components/dashboard/PriorityLeads";
import { useDashboardMetrics, useFunnelData, useRankingData, useConversionRates } from "@/hooks/useDashboardMetrics";
import { useTeamGoals } from "@/hooks/useGoals";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import boltIcon from "@/assets/bolt-icon.png";

function formatCurrency(value: number): string {
  if (value >= 1000000) return `R$ ${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}K`;
  return `R$ ${value.toLocaleString("pt-BR")}`;
}

export default function Dashboard() {
  const { user } = useAuth();
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(year, month, 0).getDate();
  const expectedProgress = (dayOfMonth / daysInMonth) * 100;

  const { data: metrics, isLoading: metricsLoading } = useDashboardMetrics(month, year);
  const { data: funnelData, isLoading: funnelLoading } = useFunnelData(month, year);
  const { data: rankingData, isLoading: rankingLoading } = useRankingData(month, year);
  const { data: conversionRates, isLoading: conversionLoading } = useConversionRates(month, year);
  const { data: teamGoals, isLoading: goalsLoading } = useTeamGoals(month, year);

  const userName = user?.user_metadata?.full_name?.split(" ")[0] || user?.email?.split("@")[0] || "Usuário";

  const getGreeting = () => {
    const hour = now.getHours();
    if (hour < 12) return "Bom dia";
    if (hour < 18) return "Boa tarde";
    return "Boa noite";
  };

  // Find specific goals
  const faturamentoGoal = teamGoals?.find((g) => g.type === "faturamento");
  const clientesGoal = teamGoals?.find((g) => g.type === "clientes");
  const reunioesGoal = teamGoals?.find((g) => g.type === "reunioes");

  // Calculate expected progress
  const expectedFaturamento = faturamentoGoal 
    ? (faturamentoGoal.target_value * expectedProgress) / 100 
    : 0;

  // Transform ranking data for preview
  const topClosers = rankingData?.closerRanking?.slice(0, 5).map(c => ({
    id: c.id,
    name: c.name,
    value: c.value,
    position: c.position,
  })) || [];

  // Transform funnel data
  const funnelSteps = funnelData?.map(step => ({
    label: step.label,
    value: step.value,
    color: step.color.replace("hsl(var(--", "bg-").replace("))", ""),
  })) || [];

  const isLoading = metricsLoading || funnelLoading || rankingLoading || goalsLoading;

  if (isLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const taxaNoShow = metrics?.reunioesMarcadas 
    ? Math.round((metrics.noShow / metrics.reunioesMarcadas) * 100) 
    : 0;
  
  const taxaComparecimento = metrics?.reunioesMarcadas 
    ? Math.round((metrics.reunioesComparecidas / metrics.reunioesMarcadas) * 100) 
    : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          <div className="flex items-center gap-3">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring" }}
              className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center"
            >
              <Gauge className="w-6 h-6 text-primary" />
            </motion.div>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                {getGreeting()}, {userName}! 
                <motion.span 
                  animate={{ rotate: [0, 10, -10, 0] }}
                  transition={{ repeat: Infinity, duration: 2, repeatDelay: 3 }}
                >
                  🏁
                </motion.span>
              </h1>
              <p className="text-muted-foreground">
                Central de Comando V8 • Hora de acelerar
              </p>
            </div>
          </div>
        </motion.div>
        <div className="flex items-center gap-3">
          <QuickStats className="hidden lg:flex" />
          <motion.div 
            className="flex items-center gap-2 bg-card border border-border rounded-full px-4 py-2"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
          >
            <Flag className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">
              {format(now, "MMMM yyyy", { locale: ptBR })}
            </span>
          </motion.div>
          <motion.img 
            src={boltIcon} 
            alt="" 
            className="w-8 h-8 opacity-80"
            animate={{ rotate: [0, 5, -5, 0] }}
            transition={{ repeat: Infinity, duration: 1.5 }}
          />
        </div>
      </div>

      {/* Main Metrics - Combustível Stats */}
      <motion.div 
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        <MetricCard
          title="Combustível (Leads)"
          value={metrics?.totalLeads?.toString() || "0"}
          subtitle="Este mês"
          icon={Fuel}
        />
        <MetricCard
          title="Reuniões Marcadas"
          value={metrics?.reunioesMarcadas?.toString() || "0"}
          subtitle={`${taxaComparecimento}% compareceram`}
          icon={Calendar}
          variant="primary"
        />
        <MetricCard
          title="Taxa de Comparecimento"
          value={`${taxaComparecimento}%`}
          subtitle={`${metrics?.reunioesComparecidas || 0} de ${metrics?.reunioesMarcadas || 0}`}
          icon={CheckCircle2}
        />
        <MetricCard
          title="Taxa de No-Show"
          value={`${taxaNoShow}%`}
          subtitle={`${metrics?.noShow || 0} não compareceram`}
          icon={XCircle}
        />
      </motion.div>

      {/* Sales Metrics - Velocímetro do Faturamento */}
      <motion.div 
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
      >
        <MetricCard
          title="Velocidade Total (Vendas)"
          value={formatCurrency(metrics?.vendaTotal || 0)}
          subtitle={`${metrics?.novosClientes || 0} vendas fechadas`}
          icon={DollarSign}
          variant="success"
        />
        <MetricCard
          title="Ticket Médio MRR"
          value={formatCurrency(metrics?.ticketMedioMRR || 0)}
          subtitle={`${Math.round((metrics?.vendaMRR || 0) / (metrics?.ticketMedioMRR || 1))} contratos MRR`}
          icon={TrendingUp}
        />
        <MetricCard
          title="Ticket Médio Projeto"
          value={formatCurrency(metrics?.ticketMedioProjeto || 0)}
          subtitle={`${Math.round((metrics?.vendaProjeto || 0) / (metrics?.ticketMedioProjeto || 1))} projetos`}
          icon={Target}
        />
      </motion.div>

      {/* Goal Progress - Velocímetro de Metas */}
      {(faturamentoGoal || clientesGoal || reunioesGoal) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3 }}
          className="bg-card rounded-xl border border-border p-6 racing-stripe"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Gauge className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-lg font-semibold">Velocímetro de Metas</h2>
            </div>
            <div className="flex items-center gap-2 bg-muted px-3 py-1.5 rounded-full">
              <Flag className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Volta {dayOfMonth} de {daysInMonth}</span>
            </div>
          </div>

          <div className="grid gap-6">
            {faturamentoGoal && (
              <GoalProgress
                title="Meta de Faturamento"
                current={metrics?.vendaTotal || 0}
                goal={faturamentoGoal.target_value}
                unit="R$ "
              />
            )}
            {clientesGoal && (
              <GoalProgress
                title="Meta de Novos Clientes"
                current={metrics?.novosClientes || 0}
                goal={clientesGoal.target_value}
              />
            )}
            {reunioesGoal && (
              <GoalProgress
                title="Meta de Reuniões Comparecidas"
                current={metrics?.reunioesComparecidas || 0}
                goal={reunioesGoal.target_value}
              />
            )}
            {faturamentoGoal && expectedFaturamento > 0 && (
              <GoalProgress
                title="Onde deveria estar hoje"
                current={metrics?.vendaTotal || 0}
                goal={Math.round(expectedFaturamento)}
                unit="R$ "
              />
            )}
          </div>
        </motion.div>
      )}

      {/* Performance Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            Performance do Mês
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PerformanceChart />
        </CardContent>
      </Card>

      {/* Priority Leads & Charts Row - Combustível Prioritário */}
      <motion.div 
        className="grid grid-cols-1 lg:grid-cols-3 gap-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.4 }}
      >
        <PriorityLeads />
        <FunnelChart 
          title="Pista de Conversão" 
          steps={funnelSteps.length > 0 ? funnelSteps : [
            { label: "Combustível", value: metrics?.totalLeads || 0, color: "bg-primary" },
            { label: "Reuniões", value: metrics?.reunioesMarcadas || 0, color: "bg-chart-2" },
            { label: "Compareceu", value: metrics?.reunioesComparecidas || 0, color: "bg-chart-3" },
            { label: "Vendas", value: metrics?.novosClientes || 0, color: "bg-success" },
          ]} 
        />
        <SalesBreakdown />
      </motion.div>
      
      {/* Additional Charts Row - Pilotos em Ação */}
      <motion.div 
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.5 }}
      >
        <TopPerformers />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Pit Lane • Atividade Recente
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 px-2">
            <ActivityFeed />
          </CardContent>
        </Card>
      </motion.div>

      {/* Weekly Performance - Voltas da Semana */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.6 }}
      >
        <WeeklyChart />
      </motion.div>

      {/* Conversion Charts - Performance dos Pilotos */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.7 }}
      >
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Flag className="w-4 h-4 text-primary" />
              Performance dos Pilotos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ConversionChart />
          </CardContent>
        </Card>
      </motion.div>

    </div>
  );
}
