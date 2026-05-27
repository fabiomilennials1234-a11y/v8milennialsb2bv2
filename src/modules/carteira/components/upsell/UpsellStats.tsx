import { motion } from "framer-motion";
import {
  Users, TrendingUp, UserCheck, UserX, Trophy, Heart,
  AlertTriangle, CalendarDays
} from "lucide-react";
import { useUpsellMetrics } from "@/modules/carteira/hooks/useUpsellMetrics";

interface UpsellStatsProps {
  view: "base" | "gestao";
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function UpsellStats({ view }: UpsellStatsProps) {
  const metrics = useUpsellMetrics();

  const baseStats = [
    {
      icon: Users,
      label: "Total Clientes",
      value: String(metrics.totalClientes),
      subtitle: `${metrics.clientesAtivos} ativos`,
      color: "text-primary",
    },
    {
      icon: TrendingUp,
      label: "Vendas Total",
      value: formatCurrency(metrics.vendasTotal),
      subtitle: `${metrics.totalClientes} clientes`,
      color: "text-success",
      valueColor: "text-success",
    },
    {
      icon: CalendarDays,
      label: "Vendas do Mês",
      value: formatCurrency(metrics.vendasMes),
      subtitle: "faturamento mensal",
      color: "text-chart-5",
      valueColor: "text-chart-5",
    },
    {
      icon: UserCheck,
      label: "Ativos",
      value: String(metrics.clientesAtivos),
      subtitle: "clientes ativos",
      color: "text-emerald-500",
    },
    {
      icon: UserX,
      label: "Inativos",
      value: String(metrics.clientesInativos),
      subtitle: "clientes inativos",
      color: "text-muted-foreground",
    },
  ];

  const gestaoStats = [
    {
      icon: Trophy,
      label: "Campeões",
      value: String(metrics.gestaoCampeoes),
      subtitle: "melhores clientes",
      color: "text-success",
      valueColor: "text-success",
    },
    {
      icon: Heart,
      label: "Fiéis",
      value: String(metrics.gestaoFieis),
      subtitle: "clientes recorrentes",
      color: "text-primary",
      valueColor: "text-primary",
    },
    {
      icon: AlertTriangle,
      label: "Em Risco",
      value: String(metrics.gestaoEmRisco),
      subtitle: "precisam de atenção",
      color: "text-chart-5",
      valueColor: "text-chart-5",
    },
    {
      icon: UserX,
      label: "Inativos",
      value: String(metrics.gestaoInativos),
      subtitle: "sem atividade recente",
      color: "text-destructive",
      valueColor: "text-destructive",
    },
  ];

  const stats = view === "base" ? baseStats : gestaoStats;
  const gridCols = view === "base" ? "md:grid-cols-5" : "md:grid-cols-4";

  return (
    <div className={`grid grid-cols-2 ${gridCols} gap-4`}>
      {stats.map((stat, index) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
          className="glass-card p-4"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <stat.icon className={`w-4 h-4 ${stat.color}`} />
          </div>
          <p className={`text-xl font-bold ${stat.valueColor || ""}`}>{stat.value}</p>
          <p className="text-xs text-muted-foreground">{stat.subtitle}</p>
        </motion.div>
      ))}
    </div>
  );
}
