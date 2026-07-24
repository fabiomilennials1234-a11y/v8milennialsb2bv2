import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { TorqueLoader } from "@/components/ui/branding/TorqueLoader";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { CommandHeader } from "@/modules/analytics/components/dashboard/v2/CommandHeader";
import { TelemetryTicker } from "@/modules/analytics/components/dashboard/v2/TelemetryTicker";
import { TabVisaoGeralV2 } from "@/modules/analytics/components/dashboard/v2/TabVisaoGeralV2";
import { TabPerformanceV2 } from "@/modules/analytics/components/dashboard/v2/TabPerformanceV2";
import { TabSaude } from "@/modules/analytics/components/dashboard/TabSaude";
import { TabMapa } from "@/modules/analytics/components/dashboard/v2/TabMapa";
import { OraculoChat } from "@/modules/analytics/components/dashboard/OraculoChat";
import { useOraculoChat } from "@/modules/copilot/hooks/useOraculoChat";
import { useOrgFeaturesOptional } from "@/contexts/OrgFeaturesContext";
import {
  computePeriodRange,
  type CommandPeriod,
  type CommandCustomRange,
} from "@/modules/analytics/hooks/useCommandMetrics";
import { useAuth } from "@/modules/identity";
import { useOrganization } from "@/modules/identity";
import { useUserRole } from "@/modules/identity";
import { useCurrentTeamMember } from "@/modules/identity";
import { useIdentity } from "@/modules/identity";
import { LeadModal } from "@/modules/leads";
import { Skeleton } from "@/components/ui/skeleton";
import DashboardOutbound from "./DashboardOutbound";

const TabAnalyticsV2 = lazy(() => import("@/modules/analytics/components/dashboard/TabAnalyticsV2").then(m => ({ default: m.TabAnalyticsV2 })));

const PERIOD_LABEL: Record<CommandPeriod, string> = {
  today: "Hoje",
  week: "Semana atual",
  month: "",
  quarter: "Trimestre atual",
  custom: "Personalizado",
};

export default function Dashboard() {
  useAuth();
  const { orgType, timezone, isLoading: orgLoading } = useOrganization();
  const { data: userRole } = useUserRole();
  const role = userRole?.role;
  const { isLoading: teamMemberLoading } = useCurrentTeamMember();
  const { isMaster } = useIdentity();

  const showAnalytics = isMaster;

  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [period, setPeriod] = useState<CommandPeriod>("month");
  const [customRange, setCustomRange] = useState<CommandCustomRange | null>(null);
  const [leadModalOpen, setLeadModalOpen] = useState(false);

  const oraculo = useOraculoChat({ month: selectedMonth, year: selectedYear });
  const setOraculoOpen = oraculo.setIsOpen;
  const openOraculo = useCallback(() => setOraculoOpen(true), [setOraculoOpen]);

  // Plan gate — Oráculo é feature de plano (só Torque Copilot).
  const orgFeatures = useOrgFeaturesOptional();
  const oraculoEnabled = orgFeatures ? orgFeatures.hasFeature("oraculo") : true;

  // ⌘J / Ctrl+J abre o Oráculo de qualquer lugar da página
  useEffect(() => {
    if (!oraculoEnabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOraculoOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOraculoOpen, oraculoEnabled]);

  const range = useMemo(
    // Fuso da org corta "Hoje"/"Semana" na fronteira de dia org-local; undefined
    // cai no fuso do browser (default do helper) enquanto o metadado não resolve.
    () => computePeriodRange(period, selectedMonth, selectedYear, customRange, timezone ?? undefined),
    [period, selectedMonth, selectedYear, customRange, timezone],
  );

  const subtitle = useMemo(() => {
    if (period === "custom") {
      if (customRange?.from && customRange?.to) {
        return `de ${format(customRange.from, "dd/MM", { locale: ptBR })} a ${format(customRange.to, "dd/MM", { locale: ptBR })}`;
      }
      return "Selecione um intervalo";
    }
    if (period === "month") {
      const monthLabel = format(new Date(selectedYear, selectedMonth - 1, 1), "MMMM yyyy", { locale: ptBR });
      const capitalized = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
      return `${capitalized} · dia ${range.dayOfPeriod}`;
    }
    return `${PERIOD_LABEL[period]} · dia ${range.dayOfPeriod} de ${range.daysTotal}`;
  }, [period, selectedMonth, selectedYear, range, customRange]);

  if (orgType === "outbound" && role === "member") {
    return <DashboardOutbound />;
  }

  if (orgLoading || teamMemberLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-96" />
        <div className="grid grid-cols-3 gap-4">
          {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  const isUserAdmin = role === "admin";

  return (
    <div className="relative">
      <Tabs defaultValue="visao-geral" className="w-full">
        <CommandHeader
          month={selectedMonth}
          year={selectedYear}
          onMonthChange={(m, y) => { setSelectedMonth(m); setSelectedYear(y); }}
          period={period}
          onPeriodChange={setPeriod}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
          onNewLead={() => setLeadModalOpen(true)}
          showAnalytics={showAnalytics}
          subtitle={subtitle}
        />

        <TelemetryTicker />

        <TabsContent value="visao-geral" className="mt-0">
          <TabVisaoGeralV2
            period={period}
            month={selectedMonth}
            year={selectedYear}
            range={range}
            isAdmin={isUserAdmin}
            onAskOraculo={openOraculo}
          />
        </TabsContent>

        <TabsContent value="performance" className="mt-0">
          <motion.div
            key="performance"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <TabPerformanceV2 month={selectedMonth} year={selectedYear} range={range} />
          </motion.div>
        </TabsContent>

        <TabsContent value="saude" className="mt-0">
          <motion.div
            key="saude"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <TabSaude range={range} />
          </motion.div>
        </TabsContent>

        <TabsContent value="mapa" className="mt-0">
          <motion.div
            key="mapa"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <TabMapa />
          </motion.div>
        </TabsContent>

        {showAnalytics && (
          <TabsContent value="analytics" className="mt-6">
            <Suspense fallback={<TorqueLoader variant="inline" />}>
              <motion.div
                key="analytics"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <TabAnalyticsV2 />
              </motion.div>
            </Suspense>
          </TabsContent>
        )}
      </Tabs>

      <LeadModal open={leadModalOpen} onOpenChange={setLeadModalOpen} />

      <AnimatePresence>
        {oraculoEnabled && oraculo.isOpen && (
          <OraculoChat
            messages={oraculo.messages}
            isLoading={oraculo.isLoading}
            rateLimit={oraculo.rateLimit}
            onSend={oraculo.sendMessage}
            onClose={() => oraculo.setIsOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
