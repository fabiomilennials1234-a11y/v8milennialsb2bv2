import { useState, useMemo, lazy, Suspense } from "react";
import {
  DollarSign,
  Users,
  Percent,
  Receipt,
  Timer,
  Clock,
  Radio,
  GitBranch,
  Trophy,
  AlertTriangle,
  TrendingUp,
  BarChart3,
  Loader2,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion, AnimatePresence } from "framer-motion";
import { KPICard } from "@/components/dashboard/KPICard";
import { HeroKPICard } from "@/components/analytics/HeroKPICard";
import { HealthScoreRing, calculateHealthScore } from "@/components/analytics/HealthScoreRing";
import { InsightCard } from "@/components/analytics/InsightCard";
import { UnifiedFunnel } from "@/components/analytics/UnifiedFunnel";
import { AnalyticsFilters } from "@/components/analytics/AnalyticsFilters";
import { useOrganization } from "@/hooks/useOrganization";
import { useAnalyticsOverview } from "@/hooks/useAnalyticsOverview";
import { useAnalyticsEngajamento } from "@/hooks/useAnalyticsEngajamento";
import { useMktByOrigin } from "@/hooks/useMktByOrigin";

// Lazy-load deep-dive sections
const AquisicaoSection = lazy(() =>
  import("@/components/analytics/sections/AquisicaoSection").then((m) => ({ default: m.AquisicaoSection }))
);
const PipelineSection = lazy(() =>
  import("@/components/analytics/sections/PipelineSection").then((m) => ({ default: m.PipelineSection }))
);
const ReceitaSection = lazy(() =>
  import("@/components/analytics/sections/ReceitaSection").then((m) => ({ default: m.ReceitaSection }))
);
const EquipeSection = lazy(() =>
  import("@/components/analytics/sections/EquipeSection").then((m) => ({ default: m.EquipeSection }))
);

const INSIGHT_ICON_MAP: Record<string, typeof Trophy> = {
  oportunidade: Trophy,
  alerta: AlertTriangle,
  tendencia: TrendingUp,
  padrao: BarChart3,
};

const INSIGHT_VARIANT_MAP: Record<string, "success" | "warning" | "info" | "danger"> = {
  oportunidade: "success",
  alerta: "warning",
  tendencia: "info",
  padrao: "info",
};

const DEEP_TABS = [
  { value: "aquisicao", label: "Aquisição", icon: Radio },
  { value: "pipeline", label: "Pipeline", icon: GitBranch },
  { value: "receita", label: "Receita", icon: DollarSign },
  { value: "equipe", label: "Equipe", icon: Users },
] as const;

function SectionLoader() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-7 h-7 animate-spin text-primary" />
    </div>
  );
}

interface TabAnalyticsV2Props {
  month: number;
  year: number;
}

