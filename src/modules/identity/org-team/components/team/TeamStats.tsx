import { motion } from "framer-motion";
import { 
  Users, 
  Calendar, 
  DollarSign,
  Target,
  Percent,
  Activity
} from "lucide-react";
import { KpiTile } from "@/components/ui/bento";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: typeof Users;
  trend?: number;
  color?: "default" | "primary" | "success" | "warning" | "danger";
  delay?: number;
}

// V5: as cores do cartão viram o tom do chip do KpiTile.
const toneByColor = {
  default: "neutral",
  primary: "gold",
  success: "good",
  warning: "info",
  danger: "bad",
} as const;

function StatCard({ title, value, subtitle, icon, trend, color = "default", delay = 0 }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="min-w-0"
    >
      <KpiTile
        className="h-full"
        label={title}
        value={value}
        icon={icon}
        tone={toneByColor[color]}
        delta={trend}
        note={subtitle}
      />
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
        title="Total de membros"
        value={stats.totalMembers}
        subtitle={`${stats.activeSDRs} SDRs, ${stats.activeClosers} Closers`}
        icon={Users}
        delay={0}
      />
      <StatCard
        title="SDRs ativos"
        value={stats.activeSDRs}
        icon={Calendar}
        color="warning"
        delay={0.05}
      />
      <StatCard
        title="Closers ativos"
        value={stats.activeClosers}
        icon={DollarSign}
        color="primary"
        delay={0.1}
      />
      <StatCard
        title="Folha OTE total"
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
      className="rounded-card border border-card-border bg-card p-5 text-card-foreground shadow-relevo"
    >
      <h3 className="mb-4 flex items-center gap-2 text-base font-bold leading-tight tracking-tight">
        <Activity className="h-[18px] w-[18px] text-muted-foreground" />
        Performance geral do time
      </h3>
      
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <div className="text-center">
          <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-primary-soft">
            <span className="text-xl font-extrabold tabular-nums tracking-[-0.04em] text-primary-soft-foreground">{data.avgGoalProgress}%</span>
          </div>
          <p className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">Meta média</p>
        </div>
        
        <div className="text-center">
          <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
            <DollarSign className="h-6 w-6 text-success-strong" />
          </div>
          <p className="text-lg font-extrabold tabular-nums tracking-[-0.04em]">{formatCurrency(data.totalSales)}</p>
          <p className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">Vendas totais</p>
        </div>
        
        <div className="text-center">
          <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-insights/10">
            <Calendar className="h-6 w-6 text-insights" />
          </div>
          <p className="text-lg font-extrabold tabular-nums tracking-[-0.04em]">{data.totalMeetings}</p>
          <p className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">Reuniões</p>
        </div>
        
        <div className="text-center">
          <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Percent className="h-6 w-6 text-foreground/70" />
          </div>
          <p className="text-lg font-extrabold tabular-nums tracking-[-0.04em]">{data.conversionRate}%</p>
          <p className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">Conversão</p>
        </div>
      </div>
    </motion.div>
  );
}
