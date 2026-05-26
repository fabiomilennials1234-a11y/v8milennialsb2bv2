import { useState, lazy, Suspense } from "react";
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
import { useAuth } from "@/modules/identity";
import { useOrganization } from "@/modules/identity";
import { useUserRole } from "@/modules/identity";
import { useCurrentTeamMember } from "@/modules/identity";
import { useIdentity } from "@/modules/identity";
import { Skeleton } from "@/components/ui/skeleton";
import DashboardOutbound from "./DashboardOutbound";

export default function Dashboard() {
  useAuth();
  const { orgType, isLoading: orgLoading } = useOrganization();
  const { data: userRole } = useUserRole();
  const role = userRole?.role;
  const { isLoading: teamMemberLoading } = useCurrentTeamMember();
  const { isMaster } = useIdentity();

  const showAnalytics = isMaster;

  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());

  const oraculo = useOraculoChat({ month: selectedMonth, year: selectedYear });

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
    <div className="space-y-6 relative">
      <DashboardHeader
        month={selectedMonth}
        year={selectedYear}
        onMonthChange={(m, y) => { setSelectedMonth(m); setSelectedYear(y); }}
      />

      <Tabs defaultValue="visao-geral" className="w-full">
        <TabsList>
          <TabsTrigger value="visao-geral">Visão Geral</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="inteligencia">Inteligência</TabsTrigger>
          {showAnalytics && (
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="visao-geral" className="mt-6">
          <motion.div
            key="visao-geral"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <TabVisaoGeral month={selectedMonth} year={selectedYear} isAdmin={isUserAdmin} />
          </motion.div>
        </TabsContent>

        <TabsContent value="performance" className="mt-6">
          <motion.div
            key="performance"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <TabPerformance month={selectedMonth} year={selectedYear} />
          </motion.div>
        </TabsContent>

        <TabsContent value="inteligencia" className="mt-6">
          <motion.div
            key="inteligencia"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <TabInteligencia month={selectedMonth} year={selectedYear} isAdmin={isUserAdmin} />
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
