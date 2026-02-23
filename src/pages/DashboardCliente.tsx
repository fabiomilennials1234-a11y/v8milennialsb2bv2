import { useEffect } from "react";
import { motion } from "framer-motion";
import {
  Fuel,
  Flame,
  TrendingUp,
  DollarSign,
  Target,
  Gauge,
  Flag,
  Link2,
  ShoppingCart,
  Trophy,
  Lock,
  Zap,
  BarChart3,
} from "lucide-react";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { FunnelChart } from "@/components/dashboard/FunnelChart";
import { useDashboardMetrics, useFunnelData } from "@/hooks/useDashboardMetrics";
import { useBadges, useUserBadges, useUnlockBadge } from "@/hooks/useBadges";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import boltIcon from "@/assets/bolt-icon.png";
import type { Badge } from "@/hooks/useBadges";

// Mapa de ícone string → componente Lucide
const ICON_MAP: Record<string, React.ElementType> = {
  flame: Flame,
  target: Target,
  "trending-up": TrendingUp,
  zap: Zap,
  trophy: Trophy,
  "badge-dollar-sign": DollarSign,
  star: Trophy,
  crown: Trophy,
  shield: Trophy,
};

function formatCurrency(value: number): string {
  if (value >= 1000000) return `R$ ${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}K`;
  return `R$ ${value.toLocaleString("pt-BR")}`;
}

// Badges ilustrativos quando não há nenhum cadastrado
const PLACEHOLDER_BADGES: Omit<Badge, "organization_id" | "created_at">[] = [
  { id: "ph-1", name: "Primeiro Lead Quente", description: "Receba o primeiro lead quente", icon: "flame", criteria_type: "leads_quentes", criteria_value: 1, is_system: true },
  { id: "ph-2", name: "Primeira Venda", description: "Feche sua primeira venda", icon: "target", criteria_type: "vendas_count", criteria_value: 1, is_system: true },
  { id: "ph-3", name: "Faturamento R$10K", description: "Atinja R$10K em faturamento", icon: "trending-up", criteria_type: "faturamento_total", criteria_value: 10000, is_system: true },
  { id: "ph-4", name: "5 Vendas", description: "Feche 5 vendas no m\u00eas", icon: "zap", criteria_type: "vendas_count", criteria_value: 5, is_system: true },
  { id: "ph-5", name: "Top Closer", description: "Feche 10 vendas", icon: "trophy", criteria_type: "vendas_count", criteria_value: 10, is_system: true },
];

