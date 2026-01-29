import { motion } from "framer-motion";
import { DollarSign, Target, Flame, CheckCircle } from "lucide-react";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useCommissionSummary } from "@/hooks/useCommissions";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { OraculoComercial } from "./OraculoComercial";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// Hook para buscar confirmações do SDR no mês atual
function useSDRConfirmations(sdrId: string | undefined) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  
  return useQuery({
    queryKey: ["sdr_confirmations", sdrId, month, year],
    queryFn: async () => {
      if (!sdrId) return { confirmed: 0, goal: 0 };
      
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);
      
      // Buscar confirmações do mês (status compareceu)
      const { data: confirmations, error: confError } = await supabase
        .from("pipe_confirmacao")
        .select("id")
        .eq("sdr_id", sdrId)
        .eq("status", "compareceu")
        .gte("meeting_date", startDate.toISOString())
        .lte("meeting_date", endDate.toISOString());
      
      if (confError) throw confError;
      
      // Buscar meta do SDR (prioriza individual; se não existir, usa meta do time)
      const { data: individualGoal } = await supabase
        .from("goals")
        .select("target_value, name, created_at")
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
    enabled: !!sdrId,
  });
}

// Hook para buscar vendas do Closer no mês atual - SEMPRE em valor (R$)
function useCloserSales(closerId: string | undefined) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  
  return useQuery({
    queryKey: ["closer_sales_count", closerId, month, year],
    queryFn: async () => {
      if (!closerId) return { salesValue: 0, salesCount: 0, goal: 0, goalName: "" };
      
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);
      
      const startIso = startDate.toISOString();
      const endIso = endDate.toISOString();

      // Buscar vendas do mês
      const { data: sales, error: salesError } = await supabase
        .from("pipe_propostas")
        .select("id, sale_value")
        .eq("closer_id", closerId)
        .eq("status", "vendido")
        .or(
          `and(closed_at.gte.${startIso},closed_at.lte.${endIso}),and(updated_at.gte.${startIso},updated_at.lte.${endIso})`
        );

      if (salesError) throw salesError;

      const salesCount = sales?.length || 0;
      const salesValue = (sales || []).reduce(
        (sum, s) => sum + (Number(s.sale_value) || 0),
        0
      );

      // Buscar meta do Closer (prioriza individual tipo "vendas"; se não existir, usa meta do time tipo "faturamento")
      const { data: individualGoal } = await supabase
        .from("goals")
        .select("target_value, name, created_at")
        .eq("team_member_id", closerId)
        .eq("month", month)
        .eq("year", year)
        .eq("type", "vendas")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Se não tem meta individual, busca meta de time (tipo "faturamento")
      const { data: teamGoal } = individualGoal
        ? { data: null }
        : await supabase
            .from("goals")
            .select("target_value, name, created_at")
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
    enabled: !!closerId,
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
  
  // Admin não vê o widget
  if (memberRole === "admin") return null;
  
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
                {formatCurrency(commissionSummary.totalEarnings).replace("R$", "")}
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
                {formatCurrency(commissionSummary.totalEarnings)}
              </motion.div>
              <div className="flex items-center gap-2 mt-1 text-xs text-sidebar-foreground/50">
                <span>OTE: {formatCurrency(commissionSummary.oteBase + commissionSummary.calculatedBonus)}</span>
              </div>
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
                {sdrData.confirmed}
              </span>
              <span className="text-sm text-sidebar-foreground/50">/ {sdrData.goal}</span>
            </div>
            {/* Progress bar */}
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
                {formatCurrency(commissionSummary.totalEarnings).replace("R$", "")}
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
                {formatCurrency(commissionSummary.totalEarnings)}
              </motion.div>
              <div className="flex items-center gap-2 mt-1 text-xs text-sidebar-foreground/50">
                <span>OTE: {formatCurrency(commissionSummary.oteBase + commissionSummary.calculatedBonus)}</span>
                <span>•</span>
                <span>Comissão: {formatCurrency(commissionSummary.totalCommission)}</span>
              </div>
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
                {formatCurrency(closerSales.salesValue)}
              </span>
              <span className="text-sm text-sidebar-foreground/50">/ {formatCurrency(closerSales.goal)}</span>
            </div>
            {/* Progress bar */}
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
  
  return null;
}
