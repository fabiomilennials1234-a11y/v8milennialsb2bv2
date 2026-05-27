import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { useOutboundMetrics } from "@/hooks/useOutboundMetrics";
import { useBadges, useUserBadges } from "@/modules/engagement/hooks/useBadges";
import { useOrganization } from "@/modules/identity";
import { useMilestoneAutoUnlock } from "@/modules/engagement/hooks/useMilestoneAutoUnlock";
import { OutboundMetricCards } from "@/components/dashboard-outbound/OutboundMetricCards";
import { MilestoneTracker } from "@/components/dashboard-outbound/MilestoneTracker";
import { BadgeGrid } from "@/components/dashboard-outbound/BadgeGrid";
import { useAuth } from "@/modules/identity";
export default function DashboardOutbound() {
  const { user } = useAuth();
  const { teamMemberId } = useOrganization();
  const { data: metrics, isLoading: metricsLoading } = useOutboundMetrics();
  const { data: badges = [], isLoading: badgesLoading } = useBadges();
  const { data: userBadges = [] } = useUserBadges(teamMemberId);

  // Auto-unlock milestones on load
  useMilestoneAutoUnlock();

  const userName = user?.user_metadata?.full_name?.split(" ")[0] || "Usuário";
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  if (metricsLoading || badgesLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-6 space-y-6"
    >
      <h1 className="text-2xl font-bold">
        {greeting}, {userName}
      </h1>

      {metrics && <OutboundMetricCards metrics={metrics} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MilestoneTracker badges={badges} userBadges={userBadges} />
        <BadgeGrid badges={badges} userBadges={userBadges} />
      </div>
    </motion.div>
  );
}
