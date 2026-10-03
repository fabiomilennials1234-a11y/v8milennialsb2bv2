/**
 * Página: Dashboard de Métricas LLM
 *
 * Item #20: Exibe métricas de qualidade das respostas dos agentes via LLM-as-a-judge.
 * Inclui: scores por dimensão, comparação A/B, qualificação, agendamentos.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import {
  BarChart3,
  Bot,
  Star,
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  Calendar,
  FlaskConical,
  MessageSquare,
  Activity,
  ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Tipos ─────────────────────────────────────────────────────────────────

interface EvaluationRow {
  agent_id: string;
  score_relevance: number;
  score_tone: number;
  score_goal_align: number;
  score_conciseness: number;
  score_overall: number;
  evaluated_at: string;
}

interface AgentSummary {
  agent_id: string;
  agent_name: string;
  evaluations: number;
  avg_overall: number;
  avg_relevance: number;
  avg_tone: number;
  avg_goal_align: number;
  avg_conciseness: number;
  trend: 'up' | 'down' | 'stable';
}

interface VariantMetrics {
  id: string;
  name: string;
  is_control: boolean;
  total_conversations: number;
  avg_score_overall: number;
  avg_score_goal_align: number;
  qualification_rate: number;
  meetings_scheduled: number;
}

// ─── Hook de dados ──────────────────────────────────────────────────────────

function useCopilotMetrics(orgId?: string, agentId?: string, days = 30) {
  return useQuery({
    queryKey: ["copilot_metrics", orgId, agentId, days],
    enabled: !!orgId,
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86400000).toISOString();

      // Buscar avaliações
      let evalQuery = supabase
        .from("copilot_conversation_evaluations")
        .select("agent_id, score_relevance, score_tone, score_goal_align, score_conciseness, score_overall, evaluated_at")
        .eq("organization_id", orgId!)
        .gte("evaluated_at", since)
        .order("evaluated_at", { ascending: false });

      if (agentId && agentId !== "all") evalQuery = evalQuery.eq("agent_id", agentId);

      const { data: evaluations } = await evalQuery;

      // Buscar agentes (para nome)
      const { data: agents } = await supabase
        .from("copilot_agents")
        .select("id, name")
        .eq("organization_id", orgId!);

      // Buscar variantes A/B
      let varQuery = supabase
        .from("copilot_agent_variants")
        .select("id, name, is_control, total_conversations, avg_score_overall, avg_score_goal_align, qualification_rate, meetings_scheduled, agent_id")
        .eq("organization_id", orgId!);

      if (agentId && agentId !== "all") varQuery = varQuery.eq("agent_id", agentId);
      const { data: variants } = await varQuery;

      // Buscar contagem de leads qualificados (para qualification_rate geral)
      const { count: qualifiedLeads } = await supabase
        .from("leads")
        .select("id", { count: "exact" })
        .eq("organization_id", orgId!)
        .not("qualification_score", "is", null)
        .gte("qualification_score", 70)
        .gte("created_at", since);

      const { count: totalLeads } = await supabase
        .from("leads")
        .select("id", { count: "exact" })
        .eq("organization_id", orgId!)
        .gte("created_at", since);

      return {
        evaluations: (evaluations || []) as EvaluationRow[],
        agents: (agents || []) as Array<{ id: string; name: string }>,
        variants: (variants || []) as VariantMetrics[],
        qualifiedLeads: qualifiedLeads || 0,
        totalLeads: totalLeads || 0,
      };
    },
  });
}

// ─── Funções auxiliares ─────────────────────────────────────────────────────

function computeAgentSummaries(
  evaluations: EvaluationRow[],
  agents: Array<{ id: string; name: string }>
): AgentSummary[] {
  const byAgent: Record<string, EvaluationRow[]> = {};
  for (const e of evaluations) {
    if (!byAgent[e.agent_id]) byAgent[e.agent_id] = [];
    byAgent[e.agent_id].push(e);
  }

  return Object.entries(byAgent).map(([agentId, rows]) => {
    const agent = agents.find(a => a.id === agentId);
    const avg = (field: keyof EvaluationRow) =>
      rows.reduce((s, r) => s + (Number(r[field]) || 0), 0) / rows.length;

    // Tendência: compara primeira vs última metade
    const half = Math.floor(rows.length / 2);
    const recent = rows.slice(0, half);
    const old = rows.slice(half);
    const recentAvg = recent.length ? recent.reduce((s, r) => s + r.score_overall, 0) / recent.length : 0;
    const oldAvg = old.length ? old.reduce((s, r) => s + r.score_overall, 0) / old.length : recentAvg;
    const diff = recentAvg - oldAvg;
    const trend = diff > 0.3 ? 'up' : diff < -0.3 ? 'down' : 'stable';

    return {
      agent_id: agentId,
      agent_name: agent?.name || "Agente desconhecido",
      evaluations: rows.length,
      avg_overall: avg("score_overall"),
      avg_relevance: avg("score_relevance"),
      avg_tone: avg("score_tone"),
      avg_goal_align: avg("score_goal_align"),
      avg_conciseness: avg("score_conciseness"),
      trend,
    };
  });
}

function scoreColor(score: number): string {
  if (score >= 8) return "text-green-500";
  if (score >= 6) return "text-yellow-500";
  return "text-red-500";
}

function scoreBg(score: number): string {
  if (score >= 8) return "bg-green-50 border-green-200";
  if (score >= 6) return "bg-yellow-50 border-yellow-200";
  return "bg-red-50 border-red-200";
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  const pct = (score / 10) * 100;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-semibold ${scoreColor(score)}`}>{score.toFixed(1)}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${score >= 8 ? "bg-success" : score >= 6 ? "bg-warning" : "bg-destructive"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'stable' }) {
  if (trend === 'up') return <TrendingUp className="w-4 h-4 text-green-500" />;
  if (trend === 'down') return <TrendingDown className="w-4 h-4 text-red-500" />;
  return <Minus className="w-4 h-4 text-muted-foreground" />;
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function CopilotMetrics() {
  const { data: teamMember } = useCurrentTeamMember();
  const orgId = teamMember?.organization_id;
  const [selectedAgent, setSelectedAgent] = useState("all");
  const [days, setDays] = useState(30);

  const { data, isLoading } = useCopilotMetrics(orgId, selectedAgent, days);

  const agentSummaries = data ? computeAgentSummaries(data.evaluations, data.agents) : [];
  const globalAvg = agentSummaries.length
    ? agentSummaries.reduce((s, a) => s + a.avg_overall, 0) / agentSummaries.length
    : 0;
  const totalEvals = data?.evaluations.length || 0;
  const qualRate = data?.totalLeads
    ? ((data.qualifiedLeads / data.totalLeads) * 100).toFixed(1)
    : "0.0";
  const variants = (data?.variants || []).filter(v => v.total_conversations > 0);

  return (
    <div className="copilot-surface space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" />
            Métricas LLM
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Qualidade das respostas dos agentes avaliada automaticamente por IA
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 dias</SelectItem>
              <SelectItem value="30">30 dias</SelectItem>
              <SelectItem value="90">90 dias</SelectItem>
            </SelectContent>
          </Select>

          <Select value={selectedAgent} onValueChange={setSelectedAgent}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Todos os agentes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os agentes</SelectItem>
              {(data?.agents || []).map(a => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            {isLoading ? <Skeleton className="h-16" /> : (
              <>
                <p className="text-sm text-muted-foreground">Score Geral</p>
                <p className={`text-2xl font-bold ${scoreColor(globalAvg)}`}>
                  {globalAvg.toFixed(1)}<span className="text-base text-muted-foreground">/10</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">Média LLM-as-a-judge</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            {isLoading ? <Skeleton className="h-16" /> : (
              <>
                <p className="text-sm text-muted-foreground">Avaliações</p>
                <p className="text-2xl font-bold">{totalEvals.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">Últimos {days} dias</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            {isLoading ? <Skeleton className="h-16" /> : (
              <>
                <p className="text-sm text-muted-foreground">Taxa de Qualificação</p>
                <p className="text-2xl font-bold text-blue-600">{qualRate}%</p>
                <p className="text-xs text-muted-foreground mt-1">Leads qualificados (score ≥ 70)</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            {isLoading ? <Skeleton className="h-16" /> : (
              <>
                <p className="text-sm text-muted-foreground">Agentes Ativos</p>
                <p className="text-2xl font-bold">{agentSummaries.length}</p>
                <p className="text-xs text-muted-foreground mt-1">Com avaliações no período</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Scores por Agente */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="w-5 h-5" />
              Score por Agente
            </CardTitle>
            <CardDescription>Qualidade média das respostas por agente</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)
            ) : agentSummaries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Nenhuma avaliação no período</p>
                <p className="text-xs mt-1">As avaliações são geradas automaticamente a cada 3 turnos de conversa</p>
              </div>
            ) : (
              agentSummaries.map(agent => (
                <div key={agent.agent_id} className={`p-4 rounded-lg border ${scoreBg(agent.avg_overall)}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Bot className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{agent.agent_name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <TrendIcon trend={agent.trend} />
                      <Badge variant="outline" className="text-xs">
                        {agent.evaluations} avaliações
                      </Badge>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <ScoreBar score={agent.avg_relevance} label="Relevância" />
                    <ScoreBar score={agent.avg_tone} label="Tom" />
                    <ScoreBar score={agent.avg_goal_align} label="Alinhamento com objetivo" />
                    <ScoreBar score={agent.avg_conciseness} label="Concisão" />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* A/B Testing */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="w-5 h-5" />
              A/B Testing
            </CardTitle>
            <CardDescription>Comparação de variantes de prompt</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 mb-3" />)
            ) : variants.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FlaskConical className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Nenhum experimento ativo</p>
                <p className="text-xs mt-1">Configure variantes de prompt nas configurações do agente</p>
              </div>
            ) : (
              <div className="space-y-3">
                {variants.map(v => (
                  <div key={v.id} className="p-4 rounded-lg border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">{v.name}</span>
                      {v.is_control && (
                        <Badge variant="secondary" className="text-xs">Controle</Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">Score Geral</p>
                        <p className={`font-bold ${scoreColor(v.avg_score_overall)}`}>
                          {Number(v.avg_score_overall).toFixed(1)}/10
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Alinhamento</p>
                        <p className={`font-bold ${scoreColor(v.avg_score_goal_align)}`}>
                          {Number(v.avg_score_goal_align).toFixed(1)}/10
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Conversas</p>
                        <p className="font-bold">{v.total_conversations}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Taxa Qualif.</p>
                        <p className="font-bold text-blue-600">{Number(v.qualification_rate).toFixed(1)}%</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Últimas avaliações */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Últimas Avaliações
          </CardTitle>
          <CardDescription>Detalhamento das avaliações mais recentes com pontos de melhoria</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 mb-2" />)
          ) : (data?.evaluations || []).length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Nenhuma avaliação ainda</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(data?.evaluations || []).slice(0, 10).map((ev, i) => {
                const agent = data?.agents.find(a => a.id === ev.agent_id);
                return (
                  <div key={i} className={`flex items-center justify-between p-3 rounded-lg border ${scoreBg(ev.score_overall)}`}>
                    <div className="flex items-center gap-3">
                      <span className={`text-lg font-bold ${scoreColor(ev.score_overall)}`}>
                        {Number(ev.score_overall).toFixed(1)}
                      </span>
                      <div>
                        <p className="text-sm font-medium">{agent?.name || "Agente"}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(ev.evaluated_at).toLocaleString("pt-BR")}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>Rel: <strong className={scoreColor(ev.score_relevance)}>{Number(ev.score_relevance).toFixed(1)}</strong></span>
                      <span>Tom: <strong className={scoreColor(ev.score_tone)}>{Number(ev.score_tone).toFixed(1)}</strong></span>
                      <span>Obj: <strong className={scoreColor(ev.score_goal_align)}>{Number(ev.score_goal_align).toFixed(1)}</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
