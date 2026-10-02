/**
 * Página: Dashboard de Métricas LLM
 *
 * Item #20: Exibe métricas de qualidade das respostas dos agentes via LLM-as-a-judge.
 * Inclui: scores por dimensão, comparação A/B, qualificação, agendamentos.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { QUALIFIED_TIER_FILTER } from "@/modules/copilot/lib/qualified-leads-filter";
import { useCurrentTeamMember } from "@/modules/identity";
import {
  Bot,
  Star,
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  FlaskConical,
  MessageSquare,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { IconChip, KpiRow, KpiTile, ValueUnit } from "@/components/ui/bento";
import { PageHeader } from "@/components/ui/page-header";
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

      // Leads qualificados = régua de "Boas avaliações" (tier efetivo
      // prata/ouro/diamante). Ver lib/qualified-leads-filter.ts.
      const { count: qualifiedLeads } = await supabase
        .from("leads")
        .select("id", { count: "exact" })
        .eq("organization_id", orgId!)
        .or(QUALIFIED_TIER_FILTER)
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

// Só tokens: o par claro/escuro vem do tema, não de uma escala de cor crua.
function scoreColor(score: number): string {
  if (score >= 8) return "text-success";
  if (score >= 6) return "text-warning-strong";
  return "text-destructive";
}

function scoreBg(score: number): string {
  if (score >= 8) return "bg-success/[.06] border-success/20";
  if (score >= 6) return "bg-warning/10 border-warning/25";
  return "bg-destructive/[.06] border-destructive/20";
}

function scoreTone(score: number): "good" | "gold" | "bad" {
  if (score >= 8) return "good";
  if (score >= 6) return "gold";
  return "bad";
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  const pct = (score / 10) * 100;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[13px]">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-bold tabular-nums ${scoreColor(score)}`}>{score.toFixed(1)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${score >= 8 ? "bg-success" : score >= 6 ? "bg-warning" : "bg-destructive"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'stable' }) {
  if (trend === 'up') return <TrendingUp className="w-4 h-4 text-success" aria-label="Em alta" />;
  if (trend === 'down') return <TrendingDown className="w-4 h-4 text-destructive" aria-label="Em queda" />;
  return <Minus className="w-4 h-4 text-muted-foreground" aria-label="Estável" />;
}

/** Ícone do título do cartão num chip neutro — o vocabulário do bento. */
function TitleChip({ icon: Icon }: { icon: typeof Bot }) {
  return (
    <IconChip icon={Icon} />
  );
}

