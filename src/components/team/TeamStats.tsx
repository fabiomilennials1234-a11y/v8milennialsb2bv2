import { motion } from "framer-motion";
import { 
  Users, 
  TrendingUp, 
  Calendar, 
  DollarSign,
  Target,
  Trophy,
  Percent,
  Activity
} from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: typeof Users;
  trend?: number;
  color?: "default" | "primary" | "success" | "warning" | "danger";
  delay?: number;
}

const colorConfig = {
  default: "bg-muted text-muted-foreground",
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-chart-5/10 text-chart-5",
  danger: "bg-destructive/10 text-destructive",
};

function StatCard({ title, value, subtitle, icon: Icon, trend, color = "default", delay = 0 }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="bg-card rounded-xl border border-border p-5 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between">
        <div className={cn("p-3 rounded-xl", colorConfig[color])}>
          <Icon className="w-5 h-5" />
        </div>
        {trend !== undefined && (
          <div className={cn(
            "flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full",
            trend >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
          )}>
            <TrendingUp className={cn("w-3 h-3", trend < 0 && "rotate-180")} />
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div className="mt-4">
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-sm text-muted-foreground mt-1">{title}</p>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>
    </motion.div>
  );
}

interface TeamStatsProps {
  stats: {
    totalMembers: number;
    activeSDRs: number;
    activeClosers: number;
    totalOTE: number;
    avgGoalProgress: number;
    topPerformerName?: string;
    totalSales?: number;
    totalMeetings?: number;
  };
}

export function TeamStats({ stats }: TeamStatsProps) {
  const formatCurrency = (value: number) => {
    if (value >= 1000000) return `R$ ${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}K`;
    return `R$ ${value.toLocaleString("pt-BR")}`;
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        title="Total Membros"
        value={stats.totalMembers}
        subtitle={`${stats.activeSDRs} SDRs, ${stats.activeClosers} Closers`}
        icon={Users}
        delay={0}
      />
      <StatCard
        title="SDRs Ativos"
        value={stats.activeSDRs}
        icon={Calendar}
        color="warning"
        delay={0.05}
      />
      <StatCard
        title="Closers Ativos"
        value={stats.activeClosers}
        icon={DollarSign}
        color="primary"
        delay={0.1}
      />
      <StatCard
        title="Folha OTE Total"
        value={formatCurrency(stats.totalOTE)}
        icon={Target}
        color="success"
        delay={0.15}
      />
    </div>
  );
}

interface PerformanceOverviewProps {
  data: {
    avgGoalProgress: number;
    totalSales: number;
    totalMeetings: number;
    conversionRate: number;
  };
}

export function PerformanceOverview({ data }: PerformanceOverviewProps) {
  const formatCurrency = (value: number) => {
    if (value >= 1000000) return `R$ ${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}K`;
    return `R$ ${value.toLocaleString("pt-BR")}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card rounded-xl border border-border p-6"
    >
      <h3 className="font-semibold mb-4 flex items-center gap-2">
        <Activity className="w-5 h-5 text-primary" />
        Performance Geral do Time
      </h3>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <span className="text-xl font-bold text-primary">{data.avgGoalProgress}%</span>
          </div>
          <p className="text-sm text-muted-foreground">Meta Média</p>
        </div>
        
        <div className="text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center mb-2">
            <DollarSign className="w-6 h-6 text-success" />
          </div>
          <p className="text-lg font-bold">{formatCurrency(data.totalSales)}</p>
          <p className="text-sm text-muted-foreground">Vendas Totais</p>
        </div>
        
        <div className="text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-chart-5/10 flex items-center justify-center mb-2">
            <Calendar className="w-6 h-6 text-chart-5" />
          </div>
          <p className="text-lg font-bold">{data.totalMeetings}</p>
          <p className="text-sm text-muted-foreground">Reuniões</p>
        </div>
        
        <div className="text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-accent flex items-center justify-center mb-2">
            <Percent className="w-6 h-6 text-accent-foreground" />
          </div>
          <p className="text-lg font-bold">{data.conversionRate}%</p>
          <p className="text-sm text-muted-foreground">Conversão</p>
        </div>
      </div>
    </motion.div>
  );
}
