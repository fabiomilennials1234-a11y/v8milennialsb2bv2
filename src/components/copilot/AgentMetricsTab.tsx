/**
 * Aba de Métricas do Agente
 *
 * Exibe cards de métricas de performance do agente:
 * - Total de conversas
 * - Taxa de resposta
 * - Reuniões agendadas
 * - Leads qualificados
 * - Follow-ups enviados
 * - Tempo médio de resposta
 */

import { motion } from "framer-motion";
import {
  MessageSquare,
  TrendingUp,
  TrendingDown,
  Calendar,
  UserCheck,
  Clock,
  Timer,
  Users,
  BarChart3,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { useAgentMetrics, type AgentMetricsTrend } from "@/hooks/useAgentMetrics";

interface AgentMetricsTabProps {
  agentId: string;
}

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: AgentMetricsTrend;
  variant?: "default" | "primary" | "success" | "warning";
}

function MetricCard({ title, value, subtitle, icon, trend, variant = "default" }: MetricCardProps) {
  const variantStyles = {
    default: "bg-card",
    primary: "bg-millennials-yellow/10 border-millennials-yellow/20",
    success: "bg-green-500/10 border-green-500/20",
    warning: "bg-amber-500/10 border-amber-500/20",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className={`${variantStyles[variant]} transition-all hover:shadow-md`}>
        <CardContent className="pt-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{title}</p>
              <p className="text-2xl font-bold">{value}</p>
              {subtitle && (
                <p className="text-xs text-muted-foreground">{subtitle}</p>
              )}
            </div>
            <div className="p-2 rounded-lg bg-muted/50">{icon}</div>
          </div>
          
          {trend && (
            <div className="mt-3 flex items-center gap-1">
              {trend.isPositive ? (
                <TrendingUp className="w-3 h-3 text-green-500" />
              ) : (
                <TrendingDown className="w-3 h-3 text-red-500" />
              )}
              <span
                className={`text-xs font-medium ${
                  trend.isPositive ? "text-green-500" : "text-red-500"
                }`}
              >
                {trend.isPositive ? "+" : ""}
                {trend.percentChange}%
              </span>
              <span className="text-xs text-muted-foreground">vs período anterior</span>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function AgentMetricsTab({ agentId }: AgentMetricsTabProps) {
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');
  const { data: metrics, isLoading, error } = useAgentMetrics(agentId, period);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Carregando métricas...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>Erro ao carregar métricas</p>
        <p className="text-sm">Tente novamente mais tarde</p>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>Nenhuma métrica disponível</p>
        <p className="text-sm">O agente ainda não processou conversas</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header com seletor de período */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Métricas de Performance</h3>
          <p className="text-sm text-muted-foreground">
            Acompanhe o desempenho do agente
          </p>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as any)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Últimos 7 dias</SelectItem>
            <SelectItem value="30d">Últimos 30 dias</SelectItem>
            <SelectItem value="90d">Últimos 90 dias</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Grid de métricas principais */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <MetricCard
          title="Total de Conversas"
          value={metrics.totalConversations}
          icon={<MessageSquare className="w-5 h-5 text-millennials-yellow" />}
          trend={metrics.trends.conversations}
          variant="primary"
        />
        
        <MetricCard
          title="Leads Atendidos"
          value={metrics.leadsAttended}
          icon={<Users className="w-5 h-5 text-blue-500" />}
        />
        
        <MetricCard
          title="Taxa de Resposta"
          value={`${metrics.responseRate}%`}
          subtitle={`${metrics.messagesSent} enviadas / ${metrics.messagesReceived} recebidas`}
          icon={<TrendingUp className="w-5 h-5 text-green-500" />}
          trend={metrics.trends.responseRate}
          variant="success"
        />
        
        <MetricCard
          title="Reuniões Agendadas"
          value={metrics.meetingsScheduled}
          icon={<Calendar className="w-5 h-5 text-purple-500" />}
          trend={metrics.trends.meetings}
        />
        
        <MetricCard
          title="Leads Qualificados"
          value={metrics.leadsQualified}
          icon={<UserCheck className="w-5 h-5 text-emerald-500" />}
          trend={metrics.trends.qualified}
          variant="success"
        />
        
        <MetricCard
          title="Follow-ups Enviados"
          value={metrics.followupsSent}
          icon={<Clock className="w-5 h-5 text-amber-500" />}
        />
      </div>

      {/* Métricas secundárias */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Métricas Adicionais</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Tempo Médio de Resposta</p>
              <div className="flex items-center gap-2">
                <Timer className="w-4 h-4 text-muted-foreground" />
                <span className="font-semibold">{metrics.avgResponseTime}s</span>
              </div>
            </div>
            
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Taxa de Conversão</p>
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-muted-foreground" />
                <span className="font-semibold">{metrics.conversionRate}%</span>
              </div>
            </div>
            
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Mensagens Enviadas</p>
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                <span className="font-semibold">{metrics.messagesSent}</span>
              </div>
            </div>
            
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Mensagens Recebidas</p>
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                <span className="font-semibold">{metrics.messagesReceived}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Indicadores de saúde */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Indicadores de Saúde</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={metrics.responseRate >= 80 ? "default" : "secondary"}
              className={metrics.responseRate >= 80 ? "bg-green-500" : ""}
            >
              {metrics.responseRate >= 80 ? "Boa taxa de resposta" : "Taxa de resposta pode melhorar"}
            </Badge>
            
            <Badge
              variant={metrics.conversionRate >= 10 ? "default" : "secondary"}
              className={metrics.conversionRate >= 10 ? "bg-green-500" : ""}
            >
              {metrics.conversionRate >= 10 ? "Boa conversão" : "Conversão abaixo do esperado"}
            </Badge>
            
            <Badge
              variant={metrics.avgResponseTime <= 60 ? "default" : "secondary"}
              className={metrics.avgResponseTime <= 60 ? "bg-green-500" : ""}
            >
              {metrics.avgResponseTime <= 60 ? "Tempo de resposta rápido" : "Tempo de resposta alto"}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
