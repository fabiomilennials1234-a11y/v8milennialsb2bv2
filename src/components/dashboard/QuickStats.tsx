import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  Clock,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { startOfDay, endOfDay, isToday, isBefore } from "date-fns";
import { cn } from "@/lib/utils";

interface QuickStatsProps {
  className?: string;
}

export function QuickStats({ className }: QuickStatsProps) {
  const { data: stats } = useQuery({
    queryKey: ["quick-stats"],
    queryFn: async () => {
      const now = new Date();
      const todayStart = startOfDay(now).toISOString();
      const todayEnd = endOfDay(now).toISOString();

      // Meetings today
      const { count: meetingsToday } = await supabase
        .from("pipe_confirmacao")
        .select("*", { count: "exact", head: true })
        .gte("meeting_date", todayStart)
        .lte("meeting_date", todayEnd);

      // Confirmed meetings (using is_confirmed field)
      const { count: confirmedToday } = await supabase
        .from("pipe_confirmacao")
        .select("*", { count: "exact", head: true })
        .gte("meeting_date", todayStart)
        .lte("meeting_date", todayEnd)
        .eq("is_confirmed", true);

      // Pending follow-ups
      const { count: pendingFollowUps } = await supabase
        .from("follow_ups")
        .select("*", { count: "exact", head: true })
        .is("completed_at", null)
        .lte("due_date", todayEnd);

      // Overdue follow-ups
      const { count: overdueFollowUps } = await supabase
        .from("follow_ups")
        .select("*", { count: "exact", head: true })
        .is("completed_at", null)
        .lt("due_date", now.toISOString());

      // New leads today
      const { count: newLeadsToday } = await supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .gte("created_at", todayStart)
        .lte("created_at", todayEnd);

      return {
        meetingsToday: meetingsToday || 0,
        confirmedToday: confirmedToday || 0,
        pendingFollowUps: pendingFollowUps || 0,
        overdueFollowUps: overdueFollowUps || 0,
        newLeadsToday: newLeadsToday || 0,
      };
    },
    refetchInterval: 30000,
  });

  if (!stats) return null;

  const items = [
    {
      label: "Reuniões hoje",
      value: stats.meetingsToday,
      icon: Calendar,
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      label: "Confirmadas",
      value: stats.confirmedToday,
      icon: CheckCircle,
      color: "text-success",
      bg: "bg-success/10",
    },
    {
      label: "Follow-ups pendentes",
      value: stats.pendingFollowUps,
      icon: Clock,
      color: "text-warning",
      bg: "bg-warning/10",
      alert: stats.pendingFollowUps > 5,
    },
    {
      label: "Atrasados",
      value: stats.overdueFollowUps,
      icon: AlertTriangle,
      color: "text-destructive",
      bg: "bg-destructive/10",
      alert: stats.overdueFollowUps > 0,
    },
  ];

  return (
    <div className={cn("flex items-center gap-6", className)}>
      {items.map((item, index) => (
        <motion.div
          key={item.label}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
          className="flex items-center gap-2"
        >
          <div className={cn("p-1.5 rounded-md", item.bg)}>
            <item.icon className={cn("w-4 h-4", item.color)} />
          </div>
          <div>
            <p className={cn(
              "text-lg font-bold leading-none",
              item.alert && "text-destructive"
            )}>
              {item.value}
            </p>
            <p className="text-xs text-muted-foreground">{item.label}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
