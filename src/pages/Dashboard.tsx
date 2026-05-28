import { useState, lazy, Suspense, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TorqueLoader } from "@/components/branding/TorqueLoader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { TabVisaoGeral } from "@/components/dashboard/TabVisaoGeral";
import { TabPerformance } from "@/components/dashboard/TabPerformance";
import { TabInteligencia } from "@/components/dashboard/TabInteligencia";

const TabAnalyticsV2 = lazy(() => import("@/components/dashboard/TabAnalyticsV2").then(m => ({ default: m.TabAnalyticsV2 })));
import { OraculoFloatingButton } from "@/components/dashboard/OraculoFloatingButton";
import { OraculoChat } from "@/components/dashboard/OraculoChat";
import { useOraculoChat } from "@/hooks/useOraculoChat";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { useUserRole } from "@/hooks/useUserRole";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useIdentity } from "@/hooks/useIdentity";
import { Skeleton } from "@/components/ui/skeleton";
import { getDashboardTabs, getDefaultTab } from "@/lib/dashboard-tabs";
import type { DashboardTabContext } from "@/lib/dashboard-tabs";
import { CoberturaPipeline } from "@/components/dashboard/CoberturaPipeline";
import { LeadsParados } from "@/components/dashboard/LeadsParados";
import { SequenciaVitorias } from "@/components/dashboard/SequenciaVitorias";
import DashboardOutbound from "./DashboardOutbound";

const tabAnimation = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3 },
};

export default function Dashboard() {
  useAuth();
  const { orgType, isLoading: orgLoading } = useOrganization();
  const { data: userRole } = useUserRole();
  const role = userRole?.role;
  const { data: currentTeamMember, isLoading: teamMemberLoading } = useCurrentTeamMember();
  const { isMaster } = useIdentity();
  const teamMemberId = (currentTeamMember as any)?.id ?? null;

  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());

  const oraculo = useOraculoChat({ month: selectedMonth, year: selectedYear });

  const tabContext: DashboardTabContext = useMemo(() => ({
    role: isMaster ? "admin" : role === "admin" ? "admin" : role ? "member" : null,
    isMaster,
  }), [role, isMaster]);

  const tabs = useMemo(() => getDashboardTabs(tabContext), [tabContext]);
  const defaultTab = useMemo(() => getDefaultTab(tabContext), [tabContext]);
  const visibleTabs = useMemo(() => tabs.filter((t) => t.visible), [tabs]);

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

  const isUserAdmin = isMaster || role === "admin";
  const showAnalytics = isMaster;

  return (
    <div className="space-y-6 relative">
      <DashboardHeader
        month={selectedMonth}
        year={selectedYear}
        onMonthChange={(m, y) => { setSelectedMonth(m); setSelectedYear(y); }}
      />

      <Tabs defaultValue={defaultTab} className="w-full">
        <TabsList>
          {visibleTabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Tab Resultado — Camada Estratégica */}
        {isUserAdmin && (
          <TabsContent value="resultado" className="mt-6">
            <motion.div key="resultado" {...tabAnimation}>
              <TabVisaoGeral month={selectedMonth} year={selectedYear} isAdmin={isUserAdmin} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                <CoberturaPipeline month={selectedMonth} year={selectedYear} />
                <LeadsParados />
              </div>
              <div className="mt-6">
                <TabInteligencia month={selectedMonth} year={selectedYear} isAdmin={isUserAdmin} />
              </div>
              {showAnalytics && (
                <Suspense fallback={<TorqueLoader variant="inline" />}>
                  <div className="mt-6">
                    <TabAnalyticsV2 />
                  </div>
                </Suspense>
              )}
            </motion.div>
          </TabsContent>
        )}

        {/* Tab Time — Camada Tática */}
        {isUserAdmin && (
          <TabsContent value="time" className="mt-6">
            <motion.div key="time" {...tabAnimation}>
              <TabPerformance month={selectedMonth} year={selectedYear} />
            </motion.div>
          </TabsContent>
        )}

        {/* Tab Meus Números — Camada Operacional */}
        <TabsContent value="meus-numeros" className="mt-6">
          <motion.div key="meus-numeros" {...tabAnimation}>
            <TabVisaoGeral month={selectedMonth} year={selectedYear} isAdmin={false} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
              <LeadsParados memberId={teamMemberId} />
              <SequenciaVitorias memberId={teamMemberId} />
            </div>
          </motion.div>
        </TabsContent>
      </Tabs>

      <OraculoFloatingButton
        remaining={oraculo.rateLimit.remaining}
        isOpen={oraculo.isOpen}
        onClick={() => oraculo.setIsOpen(!oraculo.isOpen)}
      />
      <AnimatePresence>
        {oraculo.isOpen && (
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