const MICRO_LABEL = "text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground";

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

  const kpi = (v: React.ReactNode) => (isLoading ? "·" : v);

  return (
    <div className="space-y-5">
      <PageHeader
        back="/copilot"
        title="Métricas LLM"
        subtitle="Qualidade das respostas dos agentes avaliada automaticamente por IA"
        actions={
          <>
            <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
              <SelectTrigger className="h-10 w-32 rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 dias</SelectItem>
                <SelectItem value="30">30 dias</SelectItem>
                <SelectItem value="90">90 dias</SelectItem>
              </SelectContent>
            </Select>

            <Select value={selectedAgent} onValueChange={setSelectedAgent}>
              <SelectTrigger className="h-10 w-48 rounded-full">
                <SelectValue placeholder="Todos os agentes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os agentes</SelectItem>
                {(data?.agents || []).map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />

      {/* KPIs — mesmos quatro números de antes, da mesma consulta. */}
      <KpiRow cols={4}>
        <KpiTile
          label="Score Geral"
          icon={Star}
          tone={isLoading ? "neutral" : scoreTone(globalAvg)}
          loading={isLoading}
          value={kpi(
            <span className={scoreColor(globalAvg)}>
              {globalAvg.toFixed(1)}
              <ValueUnit>/10</ValueUnit>
            </span>,
          )}
          note="Média LLM-as-a-judge"
        />
        <KpiTile
          label="Avaliações"
          icon={MessageSquare}
          tone="neutral"
          loading={isLoading}
          value={kpi(totalEvals.toLocaleString("pt-BR"))}
          note={`Últimos ${days} dias`}
        />
        {/* Qualificação, não score (CTO, 02/10): tier efetivo prata/ouro/diamante
            sobre o mesmo denominador de antes — leads criados no período. */}
        <KpiTile
          label="Taxa de Qualificação"
          icon={Users}
          tone="info"
          loading={isLoading}
          value={kpi(
            <span className="text-insights">
              {qualRate}
              <ValueUnit>%</ValueUnit>
            </span>,
          )}
          note="Leads com qualificação Prata, Ouro ou Diamante"
        />
        <KpiTile
          label="Agentes Ativos"
          icon={Bot}
          tone="gold"
          loading={isLoading}
          value={kpi(agentSummaries.length)}
          note="Com avaliações no período"
        />
      </KpiRow>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Scores por Agente */}
        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <TitleChip icon={Bot} />
            <div className="min-w-0">
              <CardTitle>Score por Agente</CardTitle>
              <CardDescription className="text-xs">Qualidade média das respostas por agente</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)
            ) : agentSummaries.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <Activity className="mx-auto mb-2 h-8 w-8 opacity-50" />
                <p className="text-sm font-semibold text-foreground/80">Nenhuma avaliação no período</p>
                <p className="mt-1 text-xs">As avaliações são geradas automaticamente a cada 3 turnos de conversa</p>
              </div>
            ) : (
              agentSummaries.map(agent => (
                <div key={agent.agent_id} className={`rounded-2xl border p-4 ${scoreBg(agent.avg_overall)}`}>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm font-bold">{agent.agent_name}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <TrendIcon trend={agent.trend} />
                      <Badge variant="soft" className="text-[11px] tabular-nums">
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
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <TitleChip icon={FlaskConical} />
            <div className="min-w-0">
              <CardTitle>A/B Testing</CardTitle>
              <CardDescription className="text-xs">Comparação de variantes de prompt</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="mb-3 h-24 rounded-2xl" />)
            ) : variants.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <FlaskConical className="mx-auto mb-2 h-8 w-8 opacity-50" />
                <p className="text-sm font-semibold text-foreground/80">Nenhum experimento ativo</p>
                <p className="mt-1 text-xs">Configure variantes de prompt nas configurações do agente</p>
              </div>
            ) : (
              <div className="space-y-3">
                {variants.map(v => (
                  <div key={v.id} className="rounded-2xl border border-border/70 bg-sunken p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold">{v.name}</span>
                      {v.is_control && (
                        <Badge variant="ink" className="text-[11px]">Controle</Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className={MICRO_LABEL}>Score Geral</p>
                        <p className={`text-lg font-extrabold tabular-nums tracking-[-0.03em] ${scoreColor(v.avg_score_overall)}`}>
                          {Number(v.avg_score_overall).toFixed(1)}<ValueUnit>/10</ValueUnit>
                        </p>
                      </div>
                      <div>
                        <p className={MICRO_LABEL}>Alinhamento</p>
                        <p className={`text-lg font-extrabold tabular-nums tracking-[-0.03em] ${scoreColor(v.avg_score_goal_align)}`}>
                          {Number(v.avg_score_goal_align).toFixed(1)}<ValueUnit>/10</ValueUnit>
                        </p>
                      </div>
                      <div>
                        <p className={MICRO_LABEL}>Conversas</p>
                        <p className="text-lg font-extrabold tabular-nums tracking-[-0.03em]">{v.total_conversations}</p>
                      </div>
                      <div>
                        <p className={MICRO_LABEL}>Taxa Qualif.</p>
                        <p className="text-lg font-extrabold tabular-nums tracking-[-0.03em] text-insights">
                          {Number(v.qualification_rate).toFixed(1)}<ValueUnit>%</ValueUnit>
                        </p>
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
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <TitleChip icon={MessageSquare} />
          <div className="min-w-0">
            <CardTitle>Últimas Avaliações</CardTitle>
            <CardDescription className="text-xs">Detalhamento das avaliações mais recentes com pontos de melhoria</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="mb-2 h-16 rounded-2xl" />)
          ) : (data?.evaluations || []).length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <MessageSquare className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <p className="text-sm font-semibold text-foreground/80">Nenhuma avaliação ainda</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(data?.evaluations || []).slice(0, 10).map((ev, i) => {
                const agent = data?.agents.find(a => a.id === ev.agent_id);
                return (
                  <div key={i} className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${scoreBg(ev.score_overall)}`}>
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`w-10 text-xl font-extrabold tabular-nums tracking-[-0.04em] ${scoreColor(ev.score_overall)}`}>
                        {Number(ev.score_overall).toFixed(1)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{agent?.name || "Agente"}</p>
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {new Date(ev.evaluated_at).toLocaleString("pt-BR")}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>Rel: <strong className={`tabular-nums ${scoreColor(ev.score_relevance)}`}>{Number(ev.score_relevance).toFixed(1)}</strong></span>
                      <span>Tom: <strong className={`tabular-nums ${scoreColor(ev.score_tone)}`}>{Number(ev.score_tone).toFixed(1)}</strong></span>
                      <span>Obj: <strong className={`tabular-nums ${scoreColor(ev.score_goal_align)}`}>{Number(ev.score_goal_align).toFixed(1)}</strong></span>
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
