import { useState, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { TabVisaoGeral } from "@/components/dashboard/TabVisaoGeral";
import { TabPerformance } from "@/components/dashboard/TabPerformance";
import { TabInteligencia } from "@/components/dashboard/TabInteligencia";

const TabMarketing = lazy(() => import("@/components/dashboard/TabMarketing").then(m => ({ default: m.TabMarketing })));
const TabAnalytics = lazy(() => import("@/components/dashboard/TabAnalytics").then(m => ({ default: m.TabAnalytics })));
import { OraculoFloatingButton } from "@/components/dashboard/OraculoFloatingButton";
import { OraculoChat } from "@/components/dashboard/OraculoChat";
import { useOraculoChat } from "@/hooks/useOraculoChat";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { useUserRole } from "@/hooks/useUserRole";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useMasterAuth } from "@/hooks/useMasterAuth";
import { Skeleton } from "@/components/ui/skeleton";
import DashboardOutbound from "./DashboardOutbound";

export default function Dashboard() {
  useAuth();
  const { orgType, isLoading: orgLoading } = useOrganization();
  const { data: userRole } = useUserRole();
  const role = userRole?.role;
  const { isLoading: teamMemberLoading } = useCurrentTeamMember();
  const { isMaster } = useMasterAuth();

  const showMarketing = isMaster;
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
          {showMarketing && (
            <TabsTrigger value="marketing">Marketing</TabsTrigger>
          )}
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

        {showMarketing && (
          <TabsContent value="marketing" className="mt-6">
            <Suspense fallback={<div className="flex items-center justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>}>
              <motion.div
                key="marketing"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <TabMarketing month={selectedMonth} year={selectedYear} />
              </motion.div>
            </Suspense>
          </TabsContent>
        )}

        {showAnalytics && (
          <TabsContent value="analytics" className="mt-6">
            <Suspense fallback={<div className="flex items-center justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>}>
              <motion.div
                key="analytics"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <TabAnalytics />
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