export default function DashboardCliente() {
  const { user } = useAuth();
  const { teamMemberId } = useOrganization();
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const { data: metrics, isLoading: metricsLoading } = useDashboardMetrics(month, year);
  const { data: funnelData, isLoading: funnelLoading } = useFunnelData(month, year);
  const { data: badges = [] } = useBadges();
  const { data: userBadges = [] } = useUserBadges(teamMemberId);
  const unlockBadge = useUnlockBadge();

  const userName = user?.user_metadata?.full_name?.split(" ")[0] || user?.email?.split("@")[0] || "Cliente";

  const getGreeting = () => {
    const hour = now.getHours();
    if (hour < 12) return "Bom dia";
    if (hour < 18) return "Boa tarde";
    return "Boa noite";
  };

  // Progresso das badges
  const progressMap: Record<string, number> = {
    leads_quentes: metrics?.reunioesMarcadas ?? 0,
    vendas_count: metrics?.novosClientes ?? 0,
    faturamento_total: metrics?.vendaTotal ?? 0,
    vendas_recorrentes: 0,
  };

  // Auto-unlock de badges ao carregar
  useEffect(() => {
    if (!teamMemberId || badges.length === 0) return;
    const unlockedIds = new Set(userBadges.map((ub) => ub.badge_id));
    for (const badge of badges) {
      if (unlockedIds.has(badge.id)) continue;
      const currentValue = progressMap[badge.criteria_type] ?? 0;
      if (currentValue >= badge.criteria_value) {
        unlockBadge.mutate({ badgeId: badge.id, teamMemberId });
      }
    }
  }, [teamMemberId, badges.length, userBadges.length, metrics]);

  // Métricas calculadas
  const taxaConversao = metrics?.totalLeads
    ? Math.round((metrics.novosClientes / metrics.totalLeads) * 100)
    : 0;

  const taxaConexao = metrics?.totalLeads
    ? Math.round((metrics.reunioesMarcadas / metrics.totalLeads) * 100)
    : 0;

  const ticketMedioPorVenda = metrics?.novosClientes
    ? Math.round(metrics.vendaTotal / metrics.novosClientes)
    : 0;

  const vendasDoMes = metrics?.novosClientes ?? 0;

  // Badges para exibir (reais ou placeholders)
  const displayBadges = badges.length > 0 ? badges : PLACEHOLDER_BADGES as Badge[];
  const unlockedIds = new Set(userBadges.map((ub) => ub.badge_id));
  const unlockedCount = displayBadges.filter((b) => unlockedIds.has(b.id)).length;
  const totalBadges = displayBadges.length;
  const badgeProgress = totalBadges > 0 ? (unlockedCount / totalBadges) * 100 : 0;

  // Funnel steps
  const funnelSteps = funnelData?.length
    ? funnelData.slice(0, 4).map((step, i) => ({
        label: ["Leads", "Agendamentos", "Compareceu", "Vendas"][i] || step.label,
        value: step.value,
        color: ["bg-primary", "bg-chart-2", "bg-chart-3", "bg-success"][i] || "bg-primary",
      }))
    : [
        { label: "Leads", value: metrics?.totalLeads || 0, color: "bg-primary" },
        { label: "Agendamentos", value: metrics?.reunioesMarcadas || 0, color: "bg-chart-2" },
        { label: "Compareceu", value: metrics?.reunioesComparecidas || 0, color: "bg-chart-3" },
        { label: "Vendas", value: metrics?.novosClientes || 0, color: "bg-success" },
      ];

  const isLoading = metricsLoading || funnelLoading;

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

  return (
    <div className="space-y-8">
      {/* Header — idêntico ao CRM */}
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
                Central de Comando Torque • Seus Resultados
              </p>
            </div>
          </div>
        </motion.div>
        <div className="flex items-center gap-3">
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

      {/* Linha 1 — 4 KPIs principais */}
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
          title="Leads Quentes"
          value={metrics?.reunioesMarcadas?.toString() || "0"}
          subtitle="Agendamentos gerados"
          icon={Flame}
          variant="primary"
        />
        <MetricCard
          title="Taxa de Conversão"
          value={`${taxaConversao}%`}
          subtitle={`${metrics?.novosClientes || 0} de ${metrics?.totalLeads || 0} leads`}
          icon={Target}
        />
        <MetricCard
          title="Taxa de Conexão"
          value={`${taxaConexao}%`}
          subtitle={`${metrics?.reunioesMarcadas || 0} de ${metrics?.totalLeads || 0} leads`}
          icon={Link2}
        />
      </motion.div>

      {/* Linha 2 — 3 KPIs de vendas */}
      <motion.div
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
      >
        <MetricCard
          title="Velocidade Total (Vendas)"
          value={formatCurrency(metrics?.vendaTotal || 0)}
          subtitle={`${vendasDoMes} vendas fechadas`}
          icon={DollarSign}
          variant="success"
        />
        <MetricCard
          title="Ticket Médio por Venda"
          value={formatCurrency(ticketMedioPorVenda)}
          subtitle={`${vendasDoMes} vendas no mês`}
          icon={TrendingUp}
        />
        <MetricCard
          title="Vendas do Mês"
          value={vendasDoMes.toString()}
          subtitle="Negócios fechados"
          icon={ShoppingCart}
        />
      </motion.div>

      {/* Seção Gamificada — Caminho de Conquistas */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3 }}
      >
        <Card className="racing-stripe">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Trophy className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <span className="block">Caminho das Conquistas</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {unlockedCount} de {totalBadges} desbloqueados
                  </span>
                </div>
              </CardTitle>
              {badges.length === 0 && (
                <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">Ilustrativo</span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {/* Roadmap scrollável horizontalmente */}
            <div className="overflow-x-auto pb-2 -mx-2 px-2 scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
              <div className="flex flex-col items-stretch" style={{ minWidth: `${Math.max(totalBadges * 120, 500)}px` }}>
                {/* Marcos (badges) */}
                <div className="flex justify-between px-6">
                  {displayBadges.map((badge, i) => {
                    const isUnlocked = unlockedIds.has(badge.id);
                    const Icon = ICON_MAP[badge.icon ?? ""] ?? Trophy;

                    return (
                      <motion.div
                        key={badge.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 + i * 0.1 }}
                        className="flex flex-col items-center w-[100px] shrink-0"
                      >
                        {/* Ícone circular */}
                        <div
                          className={`relative w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
                            isUnlocked
                              ? "bg-gradient-to-br from-primary to-primary/80 border-primary/50 shadow-lg shadow-primary/20"
                              : "bg-card border-muted-foreground/20"
                          }`}
                        >
                          {isUnlocked ? (
                            <Icon className="w-6 h-6 text-primary-foreground" />
                          ) : (
                            <Lock className="w-5 h-5 text-muted-foreground/40" />
                          )}
                          {isUnlocked && (
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                              <Zap className="w-2.5 h-2.5 text-white" />
                            </div>
                          )}
                        </div>
                        {/* Label */}
                        <p className={`text-[10px] mt-1.5 text-center leading-tight ${
                          isUnlocked ? "text-foreground font-semibold" : "text-muted-foreground"
                        }`}>
                          {badge.name}
                        </p>
                        {/* Conector vertical até a barra */}
                        <div className={`w-0.5 h-4 mt-1 ${isUnlocked ? "bg-primary/50" : "bg-muted-foreground/20"}`} />
                      </motion.div>
                    );
                  })}
                </div>

                {/* Barra de progresso principal */}
                <div className="w-full h-3 bg-muted rounded-full overflow-hidden mx-auto">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${badgeProgress}%` }}
                    transition={{ duration: 1.2, ease: "easeOut" }}
                    className="h-full bg-gradient-to-r from-primary to-primary/70 rounded-full"
                  />
                </div>
              </div>
            </div>

            {/* Grid detalhado dos badges */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mt-6">
              {displayBadges.map((badge, index) => {
                const isUnlocked = unlockedIds.has(badge.id);
                const Icon = ICON_MAP[badge.icon ?? ""] ?? Trophy;
                const currentValue = progressMap[badge.criteria_type] ?? 0;
                const progress = Math.min((currentValue / badge.criteria_value) * 100, 100);

                return (
                  <motion.div
                    key={badge.id}
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.6 + index * 0.06 }}
                    whileHover={{ scale: 1.03 }}
                    className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-colors ${
                      isUnlocked
                        ? "bg-gradient-to-br from-primary/5 to-primary/10 border-primary/30"
                        : "bg-muted/30 border-muted-foreground/10"
                    }`}
                  >
                    <div
                      className={`relative w-12 h-12 rounded-full flex items-center justify-center border-2 ${
                        isUnlocked
                          ? "bg-gradient-to-br from-primary to-primary/80 border-primary/50 shadow-lg shadow-primary/20"
                          : "bg-muted border-muted-foreground/20"
                      }`}
                    >
                      {isUnlocked ? (
                        <Icon className="w-6 h-6 text-primary-foreground" />
                      ) : (
                        <Lock className="w-5 h-5 text-muted-foreground/40" />
                      )}
                      {isUnlocked && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                          <Zap className="w-2.5 h-2.5 text-white" />
                        </div>
                      )}
                    </div>

                    <div className="text-center">
                      <p className={`text-xs font-semibold ${isUnlocked ? "text-foreground" : "text-muted-foreground"}`}>
                        {badge.name}
                      </p>
                      {badge.description && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                          {badge.description}
                        </p>
                      )}
                    </div>

                    {/* Barra de progresso individual */}
                    {!isUnlocked && (
                      <div className="w-full space-y-1">
                        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary/60 rounded-full transition-all duration-500"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground text-center">
                          {currentValue}/{badge.criteria_value}
                        </p>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Funil + Resumo */}
      <motion.div
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.4 }}
      >
        <FunnelChart
          title="Pista de Conversão"
          steps={funnelSteps}
        />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Resumo do Mês
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { label: "Leads Recebidos", value: (metrics?.totalLeads || 0).toString(), icon: Fuel, color: "text-primary" },
                { label: "Leads Quentes", value: (metrics?.reunioesMarcadas || 0).toString(), icon: Flame, color: "text-orange-500" },
                { label: "Reuniões Comparecidas", value: (metrics?.reunioesComparecidas || 0).toString(), icon: Target, color: "text-blue-500" },
                { label: "Vendas Fechadas", value: vendasDoMes.toString(), icon: ShoppingCart, color: "text-green-500" },
                { label: "Faturamento", value: formatCurrency(metrics?.vendaTotal || 0), icon: DollarSign, color: "text-emerald-500" },
              ].map((item, i) => (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.05 }}
                  className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <item.icon className={`w-4 h-4 ${item.color}`} />
                    </div>
                    <span className="text-sm font-medium">{item.label}</span>
                  </div>
                  <span className="text-sm font-bold">{item.value}</span>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
