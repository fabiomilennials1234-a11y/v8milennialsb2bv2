import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { TabVisaoGeral } from "@/components/dashboard/TabVisaoGeral";
import { TabPerformance } from "@/components/dashboard/TabPerformance";
import { TabInteligencia } from "@/components/dashboard/TabInteligencia";
import { OraculoFloatingButton } from "@/components/dashboard/OraculoFloatingButton";
import { OraculoChat } from "@/components/dashboard/OraculoChat";
import { useOraculoChat } from "@/hooks/useOraculoChat";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { useUserRole } from "@/hooks/useUserRole";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { Skeleton } from "@/components/ui/skeleton";
import DashboardOutbound from "./DashboardOutbound";

export default function Dashboard() {
  const { user } = useAuth();
  const { organizationId, orgType, isLoading: orgLoading } = useOrganization();
  const { data: userRole } = useUserRole();
  const role = userRole?.role;
  const { data: currentTeamMember, isLoading: teamMemberLoading } = useCurrentTeamMember();
  const oraculo = useOraculoChat();

  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());

  // Outbound members get their own dashboard
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

  const isAdmin = role === "admin";

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
        </TabsList>

        <TabsContent value="visao-geral" className="mt-6">
          <motion.div
            key="visao-geral"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <TabVisaoGeral month={selectedMonth} year={selectedYear} isAdmin={isAdmin} />
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
            <TabInteligencia month={selectedMonth} year={selectedYear} isAdmin={isAdmin} />
          </motion.div>
        </TabsContent>
      </Tabs>

      {/* Oráculo Floating Button + Chat Modal */}
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
