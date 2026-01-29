import { motion } from "framer-motion";
import { 
  Users, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Calendar, 
  AlertTriangle,
  Briefcase
} from "lucide-react";

interface TVMetricsGridProps {
  reunioesComparecidas: number;
  taxaConversaoGeral: number;
  ticketMedioMRR: number;
  ticketMedioProjeto: number;
  noShowGeral: number;
  leadsParaTrabalhar: number;
  leadsRemarcar: number;
  leadsNovo: number;
  leadsEmContato: number;
}

function MetricCard({ 
  title, 
  value, 
  subtitle,
  icon: Icon, 
  color,
  trend,
  delay 
}: { 
  title: string; 
  value: string | number; 
  subtitle?: string;
  icon: React.ElementType; 
  color: string;
  trend?: "up" | "down" | "neutral";
  delay: number;
}) {
  const colorClasses: Record<string, string> = {
    blue: "from-blue-500/20 to-blue-600/10 border-blue-500/30 text-blue-500",
    green: "from-success/20 to-emerald-600/10 border-success/30 text-success",
    amber: "from-amber-500/20 to-orange-600/10 border-amber-500/30 text-amber-500",
    red: "from-destructive/20 to-red-600/10 border-destructive/30 text-destructive",
    purple: "from-purple-500/20 to-violet-600/10 border-purple-500/30 text-purple-500",
    primary: "from-primary/20 to-primary/10 border-primary/30 text-primary",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className={`p-4 rounded-xl bg-gradient-to-br ${colorClasses[color]} border backdrop-blur-sm`}
    >
      <div className="flex items-center justify-between">
        <div className={`p-2 rounded-lg bg-${color === "primary" ? "primary" : color}/20`}>
          <Icon className="w-5 h-5" />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs ${
            trend === "up" ? "text-success" : trend === "down" ? "text-destructive" : "text-muted-foreground"
          }`}>
            {trend === "up" ? <TrendingUp className="w-3 h-3" /> : 
             trend === "down" ? <TrendingDown className="w-3 h-3" /> : null}
          </div>
        )}
      </div>
      <p className="text-2xl font-black mt-3">{value}</p>
      <p className="text-sm text-muted-foreground">{title}</p>
      {subtitle && (
        <p className="text-xs text-muted-foreground/70 mt-1">{subtitle}</p>
      )}
    </motion.div>
  );
}

export function TVMetricsGrid({
  reunioesComparecidas,
  taxaConversaoGeral,
  ticketMedioMRR,
  ticketMedioProjeto,
  noShowGeral,
  leadsParaTrabalhar,
  leadsRemarcar,
  leadsNovo,
  leadsEmContato,
}: TVMetricsGridProps) {
  const formatCurrency = (value: number) => {
    if (value >= 1000) return `R$ ${(value / 1000).toFixed(1)}K`;
    return `R$ ${value.toFixed(0)}`;
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <MetricCard
        title="Reuniões Comparecidas"
        value={reunioesComparecidas}
        icon={Calendar}
        color="blue"
        delay={0.1}
      />
      
      <MetricCard
        title="Conversão Geral"
        value={`${taxaConversaoGeral.toFixed(1)}%`}
        icon={TrendingUp}
        color="green"
        trend={taxaConversaoGeral >= 20 ? "up" : taxaConversaoGeral < 10 ? "down" : "neutral"}
        delay={0.2}
      />
      
      <MetricCard
        title="Ticket Médio MRR"
        value={formatCurrency(ticketMedioMRR)}
        icon={DollarSign}
        color="primary"
        delay={0.3}
      />
      
      <MetricCard
        title="Ticket Médio Projeto"
        value={formatCurrency(ticketMedioProjeto)}
        icon={Briefcase}
        color="purple"
        delay={0.4}
      />
      
      <MetricCard
        title="No-Show Geral"
        value={`${noShowGeral.toFixed(1)}%`}
        icon={AlertTriangle}
        color={noShowGeral > 30 ? "red" : "amber"}
        trend={noShowGeral <= 20 ? "up" : noShowGeral > 30 ? "down" : "neutral"}
        delay={0.5}
      />
      
      <MetricCard
        title="Leads para Trabalhar"
        value={leadsParaTrabalhar}
        subtitle={`${leadsRemarcar} remarcar · ${leadsNovo} novo · ${leadsEmContato} contato`}
        icon={Users}
        color={leadsParaTrabalhar > 20 ? "red" : leadsParaTrabalhar > 10 ? "amber" : "green"}
        delay={0.6}
      />
    </div>
  );
}
