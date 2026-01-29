import { motion } from "framer-motion";
import { 
  Calendar, 
  CheckCircle2, 
  Clock, 
  TrendingUp, 
  AlertTriangle,
  CalendarCheck,
  CalendarX,
  Users,
  Target
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { isToday, isTomorrow, isPast, isThisWeek, differenceInDays } from "date-fns";

interface ConfirmacaoStatsProps {
  data: any[];
}

export function ConfirmacaoStats({ data }: ConfirmacaoStatsProps) {
  if (!data || data.length === 0) {
    return null;
  }

  // Calculate comprehensive stats
  const today = new Date();
  
  const stats = {
    // Reuniões por período
    today: data.filter(item => item.meeting_date && isToday(new Date(item.meeting_date))).length,
    tomorrow: data.filter(item => item.meeting_date && isTomorrow(new Date(item.meeting_date))).length,
    thisWeek: data.filter(item => item.meeting_date && isThisWeek(new Date(item.meeting_date), { locale: undefined })).length,
    overdue: data.filter(item => item.meeting_date && isPast(new Date(item.meeting_date)) && !isToday(new Date(item.meeting_date)) && !["compareceu", "perdido"].includes(item.status)).length,
    
    // Por status - usando is_confirmed para identificar confirmados
    confirmed: data.filter(item => item.is_confirmed === true || item.status === "compareceu").length,
    pending: data.filter(item => !item.is_confirmed && ["reuniao_marcada", "confirmar_d5", "confirmar_d3", "confirmar_d1", "confirmacao_no_dia"].includes(item.status)).length,
    compareceu: data.filter(item => item.status === "compareceu").length,
    perdido: data.filter(item => item.status === "perdido").length,
    remarcar: data.filter(item => item.status === "remarcar").length,
    
    // Taxas
    total: data.length,
  };

  // Cálculo de no-show: apenas leads finalizados (remarcar + compareceu + perdido)
  const finalizados = stats.remarcar + stats.compareceu + stats.perdido;
  const noShowCount = stats.remarcar + stats.perdido;
  const noShowRate = finalizados > 0 ? Math.round((noShowCount / finalizados) * 100) : 0;
  const showRate = finalizados > 0 ? Math.round((stats.compareceu / finalizados) * 100) : 0;
  
  const pendingRate = stats.total > 0 ? Math.round((stats.pending / stats.total) * 100) : 0;

  // Próximas urgentes (D-3, D-1, hoje)
  const urgent = data.filter(item => {
    if (!item.meeting_date) return false;
    const days = differenceInDays(new Date(item.meeting_date), today);
    return days >= 0 && days <= 3 && !["compareceu", "perdido"].includes(item.status);
  }).length;

  const statCards = [
    {
      title: "Reuniões Hoje",
      value: stats.today,
      icon: Calendar,
      color: "text-primary",
      bgColor: "bg-primary/10",
      description: stats.today > 0 ? "Fique atento!" : "Nenhuma reunião",
    },
    {
      title: "Amanhã",
      value: stats.tomorrow,
      icon: CalendarCheck,
      color: "text-chart-2",
      bgColor: "bg-chart-2/10",
      description: "Prepare-se",
    },
    {
      title: "Urgentes (D-3)",
      value: urgent,
      icon: AlertTriangle,
      color: urgent > 0 ? "text-warning" : "text-muted-foreground",
      bgColor: urgent > 0 ? "bg-warning/10" : "bg-muted",
      description: "Próximos 3 dias",
    },
    {
      title: "Atrasadas",
      value: stats.overdue,
      icon: CalendarX,
      color: stats.overdue > 0 ? "text-destructive" : "text-success",
      bgColor: stats.overdue > 0 ? "bg-destructive/10" : "bg-success/10",
      description: stats.overdue > 0 ? "Atenção necessária" : "Tudo em dia!",
    },
  ];

  const performanceCards = [
    {
      title: "Compareceram",
      value: stats.compareceu,
      percentage: showRate,
      icon: CheckCircle2,
      color: "text-success",
      bgColor: "bg-success/10",
      progressColor: "bg-success",
      description: `${stats.compareceu} de ${finalizados} finalizados`,
    },
    {
      title: "No-Show",
      value: noShowCount,
      percentage: noShowRate,
      icon: CalendarX,
      color: "text-destructive",
      bgColor: "bg-destructive/10",
      progressColor: "bg-destructive",
      description: `Remarcar (${stats.remarcar}) + Perdidos (${stats.perdido})`,
    },
    {
      title: "Pendentes",
      value: stats.pending,
      percentage: pendingRate,
      icon: Clock,
      color: "text-warning",
      bgColor: "bg-warning/10",
      progressColor: "bg-warning",
      description: "Aguardando confirmação",
    },
    {
      title: "Remarcar",
      value: stats.remarcar,
      icon: Calendar,
      color: "text-orange-500",
      bgColor: "bg-orange-500/10",
      description: "Precisam reagendar",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Main Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((stat, idx) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
          >
            <Card className="p-4 hover:shadow-lg transition-all duration-300 hover:-translate-y-1 border-border/50">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.title}</p>
                  <p className="text-3xl font-bold mt-1">{stat.value}</p>
                  <p className={cn("text-xs mt-1", stat.color)}>{stat.description}</p>
                </div>
                <div className={cn("p-3 rounded-xl", stat.bgColor)}>
                  <stat.icon className={cn("w-5 h-5", stat.color)} />
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Performance Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {performanceCards.map((card, idx) => (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4 + idx * 0.1 }}
          >
            <Card className="p-4 border-border/50">
              <div className="flex items-center gap-3 mb-3">
                <div className={cn("p-2 rounded-lg", card.bgColor)}>
                  <card.icon className={cn("w-4 h-4", card.color)} />
                </div>
                <span className="text-sm font-medium">{card.title}</span>
              </div>
              <div className="flex items-end justify-between">
                <p className="text-2xl font-bold">{card.value}</p>
                {card.percentage !== undefined && (
                  <span className={cn("text-sm font-medium", card.color)}>
                    {card.percentage}%
                  </span>
                )}
              </div>
              {card.progressColor && (
                <div className="mt-3">
                  <Progress 
                    value={card.percentage || 0} 
                    className="h-1.5"
                  />
                </div>
              )}
              {card.description && (
                <p className="text-xs text-muted-foreground mt-2">{card.description}</p>
              )}
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Overall Performance - Show Rate based on finalized only */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
      >
        <Card className="p-6 bg-gradient-to-r from-primary/5 via-transparent to-success/5 border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-primary/10">
                <Target className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Taxa de Comparecimento</h3>
                <p className="text-sm text-muted-foreground">
                  {stats.compareceu} de {finalizados} leads finalizados compareceram
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className={cn(
                "text-4xl font-bold",
                showRate >= 70 ? "text-success" : showRate >= 50 ? "text-warning" : "text-destructive"
              )}>
                {showRate}%
              </p>
              <p className="text-sm text-muted-foreground">
                {showRate >= 70 ? "Excelente!" : showRate >= 50 ? "Bom" : "Precisa melhorar"}
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-success">Compareceram: {showRate}%</span>
              <span className="text-destructive">No-Show: {noShowRate}%</span>
            </div>
            <div className="flex h-3 rounded-full overflow-hidden bg-muted">
              <div 
                className="bg-success transition-all" 
                style={{ width: `${showRate}%` }} 
              />
              <div 
                className="bg-destructive transition-all" 
                style={{ width: `${noShowRate}%` }} 
              />
            </div>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
