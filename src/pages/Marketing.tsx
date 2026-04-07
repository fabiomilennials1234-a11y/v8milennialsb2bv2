import { useState, useMemo } from "react";
import {
  Megaphone,
  DollarSign,
  Users,
  Calendar,
  Target,
  Trophy,
  TrendingUp,
  PieChart,
  Loader2,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { motion } from "framer-motion";
import { KPICard } from "@/components/dashboard/KPICard";
import { FunnelChart } from "@/components/dashboard/FunnelChart";
import { useMktByOrigin } from "@/hooks/useMktByOrigin";
import { useMktOriginConfigs } from "@/hooks/useMktOriginConfig";
import { MktOriginCard } from "@/components/marketing/MktOriginCard";
import { MktOriginRanking } from "@/components/marketing/MktOriginRanking";
import { MktConfigModal } from "@/components/marketing/MktConfigModal";
import { useIsAdmin } from "@/hooks/useUserRole";
import { useLeads } from "@/hooks/useLeads";
import { usePipePropostas } from "@/hooks/usePipePropostas";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const YEARS = [2024, 2025, 2026, 2027];

function getPrevMonth(month: number, year: number) {
  if (month <= 1) return { month: 12, year: year - 1 };
  return { month: month - 1, year };
}

export default function Marketing() {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [configOpen, setConfigOpen] = useState(false);

  const isGeral = selectedMonth === 0;
  const { byOrigin, summary, isLoading } = useMktByOrigin(selectedMonth, selectedYear);
  const { configMap } = useMktOriginConfigs(selectedMonth, selectedYear);
  const { isAdmin } = useIsAdmin();

  // Raw data for UTM breakdown (uses same React Query cache as useMktByOrigin)
  const { data: allLeads = [] } = useLeads();
  const { data: allPropostas = [] } = usePipePropostas();

  // Previous period for trend calculation
  const prev = isGeral ? { month: 0, year: selectedYear - 1 } : getPrevMonth(selectedMonth, selectedYear);
  const { summary: prevSummary } = useMktByOrigin(prev.month, prev.year);

  // Calculate trends
  const trends = useMemo(() => {
    const calc = (curr: number, prev: number) => {
      if (prev === 0) return undefined;
      const pct = ((curr - prev) / prev) * 100;
      return { value: Math.round(Math.abs(pct)), isPositive: pct >= 0 };
    };
    return {
      investimento: calc(summary.totalInvestimentoReais, prevSummary.totalInvestimentoReais),
      leads: calc(summary.totalLeads, prevSummary.totalLeads),
      cpl: calc(summary.totalCustoPorLead, prevSummary.totalCustoPorLead),
      agendamentos: calc(summary.totalAgendamentos, prevSummary.totalAgendamentos),
      comparecimentos: calc(summary.totalComparecimentos, prevSummary.totalComparecimentos),
      vendas: calc(summary.totalVendas, prevSummary.totalVendas),
      cpv: calc(summary.totalCustoPorVenda, prevSummary.totalCustoPorVenda),
      conversao: calc(summary.totalConversionRate, prevSummary.totalConversionRate),
    };
  }, [summary, prevSummary]);

  // Sort origins by conversion for ranking
  const sortedOrigins = useMemo(
    () => [...byOrigin].sort((a, b) => b.conversionRate - a.conversionRate),
    [byOrigin]
  );

  // Funnel steps for FunnelChart
  const funnelSteps = useMemo(
    () => [
      { label: "Leads", value: summary.totalLeads, color: "blue" },
      { label: "Agendamentos", value: summary.totalAgendamentos, color: "violet" },
      { label: "Comparecimentos", value: summary.totalComparecimentos, color: "amber" },
      { label: "Vendas", value: summary.totalVendas, color: "emerald" },
    ],
    [summary]
  );

  // Rank map for origin cards
  const rankMap = useMemo(() => {
    const map: Record<string, number> = {};
    sortedOrigins.forEach((o, i) => {
      map[o.origin] = i + 1;
    });
    return map;
  }, [sortedOrigins]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
            <Megaphone className="w-[22px] h-[22px] text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-[-0.03em]">Marketing</h1>
            <p className="text-[13px] text-muted-foreground">
              Indicadores por origem — investimento, custo e conversão
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Select
            value={selectedMonth.toString()}
            onValueChange={(v) => setSelectedMonth(Number(v))}
          >
            <SelectTrigger className="w-[130px] h-9 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Geral</SelectItem>
              {MONTHS.map((label, i) => (
                <SelectItem key={i} value={(i + 1).toString()}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!isGeral && (
            <Select
              value={selectedYear.toString()}
              onValueChange={(v) => setSelectedYear(Number(v))}
            >
              <SelectTrigger className="w-[90px] h-9 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((y) => (
                  <SelectItem key={y} value={y.toString()}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {isAdmin && !isGeral && (
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => setConfigOpen(true)}
              title="Configurar investimentos e métricas"
            >
              <Settings2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </motion.div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* KPI Hero Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard
              title="Investimento Total"
              value={summary.totalInvestimentoReais}
              format="currency"
              icon={DollarSign}
              trend={trends.investimento}
              delay={0.05}
            />
            <KPICard
              title="Total de Leads"
              value={summary.totalLeads}
              format="number"
              icon={Users}
              trend={trends.leads}
              delay={0.1}
            />
            <KPICard
              title="Custo por Lead"
              value={summary.totalCustoPorLead}
              format="currency"
              icon={DollarSign}
              trend={trends.cpl ? { ...trends.cpl, isPositive: !trends.cpl.isPositive } : undefined}
              delay={0.15}
            />
            <KPICard
              title="Agendamentos"
              value={summary.totalAgendamentos}
              format="number"
              icon={Calendar}
              trend={trends.agendamentos}
              delay={0.2}
            />
            <KPICard
              title="Comparecimentos"
              value={summary.totalComparecimentos}
              format="number"
              icon={Target}
              trend={trends.comparecimentos}
              delay={0.25}
            />
            <KPICard
              title="Vendas"
              value={summary.totalVendas}
              format="number"
              icon={Trophy}
              trend={trends.vendas}
              delay={0.3}
            />
            <KPICard
              title="Custo por Venda"
              value={summary.totalCustoPorVenda}
              format="currency"
              icon={TrendingUp}
              trend={trends.cpv ? { ...trends.cpv, isPositive: !trends.cpv.isPositive } : undefined}
              delay={0.35}
            />
            <KPICard
              title="Conversão Geral"
              value={summary.totalConversionRate}
              format="percent"
              icon={PieChart}
              trend={trends.conversao}
              delay={0.4}
            />
          </div>

          {/* Funnel + Ranking */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <FunnelChart title="Funil de Marketing" steps={funnelSteps} />
            <MktOriginRanking origins={sortedOrigins} />
          </div>

          {/* Origin Battle Cards */}
          <div>
            <p className="stat-card-label flex items-center gap-1.5 mb-3.5">
              <TrendingUp className="w-3.5 h-3.5 text-primary/60" />
              Desempenho por Origem
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
              {sortedOrigins.map((metrics, i) => (
                <MktOriginCard
                  key={metrics.origin}
                  metrics={metrics}
                  config={configMap[metrics.origin]}
                  rank={rankMap[metrics.origin]}
                  index={i}
                  leads={allLeads as any[]}
                  propostas={allPropostas as any[]}
                />
              ))}
            </div>
          </div>
        </>
      )}

      <MktConfigModal
        open={configOpen}
        onOpenChange={setConfigOpen}
        month={selectedMonth}
        year={selectedYear}
        configMap={configMap}
      />
    </div>
  );
}
