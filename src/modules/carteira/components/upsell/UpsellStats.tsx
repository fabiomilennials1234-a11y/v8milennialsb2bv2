import {
  Users, TrendingUp, UserCheck, UserX, Trophy, Heart,
  AlertTriangle, CalendarDays, type LucideIcon,
} from "lucide-react";
import { KpiTile } from "@/components/ui/bento";
import { useUpsellMetrics } from "@/modules/carteira/hooks/useUpsellMetrics";

interface UpsellStatsProps {
  view: "base" | "gestao";
}

type Tone = "gold" | "good" | "bad" | "info" | "neutral";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/*
 * V5 (2026-10): os cartões `glass-card` viram `KpiTile`. Mesmos números e
 * subtítulos; a cor de cada um passa do texto para o chip do ícone, no tom
 * de token equivalente ao de antes (primary→ouro, success→verde,
 * chart-5→info, destructive→vermelho).
 */
export function UpsellStats({ view }: UpsellStatsProps) {
  const metrics = useUpsellMetrics();

  const baseStats: { icon: LucideIcon; label: string; value: string; subtitle: string; tone: Tone }[] = [
    {
      icon: Users,
      label: "Total de clientes",
      value: String(metrics.totalClientes),
      subtitle: `${metrics.clientesAtivos} ativos`,
      tone: "gold",
    },
    {
      icon: TrendingUp,
      label: "Vendas total",
      value: formatCurrency(metrics.vendasTotal),
      subtitle: `${metrics.totalClientes} clientes`,
      tone: "good",
    },
    {
      icon: CalendarDays,
      label: "Vendas do mês",
      value: formatCurrency(metrics.vendasMes),
      subtitle: "faturamento mensal",
      tone: "info",
    },
    {
      icon: UserCheck,
      label: "Ativos",
      value: String(metrics.clientesAtivos),
      subtitle: "clientes ativos",
      tone: "good",
    },
    {
      icon: UserX,
      label: "Inativos",
      value: String(metrics.clientesInativos),
      subtitle: "clientes inativos",
      tone: "neutral",
    },
  ];

  const gestaoStats: typeof baseStats = [
    {
      icon: Trophy,
      label: "Campeões",
      value: String(metrics.gestaoCampeoes),
      subtitle: "melhores clientes",
      tone: "good",
    },
    {
      icon: Heart,
      label: "Fiéis",
      value: String(metrics.gestaoFieis),
      subtitle: "clientes recorrentes",
      tone: "gold",
    },
    {
      icon: AlertTriangle,
      label: "Em risco",
      value: String(metrics.gestaoEmRisco),
      subtitle: "precisam de atenção",
      tone: "info",
    },
    {
      icon: UserX,
      label: "Inativos",
      value: String(metrics.gestaoInativos),
      subtitle: "sem atividade recente",
      tone: "bad",
    },
  ];

  const stats = view === "base" ? baseStats : gestaoStats;
  const gridCols = view === "base" ? "md:grid-cols-3 xl:grid-cols-5" : "md:grid-cols-4";

  return (
    <div className={`grid grid-cols-2 gap-4 ${gridCols}`}>
      {stats.map((stat) => (
        <KpiTile
          key={stat.label}
          label={stat.label}
          value={stat.value}
          icon={stat.icon}
          tone={stat.tone}
          note={stat.subtitle}
        />
      ))}
    </div>
  );
}
