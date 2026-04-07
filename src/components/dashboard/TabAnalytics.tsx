import { useState, useMemo } from "react";
import {
  DollarSign,
  Users,
  Percent,
  Receipt,
  Timer,
  Clock,
  BarChart3,
  TrendingUp,
  Target,
  Link,
  Zap,
  AlertTriangle,
  Trophy,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion, AnimatePresence } from "framer-motion";
import { KPICard } from "@/components/dashboard/KPICard";
import { HealthScoreGauge, calculateHealthScore } from "@/components/analytics/HealthScoreGauge";
import { InsightCard } from "@/components/analytics/InsightCard";
import { AnalyticsFilters } from "@/components/analytics/AnalyticsFilters";
import { OverviewTab } from "@/components/analytics/tabs/OverviewTab";
import { FinanceiroTab } from "@/components/analytics/tabs/FinanceiroTab";
import { ComercialTab } from "@/components/analytics/tabs/ComercialTab";
import { PipesFunisTab } from "@/components/analytics/tabs/PipesFunisTab";
import { EngajamentoTab } from "@/components/analytics/tabs/EngajamentoTab";
import { UtmsTab } from "@/components/analytics/tabs/UtmsTab";
import { useOrganization } from "@/hooks/useOrganization";
import { useAnalyticsOverview } from "@/hooks/useAnalyticsOverview";
import { useAnalyticsEngajamento } from "@/hooks/useAnalyticsEngajamento";

const SUB_TABS = [
  { value: "overview", label: "Visão Geral", icon: BarChart3 },
  { value: "financeiro", label: "Financeiro", icon: DollarSign },
  { value: "comercial", label: "Comercial", icon: Target },
  { value: "pipes", label: "Pipes & Funis", icon: Link },
  { value: "engajamento", label: "Engajamento", icon: Zap },
] as const;

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

export function TabAnalytics() {
  const [activeSubTab, setActiveSubTab] = useState("overview");
  const { organizationId } = useOrganization();
  const showUtmsTab = organizationId === "6030520a-2ca7-477d-be89-55758e2cd808";

  const { data: overviewData } = useAnalyticsOverview();
  const { data: engajamentoData } = useAnalyticsEngajamento();

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
    };
  }, [overviewData, engajamentoData]);

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

  return (
    <div className="space-y-5">
      <AnalyticsFilters />

      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KPICard title="Receita" value={kpis.totalRevenue} format="currency" icon={DollarSign} delay={0.05} />
          <KPICard title="Leads" value={kpis.totalLeads} format="number" icon={Users} delay={0.1} />
          <KPICard title="Conversão" value={kpis.conversionRate} format="percent" icon={Percent} delay={0.15} />
          <KPICard title="Ticket Médio" value={kpis.ticketMedio} format="currency" icon={Receipt} delay={0.2} />
          <KPICard title="Ciclo de Venda" value={kpis.cycleDays} format="number" icon={Timer} delay={0.25} />
          <KPICard title="Tempo Resposta" value={kpis.responseMinutes} format="minutes" icon={Clock} delay={0.3} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <HealthScoreGauge score={healthScore} />
        <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-3 content-start">
          {bestOrigin && (
            <InsightCard
              icon={Trophy}
              title="Melhor Origem"
              value={`${bestOrigin.conversion_rate.toFixed(1)}% conv.`}
              subtitle={`${bestOrigin.origin} — ${bestOrigin.lead_count} leads`}
              variant="success"
              delay={0.35}
            />
          )}
          {bottleneck && bottleneck.bottleneck_stage && (
            <InsightCard
              icon={AlertTriangle}
              title="Maior Gargalo"
              value={bottleneck.bottleneck_stage}
              subtitle={`${bottleneck.bottleneck_pct.toFixed(0)}% do tempo total`}
              variant="warning"
              delay={0.4}
            />
          )}
          {insights.length > 0 && (
            <InsightCard
              icon={INSIGHT_ICON_MAP[insights[0].type] ?? TrendingUp}
              title={insights[0].title}
              value={insights[0].description.slice(0, 40)}
              subtitle={insights[0].description.length > 40 ? insights[0].description.slice(40, 80) + "..." : ""}
              variant={INSIGHT_VARIANT_MAP[insights[0].type] ?? "info"}
              delay={0.45}
            />
          )}
        </div>
      </div>

      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList>
          {SUB_TABS.map((tab) => {
            const TabIcon = tab.icon;
            return (
              <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
                <TabIcon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
              </TabsTrigger>
            );
          })}
          {showUtmsTab && (
            <TabsTrigger value="utms" className="gap-1.5">
              <Link className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">UTMs</span>
            </TabsTrigger>
          )}
        </TabsList>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeSubTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
          >
            <TabsContent value="overview" className="space-y-4 mt-0"><OverviewTab /></TabsContent>
            <TabsContent value="financeiro" className="space-y-4 mt-0"><FinanceiroTab /></TabsContent>
            <TabsContent value="comercial" className="space-y-4 mt-0"><ComercialTab /></TabsContent>
            <TabsContent value="pipes" className="space-y-4 mt-0"><PipesFunisTab /></TabsContent>
            <TabsContent value="engajamento" className="space-y-4 mt-0"><EngajamentoTab /></TabsContent>
            {showUtmsTab && (
              <TabsContent value="utms" className="space-y-4 mt-0"><UtmsTab /></TabsContent>
            )}
          </motion.div>
        </AnimatePresence>
      </Tabs>
    </div>
  );
}
