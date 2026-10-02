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
import { FocusCard, IconChip, InkPanel, InkRow, InkSplit, KpiRow, KpiTile, ValueUnit } from "@/components/ui/bento";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { CopilotTabs } from "@/modules/copilot/components/CopilotTabs";
import { FilterRow } from "@/shared/components/PillSearch";
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
  agent_id?: string;
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

/** Uma casa decimal, com vírgula (pt-BR). */
const fmt1 = (n: number) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Só tokens: o par claro/escuro vem do tema, não de uma escala de cor crua.
function scoreColor(score: number): string {
  if (score >= 8) return "text-success-strong";
  if (score >= 6) return "text-warning-strong";
  return "text-destructive";
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
        <span className={`font-bold tabular-nums ${scoreColor(score)}`}>{fmt1(score)}</span>
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
  if (trend === 'up') return <TrendingUp className="w-4 h-4 text-success-strong" aria-label="Em alta" />;
  if (trend === 'down') return <TrendingDown className="w-4 h-4 text-destructive" aria-label="Em queda" />;
  return <Minus className="w-4 h-4 text-muted-foreground" aria-label="Estável" />;
}

/** Ícone do título do cartão num chip neutro — o vocabulário do bento. */
function TitleChip({ icon: Icon }: { icon: typeof Bot }) {
  return (
    <IconChip icon={Icon} />
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function CopilotMetrics() {
  const { data: teamMember } = useCurrentTeamMember();
  const orgId = teamMember?.organization_id;
  const navigate = useNavigate();
  const [selectedAgent, setSelectedAgent] = useState("all");
  const [days, setDays] = useState(30);
  const [abAgentId, setAbAgentId] = useState<string | null>(null);

  const { data, isLoading } = useCopilotMetrics(orgId, selectedAgent, days);

  const agentSummaries = data ? computeAgentSummaries(data.evaluations, data.agents) : [];
  const globalAvg = agentSummaries.length
    ? agentSummaries.reduce((s, a) => s + a.avg_overall, 0) / agentSummaries.length
    : 0;
  const totalEvals = data?.evaluations.length || 0;
  const qualRate = (data?.totalLeads ? (data.qualifiedLeads / data.totalLeads) * 100 : 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const variants = (data?.variants || []).filter(v => v.total_conversations > 0);

  const kpi = (v: React.ReactNode) => (isLoading ? "·" : v);

  // Médias por critério sobre TODAS as avaliações do recorte — o radar e as
  // barras de "Qualidade das respostas". Mesmo dado que o cartão antigo
  // mostrava por agente, só agregado.
  const evals = data?.evaluations || [];
  const criteria = CRITERIA.map((c) => ({
    ...c,
    value: evals.length ? evals.reduce((sum, e) => sum + (Number(e[c.field]) || 0), 0) / evals.length : 0,
  }));
  const worst = [...evals].sort((x, y) => x.score_overall - y.score_overall).slice(0, 5);
  const agentName = (id: string) => data?.agents.find((a) => a.id === id)?.name || "Agente";

  // Testes A/B agrupados por agente: a lista em tinta escolhe o agente, o
  // cartão de ouro põe as variantes lado a lado.
  const abAgents = [...new Set(variants.map((v) => v.agent_id ?? "sem-agente"))];
  const abFocus = abAgents.includes(abAgentId ?? "") ? abAgentId! : abAgents[0] ?? null;
  const abVariants = variants.filter((v) => (v.agent_id ?? "sem-agente") === abFocus);
  const leader = abVariants.length > 1
    ? [...abVariants].sort((x, y) => Number(y.qualification_rate) - Number(x.qualification_rate))[0]
    : null;
  const leaderIsUnique =
    !!leader && abVariants.filter((v) => Number(v.qualification_rate) === Number(leader.qualification_rate)).length === 1;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Copilot"
        subtitle="Qualidade das respostas dos agentes, avaliada automaticamente por IA."
        tabs={<CopilotTabs active="metricas" agentId={selectedAgent !== "all" ? selectedAgent : data?.agents[0]?.id ?? null} />}
      />

      <FilterRow>
        <span className="mr-1 shrink-0 text-[13px] font-bold text-foreground/80">Período</span>
        <div role="radiogroup" aria-label="Período" className="inline-flex shrink-0 rounded-full bg-muted p-[3px]">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={days === d}
              onClick={() => setDays(d)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                days === d ? "bg-card text-foreground shadow-relevo" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {d} dias
            </button>
          ))}
        </div>
        <Select value={selectedAgent} onValueChange={setSelectedAgent}>
          <SelectTrigger className="h-[34px] w-52 shrink-0 rounded-full text-xs" aria-label="Agente">
            <SelectValue placeholder="Todos os agentes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os agentes</SelectItem>
            {(data?.agents || []).map(a => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterRow>

      {/* KPIs — mesmos quatro números de antes, da mesma consulta. */}
      <KpiRow cols={4}>
        <KpiTile
          label="Agentes Ativos"
          icon={Bot}
          tone="gold"
          loading={isLoading}
          value={kpi(agentSummaries.length)}
          note="Com avaliações no período"
        />
        <KpiTile
          label="Score Geral"
          icon={Star}
          tone={isLoading || totalEvals === 0 ? "neutral" : scoreTone(globalAvg)}
          loading={isLoading}
          value={kpi(
            totalEvals === 0 ? (
              "—"
            ) : (
              <span className={scoreColor(globalAvg)}>
                {globalAvg.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                <ValueUnit>/10</ValueUnit>
              </span>
            ),
          )}
          note="Média LLM-as-a-judge"
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
          label="Avaliações"
          icon={MessageSquare}
          tone="neutral"
          loading={isLoading}
          value={kpi(totalEvals.toLocaleString("pt-BR"))}
          note={`Últimos ${days} dias`}
        />
      </KpiRow>

      {/* Testes A/B — o painel em tinta da tela */}
      {isLoading ? (
        <Skeleton className="h-[260px] rounded-panel" />
      ) : variants.length === 0 ? (
        <InkPanel title="Testes A/B de prompt">
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <FlaskConical className="h-7 w-7 text-primary" />
            <p className="text-[14px] font-bold">Nenhum experimento com conversas</p>
            <p className="max-w-sm text-[12px] text-tinta-muted">Configure variantes de prompt nas configurações do agente.</p>
          </div>
        </InkPanel>
      ) : (
        <InkSplit
          title="Testes A/B de prompt"
          count={`${abAgents.length} ${abAgents.length === 1 ? "agente" : "agentes"}`}
          list={abAgents.map((id) => {
            const vs = variants.filter((v) => (v.agent_id ?? "sem-agente") === id);
            const best = Math.max(...vs.map((v) => Number(v.qualification_rate)));
            const selected = id === abFocus;
            return (
              <InkRow key={id} selected={selected} onClick={() => setAbAgentId(id)}>
                <span
                  className={cn(
                    "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[11px] text-[14px] font-extrabold",
                    selected ? "bg-primary-foreground text-primary" : "bg-white/[.07] text-primary",
                  )}
                >
                  {agentName(id).charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">{agentName(id)}</span>
                  <span className={cn("block text-[11px]", selected ? "text-primary-foreground/70" : "text-tinta-muted")}>
                    {vs.length} {vs.length === 1 ? "variante" : "variantes"}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold tabular-nums",
                    selected ? "bg-primary-foreground text-primary" : "bg-white/10 text-tinta-foreground",
                  )}
                >
                  {fmt1(best)}%
                </span>
              </InkRow>
            );
          })}
          detail={
            <FocusCard className="gap-4">
              <div>
                <p className="text-[11px] font-bold text-primary-foreground/70">Teste A/B · {agentName(abFocus ?? "")}</p>
                <h3 className="mt-1 text-[1.45rem] font-extrabold leading-tight tracking-[-0.03em]">Variantes de prompt</h3>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {abVariants.map((v) => {
                  const leading = leaderIsUnique && leader?.id === v.id;
                  return (
                    <div
                      key={v.id}
                      className={cn(
                        "flex min-w-0 flex-col gap-3 rounded-2xl p-4",
                        leading ? "bg-tinta text-tinta-foreground shadow-relevo-tinta" : "border border-primary-foreground/10 bg-primary-foreground/[.07]",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-bold">{v.name}</span>
                        {leading ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10.5px] font-bold text-primary-foreground">
                            <TrendingUp className="h-3 w-3" aria-hidden />
                            Liderando
                          </span>
                        ) : v.is_control ? (
                          <span className="shrink-0 rounded-full bg-primary-foreground px-2 py-0.5 text-[10.5px] font-bold text-primary">Controle</span>
                        ) : null}
                      </div>
                      <p className="flex items-baseline gap-1.5">
                        <span className="text-[2.2rem] font-extrabold leading-none tracking-[-0.045em] tabular-nums">
                          {fmt1(v.qualification_rate)}
                          <span className="text-[0.5em] opacity-60">%</span>
                        </span>
                        <span className={cn("text-[11px] font-semibold", leading ? "text-tinta-muted" : "text-primary-foreground/65")}>qualificação</span>
                      </p>
                      <p className={cn("text-[11.5px] tabular-nums", leading ? "text-tinta-muted" : "text-primary-foreground/70")}>
                        {v.total_conversations.toLocaleString("pt-BR")} conversas · {v.meetings_scheduled.toLocaleString("pt-BR")} reuniões ·
                        nota {fmt1(v.avg_score_overall)}
                      </p>
                    </div>
                  );
                })}
              </div>
              {abVariants.length < 2 && (
                <p className="text-[12px] text-primary-foreground/70">Só uma variante com conversas — o comparativo aparece quando a outra tiver.</p>
              )}
            </FocusCard>
          }
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Qualidade das respostas — radar + barras por critério */}
        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <TitleChip icon={Activity} />
            <div className="min-w-0">
              <CardTitle>Qualidade das respostas</CardTitle>
              <CardDescription className="text-xs">Nota de 0 a 10 dada pelo juiz em cada critério</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-56 rounded-2xl" />
            ) : evals.length === 0 ? (
              <EmptyEvaluations />
            ) : (
              <div className="grid items-center gap-5 sm:grid-cols-[220px_minmax(0,1fr)]">
                <QualityRadar values={criteria.map((c) => ({ label: c.short, value: c.value }))} />
                <div className="space-y-3">
                  {criteria.map((c) => (
                    <ScoreBar key={c.field} score={c.value} label={c.label} />
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Conversas com pior avaliação */}
        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <TitleChip icon={MessageSquare} />
            <div className="min-w-0">
              <CardTitle>Conversas com pior avaliação</CardTitle>
              <CardDescription className="text-xs">As cinco menores notas do período e o critério mais fraco de cada uma</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="mb-2 h-14 rounded-2xl" />)
            ) : worst.length === 0 ? (
              <EmptyEvaluations />
            ) : (
              <ul className="space-y-2">
                {worst.map((ev, i) => {
                  const weakest = CRITERIA.map((c) => ({ c, v: Number(ev[c.field]) || 0 })).sort((x, y) => x.v - y.v)[0];
                  return (
                    <li key={`${ev.agent_id}-${ev.evaluated_at}-${i}`} className="flex items-center gap-3 rounded-2xl bg-muted/40 px-3 py-2.5">
                      <ScoreRing score={ev.score_overall} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{agentName(ev.agent_id)}</p>
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {new Date(ev.evaluated_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <Badge variant={weakest.v < 6 ? "warning" : "soft"} className="shrink-0 text-[11px]">
                        {weakest.c.short} {fmt1(weakest.v)}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Desempenho por agente — tabela no lugar do antigo "Score por agente" */}
      <Card>
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <TitleChip icon={Bot} />
          <div className="min-w-0">
            <CardTitle>Desempenho por agente</CardTitle>
            <CardDescription className="text-xs">Médias do juiz no período · clique para abrir no editor</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {isLoading ? (
            <div className="px-6">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="mb-2 h-12 rounded-2xl" />)}</div>
          ) : agentSummaries.length === 0 ? (
            <div className="px-6"><EmptyEvaluations /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Agente</TableHead>
                    <TableHead className="text-right">Avaliações</TableHead>
                    <TableHead className="text-center">Nota</TableHead>
                    <TableHead className="text-right">Relevância</TableHead>
                    <TableHead className="text-right">Tom</TableHead>
                    <TableHead className="text-right">Concisão</TableHead>
                    <TableHead className="text-right">Alinhamento</TableHead>
                    <TableHead className="pr-6 text-center">Tendência</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agentSummaries.map((agent) => (
                    <TableRow
                      key={agent.agent_id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/copilot/${agent.agent_id}/editar`)}
                    >
                      <TableCell className="pl-6">
                        <span className="flex items-center gap-2.5">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-tinta text-[13px] font-extrabold text-primary">
                            {agent.agent_name.charAt(0).toUpperCase()}
                          </span>
                          <span className="truncate font-bold">{agent.agent_name}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{agent.evaluations}</TableCell>
                      <TableCell className="text-center"><ScoreRing score={agent.avg_overall} /></TableCell>
                      <TableCell className={`text-right font-bold tabular-nums ${scoreColor(agent.avg_relevance)}`}>{fmt1(agent.avg_relevance)}</TableCell>
                      <TableCell className={`text-right font-bold tabular-nums ${scoreColor(agent.avg_tone)}`}>{fmt1(agent.avg_tone)}</TableCell>
                      <TableCell className={`text-right font-bold tabular-nums ${scoreColor(agent.avg_conciseness)}`}>{fmt1(agent.avg_conciseness)}</TableCell>
                      <TableCell className={`text-right font-bold tabular-nums ${scoreColor(agent.avg_goal_align)}`}>{fmt1(agent.avg_goal_align)}</TableCell>
                      <TableCell className="pr-6"><span className="flex justify-center"><TrendIcon trend={agent.trend} /></span></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const CRITERIA: { field: "score_relevance" | "score_tone" | "score_conciseness" | "score_goal_align"; label: string; short: string }[] = [
  { field: "score_relevance", label: "Relevância", short: "Relevância" },
  { field: "score_tone", label: "Tom", short: "Tom" },
  { field: "score_conciseness", label: "Concisão", short: "Concisão" },
  { field: "score_goal_align", label: "Alinhamento com objetivo", short: "Alinhamento" },
];

function EmptyEvaluations() {
  return (
    <div className="py-8 text-center text-muted-foreground">
      <Activity className="mx-auto mb-2 h-8 w-8 opacity-50" />
      <p className="text-sm font-semibold text-foreground/80">Nenhuma avaliação no período</p>
      <p className="mt-1 text-xs">As avaliações são geradas automaticamente a cada 3 turnos de conversa</p>
    </div>
  );
}

/** Nota 0–10 num anel — o arco é a nota, a cor é a faixa (boa / média / ruim). */
function ScoreRing({ score }: { score: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, score / 10));
  const stroke = score >= 8 ? "hsl(var(--success))" : score >= 6 ? "hsl(var(--warning))" : "hsl(var(--destructive))";
  return (
    <span className="relative inline-grid h-10 w-10 shrink-0 place-items-center" aria-label={`Nota ${fmt1(score)} de 10`}>
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
        <circle cx="18" cy="18" r={r} fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${pct * c} ${c}`} />
      </svg>
      <span className="text-[11px] font-extrabold tabular-nums">{fmt1(score)}</span>
    </span>
  );
}

/** Radar de 4 eixos (0–10). Desenho simples em SVG, cores por token. */
function QualityRadar({ values }: { values: { label: string; value: number }[] }) {
  const size = 240;
  const cx = size / 2;
  const cy = size / 2;
  const R = 68;
  const n = values.length;
  const point = (i: number, v: number) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const rr = (Math.max(0, Math.min(10, v)) / 10) * R;
    return [cx + rr * Math.cos(ang), cy + rr * Math.sin(ang)] as const;
  };
  const ring = (k: number) => values.map((_, i) => point(i, k).join(",")).join(" ");
  const poly = values.map((v, i) => point(i, v.value).join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-[220px] w-[220px]" role="img" aria-label="Radar das notas por critério">
      {[2.5, 5, 7.5, 10].map((k) => (
        <polygon key={k} points={ring(k)} fill="none" stroke="hsl(var(--border))" strokeWidth="1" />
      ))}
      {values.map((_, i) => {
        const [x, y] = point(i, 10);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="hsl(var(--border))" strokeWidth="1" />;
      })}
      <polygon points={poly} fill="hsl(var(--primary) / 0.35)" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinejoin="round" />
      {values.map((v, i) => {
        const [x, y] = point(i, v.value);
        return <circle key={i} cx={x} cy={y} r="3.5" fill="hsl(var(--foreground))" />;
      })}
      {values.map((v, i) => {
        const [x, y] = point(i, 11.6);
        const anchor = Math.abs(x - cx) < 1 ? "middle" : x > cx ? "start" : "end";
        return (
          <text key={v.label} x={x} y={y} textAnchor={anchor} dominantBaseline="middle" className="fill-muted-foreground text-[10px] font-semibold">
            {v.label}
          </text>
        );
      })}
    </svg>
  );
}
