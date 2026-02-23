import { motion } from "framer-motion";
import { Target, Zap, Send, TrendingUp, BarChart3 } from "lucide-react";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { useDashboardMetrics, useFunnelData } from "@/hooks/useDashboardMetrics";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

export default function DashboardBDR() {
  const { user } = useAuth();
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const { data: metrics, isLoading: metricsLoading } = useDashboardMetrics(month, year);
  const { data: funnelData, isLoading: funnelLoading } = useFunnelData(month, year);

  const userName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "BDR";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-bold"
        >
          {getGreeting()}, {userName}
        </motion.h1>
        <p className="text-muted-foreground">Painel de Prospecção</p>
      </div>

      {/* KPIs */}
      {metricsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            title="Leads Prospectados"
            value={metrics?.totalLeads ?? 0}
            icon={Target}
          />
          <MetricCard
            title="Leads Quentes"
            value={metrics?.reunioesMarcadas ?? 0}
            icon={Zap}
          />
          <MetricCard
            title="Reuniões Comparecidas"
            value={metrics?.reunioesComparecidas ?? 0}
            icon={Send}
          />
          <MetricCard
            title="Taxa Conversão"
            value={
              metrics?.totalLeads
                ? `${((metrics.reunioesMarcadas / metrics.totalLeads) * 100).toFixed(1)}%`
                : "0%"
            }
            icon={TrendingUp}
          />
        </div>
      )}

      {/* Funil de Prospecção */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BarChart3 className="w-5 h-5 text-primary" />
            Funil de Prospecção
          </CardTitle>
        </CardHeader>
        <CardContent>
          {funnelLoading ? (
            <Skeleton className="h-48" />
          ) : funnelData && funnelData.length > 0 ? (
            <div className="grid grid-cols-4 gap-4">
              {funnelData.slice(0, 4).map((step, i) => {
                const colors = ["bg-blue-500", "bg-yellow-500", "bg-orange-500", "bg-green-500"];
                const labels = ["Contactados", "Responderam", "Interesse", "Quentes"];
                return (
                  <div key={i} className="text-center space-y-2">
                    <div className={`h-2 rounded-full ${colors[i] || "bg-gray-500"}`} />
                    <p className="text-2xl font-bold">{step.value}</p>
                    <p className="text-xs text-muted-foreground">{labels[i] || step.label}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">Sem dados disponíveis</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