export function TabAnalyticsV2({ month, year }: TabAnalyticsV2Props) {
  const [activeSection, setActiveSection] = useState("aquisicao");
  const { organizationId } = useOrganization();

  const { data: overviewData } = useAnalyticsOverview();
  const { data: engajamentoData } = useAnalyticsEngajamento();
  const { summary } = useMktByOrigin(month, year);

  // ─── Hero KPIs ───────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!overviewData) return null;
    const { attribution, sales_velocity, unit_economics } = overviewData;
    const totalLeads = attribution.reduce((s, a) => s + a.lead_count, 0);
    const totalSales = attribution.reduce((s, a) => s + a.sales_count, 0);
    const totalRevenue = attribution.reduce((s, a) => s + a.revenue, 0);
    const conversionRate = totalLeads > 0 ? (totalSales / totalLeads) * 100 : 0;
    const ticketMedio = totalSales > 0 ? totalRevenue / totalSales / 100 : 0;
    const cycleDays = sales_velocity.total_cycle_days;
    const responseSeconds = engajamentoData?.kpi_cards?.our_avg_response_seconds ?? 0;
    const responseMinutes = responseSeconds / 60;
    const responseRatePct = engajamentoData?.kpi_cards?.response_rate_pct ?? 0;
    return {
      totalRevenue: totalRevenue / 100,
      totalLeads,
      conversionRate,
      ticketMedio,
      cycleDays,
      responseMinutes,
      responseRatePct,
      ltvCacRatio: unit_economics.ltv_cac_ratio,
      cacEstimate: unit_economics.cac_estimate,
      investimento: summary.totalInvestimentoReais,
    };
  }, [overviewData, engajamentoData, summary]);

  // ─── Health Score ────────────────────────────────────────────────────────────
  const healthScore = useMemo(() => {
    if (!kpis) return 50;
    return calculateHealthScore({
      conversionRate: kpis.conversionRate,
      avgCycleDays: kpis.cycleDays,
      responseRatePct: kpis.responseRatePct,
      leadsCount: kpis.totalLeads,
      prevLeadsCount: kpis.totalLeads,
      ltvCacRatio: kpis.ltvCacRatio,
    });
  }, [kpis]);

  // ─── Insights ────────────────────────────────────────────────────────────────
  const bestOrigin = useMemo(() => {
    if (!overviewData?.attribution?.length) return null;
    return [...overviewData.attribution].sort((a, b) => b.conversion_rate - a.conversion_rate)[0];
  }, [overviewData]);

  const bottleneck = useMemo(() => {
    if (!overviewData?.sales_velocity?.bottleneck_stage) return null;
    return overviewData.sales_velocity;
  }, [overviewData]);

  const insights = useMemo(() => {
    if (!overviewData?.insights?.length) return [];
    return overviewData.insights.slice(0, 3);
  }, [overviewData]);

  // ─── Funnel (compact, from marketing summary) ───────────────────────────────
  const funnelSteps = useMemo(
    () => [
      { label: "Leads", value: summary.totalLeads, color: "#6366f1" },
      { label: "Agendamentos", value: summary.totalAgendamentos, color: "#3b82f6" },
      { label: "Comparecimentos", value: summary.totalComparecimentos, color: "#f59e0b" },
      { label: "Vendas", value: summary.totalVendas, color: "#22c55e" },
    ],
    [summary]
  );

  return (
    <div className="space-y-5">
      {/* Sticky filter bar */}
      <AnalyticsFilters />

      {/* ─── HERO SECTION ─────────────────────────────────────────────────────── */}

      {/* Tier 1: Hero KPIs + Health Ring */}
      {kpis && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <HeroKPICard
            title="Receita"
            value={kpis.totalRevenue}
            format="currency"
            icon={DollarSign}
            accentColor="emerald"
            delay={0.05}
          />
          <HeroKPICard
            title="Conversão Geral"
            value={kpis.conversionRate}
            format="percent"
            icon={Percent}
            accentColor="blue"
            delay={0.1}
          />
          <HeroKPICard
            title="CAC Estimado"
            value={kpis.cacEstimate}
            format="currency"
            icon={DollarSign}
            accentColor="amber"
            delay={0.15}
          />
          <HealthScoreRing score={healthScore} />
        </div>
      )}

      {/* Tier 2: Supporting KPIs */}
      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <KPICard title="Leads" value={kpis.totalLeads} format="number" icon={Users} delay={0.2} />
          <KPICard title="Ticket Médio" value={kpis.ticketMedio} format="currency" icon={Receipt} delay={0.25} />
          <KPICard title="Ciclo de Venda" value={kpis.cycleDays} format="number" icon={Timer} delay={0.3} />
          <KPICard title="Tempo Resposta" value={kpis.responseMinutes} format="minutes" icon={Clock} delay={0.35} />
          <KPICard title="Investimento" value={kpis.investimento} format="currency" icon={DollarSign} delay={0.4} />
        </div>
      )}

      {/* Insights strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {bestOrigin && (
          <InsightCard
            icon={Trophy}
            title="Melhor Origem"
            description={`${bestOrigin.origin} — ${bestOrigin.conversion_rate.toFixed(1)}% de conversão com ${bestOrigin.lead_count} leads`}
            variant="success"
            delay={0.35}
          />
        )}
        {bottleneck && bottleneck.bottleneck_stage && (
          <InsightCard
            icon={AlertTriangle}
            title="Maior Gargalo"
            description={`${bottleneck.bottleneck_stage} — representa ${bottleneck.bottleneck_pct.toFixed(0)}% do tempo total do ciclo de venda`}
            variant="warning"
            delay={0.4}
          />
        )}
        {insights.length > 0 && (
          <InsightCard
            icon={INSIGHT_ICON_MAP[insights[0].type] ?? TrendingUp}
            title={insights[0].title}
            description={insights[0].description}
            variant={INSIGHT_VARIANT_MAP[insights[0].type] ?? "info"}
            delay={0.45}
          />
        )}
      </div>

      {/* Unified Funnel — compact */}
      {funnelSteps[0].value > 0 && (
        <UnifiedFunnel
          title="Funil de Conversão"
          variant="compact"
          steps={funnelSteps}
        />
      )}

      {/* ─── DEEP-DIVE SECTIONS ───────────────────────────────────────────────── */}

      <Tabs value={activeSection} onValueChange={setActiveSection}>
        <TabsList>
          {DEEP_TABS.map((tab) => {
            const TabIcon = tab.icon;
            return (
              <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
                <TabIcon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeSection}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
          >
            <TabsContent value="aquisicao" className="mt-0">
              <Suspense fallback={<SectionLoader />}>
                <AquisicaoSection month={month} year={year} />
              </Suspense>
            </TabsContent>
            <TabsContent value="pipeline" className="mt-0">
              <Suspense fallback={<SectionLoader />}>
                <PipelineSection />
              </Suspense>
            </TabsContent>
            <TabsContent value="receita" className="mt-0">
              <Suspense fallback={<SectionLoader />}>
                <ReceitaSection />
              </Suspense>
            </TabsContent>
            <TabsContent value="equipe" className="mt-0">
              <Suspense fallback={<SectionLoader />}>
                <EquipeSection />
              </Suspense>
            </TabsContent>
          </motion.div>
        </AnimatePresence>
      </Tabs>
    </div>
  );
}
