import { motion } from "framer-motion";
import { User, Calendar, DollarSign, FileText, X, Clock } from "lucide-react";
import { useRecentActivity, Activity } from "@/hooks/useRecentActivity";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const iconMap = {
  user: User,
  calendar: Calendar,
  dollar: DollarSign,
  file: FileText,
  x: X,
};

const colorMap = {
  primary: "bg-primary/10 text-primary border-primary/20",
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-chart-5/10 text-chart-5 border-chart-5/20",
  destructive: "bg-destructive/10 text-destructive border-destructive/20",
  muted: "bg-muted text-muted-foreground border-muted",
};

function ActivityItem({ activity, index }: { activity: Activity; index: number }) {
  const Icon = iconMap[activity.icon];

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors group"
    >
      <div
        className={cn(
          "p-2 rounded-full border shrink-0",
          colorMap[activity.color]
        )}
      >
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{activity.title}</p>
        <p className="text-xs text-muted-foreground truncate">
          {activity.description}
        </p>
        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span>{activity.relativeTime}</span>
        </div>
      </div>
      {activity.value && (
        <div className="text-right shrink-0">
          <span className="text-sm font-semibold text-success">
            R$ {activity.value.toLocaleString("pt-BR")}
          </span>
        </div>
      )}
    </motion.div>
  );
}

export function ActivityFeed() {
  const { data: activities, isLoading } = useRecentActivity(8);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array(4).fill(0).map((_, i) => (
          <div key={i} className="flex items-start gap-3 p-3">
            <Skeleton className="w-8 h-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!activities || activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="p-3 rounded-full bg-muted mb-3">
          <Clock className="w-6 h-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          Nenhuma atividade recente
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[350px]">
      <div className="space-y-1 pr-4">
        {activities.map((activity, index) => (
          <ActivityItem key={activity.id} activity={activity} index={index} />
        ))}
      </div>
    </ScrollArea>
  );
}
