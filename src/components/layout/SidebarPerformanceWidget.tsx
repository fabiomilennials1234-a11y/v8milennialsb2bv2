import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { DollarSign, Target, Flame, CheckCircle, Trophy, Lock, Zap, Eye, EyeOff } from "lucide-react";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useCommissionSummary } from "@/hooks/useCommissions";
import { useOrganization } from "@/hooks/useOrganization";
import { useBadges, useUserBadges } from "@/hooks/useBadges";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { OraculoComercial } from "./OraculoComercial";

const WIDGETS_HIDDEN_KEY = "sidebar_widgets_hidden";

function useWidgetsVisibility() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(WIDGETS_HIDDEN_KEY) === "true";
    } catch {
      return false;
    }
  });

  const toggle = useCallback(() => {
    setHidden((prev) => {
      const next = !prev;
      try { localStorage.setItem(WIDGETS_HIDDEN_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  return { hidden, toggle };
}

function MaskedValue({ children, hidden }: { children: React.ReactNode; hidden: boolean }) {
  if (!hidden) return <>{children}</>;
  return <span className="select-none blur-md">{"R$ •••••"}</span>;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// Intervalo do mês em UTC (alinhado ao dashboard)
function getMonthRangeUTC(month: number, year: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { startStr: start.toISOString(), endStr: end.toISOString() };
}

// Hook para buscar confirmações do SDR no mês atual (scoped to organization)
// Período: COALESCE(metrics_period_at, created_at) no intervalo do mês (alinhado ao dashboard)
function useSDRConfirmations(sdrId: string | undefined) {
  const { organizationId, isReady } = useOrganization();
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const { startStr, endStr } = getMonthRangeUTC(month, year);

  return useQuery({
    queryKey: ["sdr_confirmations", sdrId, month, year, organizationId],
    queryFn: async () => {
      if (!sdrId || !organizationId) return { confirmed: 0, goal: 0 };

      const [q1, q2] = await Promise.all([
        supabase
          .from("pipe_confirmacao")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("sdr_id", sdrId)
          .eq("status", "compareceu")
          .not("metrics_period_at", "is", null)
          .gte("metrics_period_at", startStr)
          .lte("metrics_period_at", endStr),
        supabase
          .from("pipe_confirmacao")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("sdr_id", sdrId)
          .eq("status", "compareceu")
          .is("metrics_period_at", null)
          .gte("created_at", startStr)
          .lte("created_at", endStr),
      ]);
      if (q1.error) throw q1.error;
      if (q2.error) throw q2.error;
      const confirmations = [...(q1.data || []), ...(q2.data || [])];

      const { data: individualGoal } = await supabase
        .from("goals")
        .select("target_value, name, created_at")
        .eq("organization_id", organizationId)
        .eq("team_member_id", sdrId)
        .eq("month", month)
        .eq("year", year)
        .eq("type", "reunioes")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: teamGoal } = individualGoal
        ? { data: null }
        : await supabase
            .from("goals")
            .select("target_value, name, created_at")
            .eq("organization_id", organizationId)
            .is("team_member_id", null)
            .eq("month", month)
            .eq("year", year)
            .eq("type", "reunioes")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

      const resolvedTarget = Number(individualGoal?.target_value ?? teamGoal?.target_value);
      const goalName = individualGoal?.name ?? teamGoal?.name ?? "Meta de reuniões";

      return {
        confirmed: confirmations?.length || 0,
        goal: Number.isFinite(resolvedTarget) && resolvedTarget > 0 ? resolvedTarget : 20,
        goalName,
      };
    },
    enabled: isReady && !!organizationId && !!sdrId,
  });
}

// Hook para buscar vendas do Closer no mês atual - SEMPRE em valor (R$), scoped to organization
// Período: COALESCE(metrics_period_at, closed_at) no intervalo do mês (alinhado ao dashboard)
function useCloserSales(closerId: string | undefined) {
  const { organizationId, isReady } = useOrganization();
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const { startStr, endStr } = getMonthRangeUTC(month, year);

  return useQuery({
    queryKey: ["closer_sales_count", closerId, month, year, organizationId],
    queryFn: async () => {
      if (!closerId || !organizationId) return { salesValue: 0, salesCount: 0, goal: 0, goalName: "" };

      const [salesQ1, salesQ2] = await Promise.all([
        supabase
          .from("pipe_propostas")
          .select("id, sale_value")
          .eq("organization_id", organizationId)
          .eq("closer_id", closerId)
          .eq("status", "vendido")
          .not("metrics_period_at", "is", null)
          .gte("metrics_period_at", startStr)
          .lte("metrics_period_at", endStr),
        supabase
          .from("pipe_propostas")
          .select("id, sale_value")
          .eq("organization_id", organizationId)
          .eq("closer_id", closerId)
          .eq("status", "vendido")
          .is("metrics_period_at", null)
          .gte("closed_at", startStr)
          .lte("closed_at", endStr),
      ]);
      if (salesQ1.error) throw salesQ1.error;
      if (salesQ2.error) throw salesQ2.error;
      const sales = [...(salesQ1.data || []), ...(salesQ2.data || [])];

      const salesCount = sales?.length || 0;
      const salesValue = (sales || []).reduce(
        (sum, s) => sum + (Number(s.sale_value) || 0),
        0
      );

      const { data: individualGoal } = await supabase
        .from("goals")
        .select("target_value, name, created_at")
        .eq("organization_id", organizationId)
        .eq("team_member_id", closerId)
        .eq("month", month)
        .eq("year", year)
        .eq("type", "vendas")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: teamGoal } = individualGoal
        ? { data: null }
        : await supabase
            .from("goals")
            .select("target_value, name, created_at")
            .eq("organization_id", organizationId)
            .is("team_member_id", null)
            .eq("month", month)
            .eq("year", year)
            .eq("type", "faturamento")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

      const resolvedTarget = Number(individualGoal?.target_value ?? teamGoal?.target_value);
      const goal = Number.isFinite(resolvedTarget) && resolvedTarget > 0 ? resolvedTarget : 10000;
      const goalName = individualGoal?.name ?? teamGoal?.name ?? "Meta de vendas";

      return {
        salesValue,
        salesCount,
        goal,
        goalName,
      };
    },
    enabled: isReady && !!organizationId && !!closerId,
  });
}

interface SidebarPerformanceWidgetProps {
  collapsed: boolean;
}

export function SidebarPerformanceWidget({ collapsed }: SidebarPerformanceWidgetProps) {
  const { data: currentMember, isLoading: memberLoading } = useCurrentTeamMember();

  // Use role from team_member instead of user_roles table
  const memberRole = currentMember?.role;

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  // Agora usado tanto para SDR quanto para Closer
  const { data: commissionSummary, isLoading: commissionLoading } = useCommissionSummary(
    currentMember?.id || "",
    month,
    year
  );

  const { data: sdrData, isLoading: sdrLoading } = useSDRConfirmations(
    memberRole === "sdr" ? currentMember?.id : undefined
  );

  const { data: closerSales, isLoading: closerSalesLoading } = useCloserSales(
    memberRole === "closer" ? currentMember?.id : undefined
  );

  const { hidden: widgetsHidden, toggle: toggleWidgets } = useWidgetsVisibility();

  // Admin e agency não veem o widget
  if (memberRole === "admin" || memberRole === "agency") return null;

  // Se não tem membro associado, não mostra
  if (!currentMember && !memberLoading) return null;

  const isLoading = memberLoading || commissionLoading || sdrLoading || closerSalesLoading;

  if (isLoading) {
    return (
      <div className="p-3 border-t border-sidebar-border">
        <div className="bg-sidebar-accent rounded-lg p-3 animate-pulse">
          <div className="h-4 bg-sidebar-border rounded w-20 mb-2" />
          <div className="h-6 bg-sidebar-border rounded w-24" />
        </div>
      </div>
    );
  }

  // Widget para SDR
  if (memberRole === "sdr" && sdrData && commissionSummary) {
    const percentage = sdrData.goal > 0 ? (sdrData.confirmed / sdrData.goal) * 100 : 0;
    const isOnTrack = percentage >= 50;

    return (
      <div className="p-3 border-t border-sidebar-border space-y-2">
        {/* Toggle de visibilidade */}
        {!collapsed && (
          <button
            onClick={toggleWidgets}
            className="flex items-center gap-1.5 text-[10px] text-sidebar-foreground/40 hover:text-sidebar-foreground/70 transition-colors w-full justify-end"
            title={widgetsHidden ? "Mostrar valores" : "Ocultar valores"}
          >
            {widgetsHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            <span>{widgetsHidden ? "Mostrar" : "Ocultar"}</span>
          </button>
        )}

        {/* Ganhos do mês para SDR */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="rounded-lg p-3 bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30"
        >
          {collapsed ? (
            <div className="flex flex-col items-center gap-1">
              <DollarSign className="w-5 h-5 text-primary" />
              <span className="text-xs font-bold text-primary">
                <MaskedValue hidden={widgetsHidden}>
                  {formatCurrency(commissionSummary.totalEarnings).replace("R$", "")}
                </MaskedValue>
              </span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1">
                <Flame className="w-4 h-4 text-primary" />
                <span className="text-xs font-medium text-sidebar-foreground/70">Ganhos do Mês</span>
              </div>
              <motion.div
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                className="text-xl font-bold text-primary"
              >
                <MaskedValue hidden={widgetsHidden}>
                  {formatCurrency(commissionSummary.totalEarnings)}
                </MaskedValue>
              </motion.div>
              {!widgetsHidden && (
                <div className="flex items-center gap-2 mt-1 text-xs text-sidebar-foreground/50">
                  <span>OTE: {formatCurrency(commissionSummary.oteBase + commissionSummary.calculatedBonus)}</span>
                </div>
              )}
            </>
          )}
        </motion.div>

        {/* Meta de comparecidas */}
        {!collapsed && (
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className={`rounded-lg p-3 bg-gradient-to-br ${
              isOnTrack
                ? "from-emerald-500/20 to-emerald-600/10 border border-emerald-500/30"
                : "from-amber-500/20 to-amber-600/10 border border-amber-500/30"
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className={`w-4 h-4 ${isOnTrack ? "text-emerald-400" : "text-amber-400"}`} />
              <span className="text-xs font-medium text-sidebar-foreground/70">Sua meta de comparecidas</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold ${isOnTrack ? "text-emerald-400" : "text-amber-400"}`}>
                <MaskedValue hidden={widgetsHidden}>{sdrData.confirmed}</MaskedValue>
              </span>
              {!widgetsHidden && (
                <span className="text-sm text-sidebar-foreground/50">/ {sdrData.goal}</span>
              )}
            </div>
            {/* Progress bar */}
            {!widgetsHidden && (
              <>
                <div className="mt-2 h-1.5 bg-sidebar-border rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(percentage, 100)}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className={`h-full rounded-full ${isOnTrack ? "bg-emerald-400" : "bg-amber-400"}`}
                  />
                </div>
                <p className="text-xs text-sidebar-foreground/50 mt-1">
                  {percentage.toFixed(0)}% da meta
                </p>
                <p className="text-[10px] text-sidebar-foreground/40 mt-1 truncate" title={sdrData.goalName}>
                  🎯 {sdrData.goalName}
                </p>
              </>
            )}
          </motion.div>
        )}

        {/* Oráculo Comercial para SDR */}
        <OraculoComercial
          role="sdr"
          metrics={{
            confirmados: sdrData.confirmed,
            metaReuniao: sdrData.goal,
            percentualMeta: percentage,
          }}
          collapsed={collapsed}
        />
      </div>
    );
  }

  // Widget para Closer - SEMPRE em valor (R$)
  if (memberRole === "closer" && commissionSummary && closerSales) {
    const percentage = closerSales.goal > 0 ? (closerSales.salesValue / closerSales.goal) * 100 : 0;
    const isOnTrack = percentage >= 70;

    return (
      <div className="p-3 border-t border-sidebar-border space-y-2">
        {/* Toggle de visibilidade */}
        {!collapsed && (
          <button
            onClick={toggleWidgets}
            className="flex items-center gap-1.5 text-[10px] text-sidebar-foreground/40 hover:text-sidebar-foreground/70 transition-colors w-full justify-end"
            title={widgetsHidden ? "Mostrar valores" : "Ocultar valores"}
          >
            {widgetsHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            <span>{widgetsHidden ? "Mostrar" : "Ocultar"}</span>
          </button>
        )}

        {/* Ganhos do mês */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="rounded-lg p-3 bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30"
        >
          {collapsed ? (
            <div className="flex flex-col items-center gap-1">
              <DollarSign className="w-5 h-5 text-primary" />
              <span className="text-xs font-bold text-primary">
                <MaskedValue hidden={widgetsHidden}>
                  {formatCurrency(commissionSummary.totalEarnings).replace("R$", "")}
                </MaskedValue>
              </span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1">
                <Flame className="w-4 h-4 text-primary" />
                <span className="text-xs font-medium text-sidebar-foreground/70">Ganhos do Mês</span>
              </div>
              <motion.div
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                className="text-xl font-bold text-primary"
              >
                <MaskedValue hidden={widgetsHidden}>
                  {formatCurrency(commissionSummary.totalEarnings)}
                </MaskedValue>
              </motion.div>
              {!widgetsHidden && (
                <div className="flex items-center gap-2 mt-1 text-xs text-sidebar-foreground/50">
                  <span>OTE: {formatCurrency(commissionSummary.oteBase + commissionSummary.calculatedBonus)}</span>
                  <span>•</span>
                  <span>Comissão: {formatCurrency(commissionSummary.totalCommission)}</span>
                </div>
              )}
            </>
          )}
        </motion.div>

        {/* Meta - sempre em R$ */}
        {!collapsed && (
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className={`rounded-lg p-3 bg-gradient-to-br ${
              isOnTrack
                ? "from-emerald-500/20 to-emerald-600/10 border border-emerald-500/30"
                : "from-amber-500/20 to-amber-600/10 border border-amber-500/30"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Target className={`w-4 h-4 ${isOnTrack ? "text-emerald-400" : "text-amber-400"}`} />
              <span className="text-xs font-medium text-sidebar-foreground/70">Sua meta de vendas</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className={`text-lg font-bold ${isOnTrack ? "text-emerald-400" : "text-amber-400"}`}>
                <MaskedValue hidden={widgetsHidden}>{formatCurrency(closerSales.salesValue)}</MaskedValue>
              </span>
              {!widgetsHidden && (
                <span className="text-sm text-sidebar-foreground/50">/ {formatCurrency(closerSales.goal)}</span>
              )}
            </div>
            {/* Progress bar */}
            {!widgetsHidden && (
              <>
                <div className="mt-2 h-1.5 bg-sidebar-border rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(percentage, 100)}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className={`h-full rounded-full ${isOnTrack ? "bg-emerald-400" : "bg-amber-400"}`}
                  />
                </div>
                <p className="text-xs text-sidebar-foreground/50 mt-1">{percentage.toFixed(0)}% da meta</p>
                <p className="text-[10px] text-sidebar-foreground/40 mt-1 truncate" title={closerSales.goalName}>
                  🎯 {closerSales.goalName}
                </p>
              </>
            )}
          </motion.div>
        )}

        {/* Oráculo Comercial para Closer */}
        <OraculoComercial
          role="closer"
          metrics={{
            faturamento: closerSales.salesValue,
            metaVendas: closerSales.goal,
            numeroVendas: closerSales.salesCount,
            percentualMetaCloser: percentage,
          }}
          collapsed={collapsed}
        />
      </div>
    );
  }

  // Widget para CLIENTE — progresso de badges/conquistas
  if (memberRole === "cliente") {
    return <SidebarBadgesWidget collapsed={collapsed} teamMemberId={currentMember?.id} />;
  }

  return null;
}

// ─── Widget de Badges para CLIENTE ──────────────────────────
const BADGE_ICON_MAP: Record<string, React.ElementType> = {
  flame: Flame,
  target: Target,
  "trending-up": Trophy,
  zap: Zap,
  trophy: Trophy,
};

// Labels amigáveis para criteria_type
const CRITERIA_LABELS: Record<string, string> = {
  leads_quentes: "leads quentes",
  vendas_count: "vendas",
  faturamento_total: "de faturamento",
  vendas_recorrentes: "vendas recorrentes",
};

// Badges placeholder — mesmos usados no DashboardCliente quando a org não tem badges no banco
const PLACEHOLDER_BADGES: { id: string; name: string; description: string; icon: string; criteria_type: string; criteria_value: number }[] = [
  { id: "ph-1", name: "Primeiro Lead Quente", description: "Receba o primeiro lead quente", icon: "flame", criteria_type: "leads_quentes", criteria_value: 1 },
  { id: "ph-2", name: "Primeira Venda", description: "Feche sua primeira venda", icon: "target", criteria_type: "vendas_count", criteria_value: 1 },
  { id: "ph-3", name: "Faturamento R$10K", description: "Atinja R$10K em faturamento", icon: "trending-up", criteria_type: "faturamento_total", criteria_value: 10000 },
  { id: "ph-4", name: "5 Vendas", description: "Feche 5 vendas no mês", icon: "zap", criteria_type: "vendas_count", criteria_value: 5 },
  { id: "ph-5", name: "Top Closer", description: "Feche 10 vendas", icon: "trophy", criteria_type: "vendas_count", criteria_value: 10 },
];

function formatBadgeValue(value: number, criteriaType: string): string {
  if (criteriaType === "faturamento_total") {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }
  return String(value);
}

function SidebarBadgesWidget({
  collapsed,
  teamMemberId,
}: {
  collapsed: boolean;
  teamMemberId: string | undefined;
}) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const { data: dbBadges = [] } = useBadges();
  const { data: userBadges = [] } = useUserBadges(teamMemberId ?? null);
  const { data: metrics } = useDashboardMetrics(month, year);

  // Se não há badges no banco, usa placeholders
  const badges = dbBadges.length > 0 ? dbBadges : PLACEHOLDER_BADGES;

  // Mapa de progresso — mesmo usado no DashboardCliente
  const progressMap: Record<string, number> = {
    leads_quentes: metrics?.reunioesMarcadas ?? 0,
    vendas_count: metrics?.novosClientes ?? 0,
    faturamento_total: metrics?.vendaTotal ?? 0,
    vendas_recorrentes: 0,
  };

  const unlockedIds = new Set(userBadges.map((ub) => ub.badge_id));
  const unlockedCount = badges.filter((b) => unlockedIds.has(b.id)).length;
  const totalCount = badges.length;
  const overallPercentage = totalCount > 0 ? (unlockedCount / totalCount) * 100 : 0;

  // Próximo badge a desbloquear (ordenado por criteria_value, pega o primeiro não desbloqueado)
  const nextBadge = badges.find((b) => !unlockedIds.has(b.id));
  const NextIcon = nextBadge ? (BADGE_ICON_MAP[nextBadge.icon ?? ""] ?? Trophy) : Trophy;

  // Progresso em direção ao próximo badge
  const nextCurrentValue = nextBadge ? (progressMap[nextBadge.criteria_type] ?? 0) : 0;
  const nextTargetValue = nextBadge?.criteria_value ?? 1;
  const nextProgress = Math.min((nextCurrentValue / nextTargetValue) * 100, 100);
  const nextRemaining = Math.max(nextTargetValue - nextCurrentValue, 0);

  return (
    <div className="p-3 border-t border-sidebar-border space-y-2">
      {/* Card 1 — Conquistas resumo (quantas alcançou) */}
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="rounded-lg p-3 bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30"
      >
        {collapsed ? (
          <div className="flex flex-col items-center gap-1">
            <Trophy className="w-5 h-5 text-primary" />
            <span className="text-xs font-bold text-primary">
              {unlockedCount}/{totalCount}
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <Trophy className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium text-sidebar-foreground/70">Conquistas</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-primary">{unlockedCount}</span>
              <span className="text-sm text-sidebar-foreground/50">/ {totalCount}</span>
            </div>
            <div className="mt-2 h-1.5 bg-sidebar-border rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(overallPercentage, 100)}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="h-full rounded-full bg-primary"
              />
            </div>
            <p className="text-xs text-sidebar-foreground/50 mt-1">
              {overallPercentage.toFixed(0)}% desbloqueado
            </p>
          </>
        )}
      </motion.div>

      {/* Card 2 — Progresso em direção ao próximo badge */}
      {!collapsed && nextBadge && (
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="rounded-lg p-3 bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/30"
        >
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-medium text-sidebar-foreground/70">Próximo marco</span>
          </div>

          {/* Ícone + nome */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-muted border-2 border-amber-500/30 flex items-center justify-center shrink-0">
              <NextIcon className="w-5 h-5 text-amber-400/70" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-sidebar-foreground truncate">{nextBadge.name}</p>
              {nextBadge.description && (
                <p className="text-[10px] text-sidebar-foreground/50 truncate">{nextBadge.description}</p>
              )}
            </div>
          </div>

          {/* Barra de progresso do badge */}
          <div className="h-2 bg-sidebar-border rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${nextProgress}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className={`h-full rounded-full ${
                nextProgress >= 80
                  ? "bg-emerald-400"
                  : nextProgress >= 40
                    ? "bg-amber-400"
                    : "bg-amber-400/60"
              }`}
            />
          </div>

          {/* Valores e quanto falta */}
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-xs font-semibold text-sidebar-foreground">
              {formatBadgeValue(nextCurrentValue, nextBadge.criteria_type)}
              <span className="text-sidebar-foreground/40 font-normal">
                {" "}/ {formatBadgeValue(nextTargetValue, nextBadge.criteria_type)}
              </span>
            </span>
            <span className="text-[10px] text-sidebar-foreground/50">
              {nextProgress.toFixed(0)}%
            </span>
          </div>

          {/* Mensagem de quanto falta */}
          <p className="text-[10px] text-amber-400/80 mt-1">
            {nextRemaining > 0
              ? `Falta${nextBadge.criteria_type === "faturamento_total" ? "m" : nextRemaining === 1 ? "" : "m"} ${formatBadgeValue(nextRemaining, nextBadge.criteria_type)} ${CRITERIA_LABELS[nextBadge.criteria_type] ?? ""}`
              : "Quase lá! Atualize o dashboard"}
          </p>
        </motion.div>
      )}

      {/* Card 3 — Todos os badges já desbloqueados estão completos */}
      {!collapsed && !nextBadge && badges.length > 0 && (
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="rounded-lg p-3 bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 border border-emerald-500/30"
        >
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-medium text-emerald-400">Todas as conquistas desbloqueadas!</span>
          </div>
        </motion.div>
      )}

      {/* Card 4 — Badges desbloqueados (ícones compactos) */}
      {!collapsed && unlockedCount > 0 && (
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="rounded-lg p-3 bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 border border-emerald-500/30"
        >
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-medium text-sidebar-foreground/70">Desbloqueados</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {badges
              .filter((b) => unlockedIds.has(b.id))
              .slice(0, 4)
              .map((b) => {
                const BadgeIcon = BADGE_ICON_MAP[b.icon ?? ""] ?? Trophy;
                return (
                  <div
                    key={b.id}
                    className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center border border-primary/50"
                    title={b.name}
                  >
                    <BadgeIcon className="w-4 h-4 text-primary-foreground" />
                  </div>
                );
              })}
            {unlockedCount > 4 && (
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                +{unlockedCount - 4}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
