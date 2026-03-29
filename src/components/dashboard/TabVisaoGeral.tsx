import { memo } from "react";
import { motion } from "framer-motion";
import {
  DollarSign,
  Users,
  Receipt,
  FileText,
  TrendingUp,
  Clock,
} from "lucide-react";
import { KPICard } from "./KPICard";
import { SpeedometerGauge } from "./SpeedometerGauge";
import { FunnelChart } from "./FunnelChart";
import { TopPerformers } from "./TopPerformers";
import { FirstOrderVsBase } from "./FirstOrderVsBase";
import { useDashboardMetrics, useFunnelData, useRankingData } from "@/hooks/useDashboardMetrics";
import { useTeamGoals } from "@/hooks/useGoals";
import { Skeleton } from "@/components/ui/skeleton";

interface TabVisaoGeralProps {
  month: number;
  year: number;
  isAdmin: boolean;
}

function formatCurrency(value: number): string {
  if (value >= 1000000) return `R$ ${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}K`;
  return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
}

function TabVisaoGeralBase({ month, year, isAdmin }: TabVisaoGeralProps) {
  const { data: metrics, isLoading: metricsLoading } = useDashboardMetrics(month, year);
  const { data: totalMetrics } = useDashboardMetrics(month, year, null);
  const { data: funnelData, isLoading: funnelLoading } = useFunnelData(month, year);
  const { data: teamGoals } = useTeamGoals(month, year);

  const now = new Date();
  const dayOfMonth = month === now.getMonth() + 1 && year === now.getFullYear()
    ? now.getDate()
    : new Date(year, month, 0).getDate();
  const daysInMonth = new Date(year, month, 0).getDate();
  const expectedProgress = (dayOfMonth / daysInMonth) * 100;

  const faturamentoGoal = teamGoals?.find((g) => g.type === "faturamento");

  // Use org-wide metrics for admin, personal for sellers
  const displayMetrics = isAdmin ? metrics : metrics;
  const speedoMetrics = isAdmin ? metrics : totalMetrics;

  const currentPercent = faturamentoGoal && faturamentoGoal.target_value > 0
    ? ((speedoMetrics?.vendaTotal || 0) / faturamentoGoal.target_value) * 100
    : 0;

  // Funnel transformation
  const funnelSteps = funnelData?.map(step => ({
    label: step.label,
    value: step.value,
    color: step.color.replace("hsl(var(--", "bg-").replace("))", ""),
  })) || [];

  // Taxa de conversão — vem do RPC (vendas / total no pipe, mesma fórmula da página de propostas)
  const taxaConversao = displayMetrics?.taxaConversao ?? 0;

  if (metricsLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Row 1: KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPICard
          title="Receita do Mês"
          value={displayMetrics?.vendaTotal || 0}
          format="currency"
          icon={DollarSign}
          delay={0}
        />
        <KPICard
          title="Leads Captados"
          value={displayMetrics?.totalLeads || 0}
          format="number"
          icon={Users}
          delay={0.05}
        />
        <KPICard
          title="Ticket Médio"
          value={displayMetrics?.ticketMedio || 0}
          format="currency"
          icon={Receipt}
          delay={0.1}
        />
        <KPICard
          title="Propostas Enviadas"
          value={displayMetrics?.propostasEnviadas || 0}
          format="number"
          icon={FileText}
          delay={0.15}
        />
        <KPICard
          title="Taxa de Conversão"
          value={displayMetrics?.taxaConversao ?? taxaConversao}
          format="percent"
          icon={TrendingUp}
          delay={0.2}
        />
        <KPICard
          title="Tempo de Resposta"
          value={displayMetrics?.tempoMedioResposta || 0}
          format="minutes"
          icon={Clock}
          delay={0.25}
        />
      </div>

      {/* Row 2: Speedometer + Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Speedometer */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="lg:col-span-3 bg-card border border-border rounded-lg p-6"
        >
          <p className="stat-card-label mb-4">Meta do Mês</p>
          {faturamentoGoal ? (
            <SpeedometerGauge
              currentPercent={currentPercent}
              expectedPercent={expectedProgress}
              goalLabel={formatCurrency(faturamentoGoal.target_value)}
              currentLabel={formatCurrency(speedoMetrics?.vendaTotal || 0)}
              subtitle={`Dia ${dayOfMonth} de ${daysInMonth}`}
            />
          ) : (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
              Configure uma meta de faturamento para visualizar o velocímetro.
            </div>
          )}
        </motion.div>

        {/* Funnel */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="lg:col-span-2"
        >
          <FunnelChart
            title="Funil de Vendas"
            steps={funnelSteps.length > 0 ? funnelSteps : [
              { label: "Leads", value: displayMetrics?.totalLeads || 0, color: "bg-primary" },
              { label: "Reuniões", value: displayMetrics?.reunioesMarcadas || 0, color: "bg-chart-2" },
              { label: "Propostas", value: displayMetrics?.propostasEnviadas || 0, color: "bg-chart-4" },
              { label: "Vendas", value: displayMetrics?.novosClientes || 0, color: "bg-success" },
            ]}
          />
        </motion.div>
      </div>

      {/* Row 3: Top Vendedores + Primeiro Pedido vs Base */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <TopPerformers />
        </div>
        <div className="lg:col-span-2">
          <FirstOrderVsBase
            firstOrderValue={displayMetrics?.vendaPrimeiroPedido || 0}
            baseActiveValue={displayMetrics?.vendaBaseAtiva || 0}
          />
        </div>
      </div>
    </div>
  );
}

export const TabVisaoGeral = memo(TabVisaoGeralBase);
