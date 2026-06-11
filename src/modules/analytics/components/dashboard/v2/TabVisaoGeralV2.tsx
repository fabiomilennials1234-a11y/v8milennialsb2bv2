import { memo, useMemo } from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { useTeamGoals, useFollowUps } from "@/modules/engagement";
import {
  useCommandMetrics,
  computePeriodRange,
  type CommandPeriod,
  type PeriodRange,
} from "@/modules/analytics/hooks/useCommandMetrics";
import { ClusterGauge } from "./ClusterGauge";
import { KpiCardCompact, type KpiDelta } from "./KpiCardCompact";
import { RevenueAccumulatedChart } from "./RevenueAccumulatedChart";
import { TrapezoidFunnel } from "./TrapezoidFunnel";
import { OraculoPanel, type OraculoInsight } from "./OraculoPanel";
import { LiveOpsFeed } from "./LiveOpsFeed";

interface TabVisaoGeralV2Props {
  period: CommandPeriod;
  month: number;
  year: number;
  range: PeriodRange;
  isAdmin: boolean;
  onAskOraculo: () => void;
}

const MONTH_LONG = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function formatK(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1).replace(".", ",")}K`;
  return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
}

function pctDelta(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

function deltaBadge(current: number, previous: number, invert = false): KpiDelta | undefined {
  const d = pctDelta(current, previous);
  if (d === null || Math.round(d) === 0) return undefined;
  const improved = invert ? d < 0 : d > 0;
  return { label: `${d > 0 ? "+" : ""}${Math.round(d)}%`, tone: improved ? "up" : "down" };
}

/** Dias úteis (seg–sex) restantes no mês, incluindo hoje. */
function businessDaysLeft(month: number, year: number): number {
  const now = new Date();
  const isCurrent = month === now.getMonth() + 1 && year === now.getFullYear();
  const startDay = isCurrent ? now.getDate() : 1;
  const totalDays = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = startDay; d <= totalDays; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return Math.max(count, 1);
}

function TabVisaoGeralV2Base({ period, month, year, range, isAdmin, onAskOraculo }: TabVisaoGeralV2Props) {
  // KPIs respeitam o filtro automático (membro vê o seu, admin vê total)
  const { data: metrics, isLoading } = useCommandMetrics({ start: range.start, end: range.end });
  // Funil é sempre total da org
  const { data: totalMetrics } = useCommandMetrics({ start: range.start, end: range.end }, null);
  // Período anterior pros deltas (mesmo filtro dos KPIs)
  const { data: prevMetrics } = useCommandMetrics({ start: range.prevStart, end: range.prevEnd });

  // Gauge é sempre mensal — meta de faturamento é do mês, independente do range selecionado
  const monthRange = useMemo(() => computePeriodRange("month", month, year), [month, year]);
  const { data: gaugeMetrics } = useCommandMetrics({ start: monthRange.start, end: monthRange.end }, null);
  const { data: teamGoals } = useTeamGoals(month, year);

  const { data: overdueFollowUps } = useFollowUps({ dateFilter: "overdue", showCompleted: false });
  const overdueCount = overdueFollowUps?.length ?? 0;

  const faturamentoGoal = useMemo(
    () => teamGoals?.find((g) => g.type === "faturamento" && g.target_value > 0),
    [teamGoals],
  );

  const gauge = useMemo(() => {
    const realized = gaugeMetrics?.vendaTotal ?? 0;
    const target = faturamentoGoal?.target_value ?? 0;
    const currentPercent = target > 0 ? (realized / target) * 100 : 0;
    const expectedPercent = (monthRange.dayOfPeriod / monthRange.daysTotal) * 100;
    const diffPp = Math.round(currentPercent - expectedPercent);
    const remaining = Math.max(target - realized, 0);
    const perBusinessDay = remaining / businessDaysLeft(month, year);
    return {
      currentPercent,
      expectedPercent,
      subtitle: `esperado ${Math.round(expectedPercent)}% · dia ${monthRange.dayOfPeriod} de ${monthRange.daysTotal}`,
      statusText: diffPp >= 0 ? `// NO RITMO +${diffPp}PP` : `// ATRASADO ${diffPp}PP`,
      isAhead: diffPp >= 0,
      realized,
      target,
      perBusinessDay,
    };
  }, [gaugeMetrics?.vendaTotal, faturamentoGoal?.target_value, monthRange, month, year]);

  const insights = useMemo<OraculoInsight[]>(() => {
    const out: OraculoInsight[] = [];
    if (!metrics || !prevMetrics) return out;
    const propDelta = pctDelta(metrics.propostasEnviadas, prevMetrics.propostasEnviadas);
    if (propDelta !== null && propDelta < -2) {
      out.push({
        tone: "attention",
        tag: "Atenção",
        content: (
          <>Propostas caíram <b>{Math.abs(Math.round(propDelta))}%</b> vs {range.prevLabel} — investigue a origem.</>
        ),
      });
    }
    if (overdueCount > 0) {
      out.push({
        tone: "opportunity",
        tag: "Oportunidade",
        content: (
          <><b>{overdueCount} follow-up{overdueCount > 1 ? "s" : ""}</b> atrasado{overdueCount > 1 ? "s" : ""} agora — potencial parado na base.</>
        ),
      });
    }
    const respDelta = pctDelta(metrics.tempoMedioResposta, prevMetrics.tempoMedioResposta);
    if (respDelta !== null && respDelta < -5 && metrics.tempoMedioResposta > 0) {
      out.push({
        tone: "highlight",
        tag: "Destaque",
        content: (
          <>Tempo de resposta caiu pra <b>{Math.round(metrics.tempoMedioResposta)}min</b> — {Math.abs(Math.round(respDelta))}% melhor que {range.prevLabel}.</>
        ),
      });
    }
    return out.slice(0, 3);
  }, [metrics, prevMetrics, overdueCount, range.prevLabel]);

  if (isLoading) {
    return (
      <div className="mt-3.5 grid grid-cols-12 gap-3.5">
        <Skeleton className="col-span-4 row-span-3 h-[460px] rounded-2xl" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="col-span-2 h-[100px] rounded-2xl" />
        ))}
        <Skeleton className="col-span-8 h-[210px] rounded-2xl" />
        <Skeleton className="col-span-4 h-[340px] rounded-2xl" />
        <Skeleton className="col-span-4 h-[340px] rounded-2xl" />
        <Skeleton className="col-span-4 h-[340px] rounded-2xl" />
      </div>
    );
  }

  const m = metrics;
  const p = prevMetrics;
  const convDeltaPp =
    m && p && p.taxaConversao > 0 ? m.taxaConversao - p.taxaConversao : null;

  const funnelConvPrev =
    isAdmin && p && p.totalLeads > 0 ? (p.novosClientes / p.totalLeads) * 100 : null;
  const funnelConvCur =
    totalMetrics && totalMetrics.totalLeads > 0
      ? (totalMetrics.funnelVendas / totalMetrics.totalLeads) * 100
      : null;

  return (
    <div className="mt-3.5 grid grid-cols-12 gap-3.5">
      {/* Velocímetro da meta */}
      <div
        className="cmd-cell cmd-rise col-span-4 row-span-3 flex flex-col p-5"
        style={{
          animationDelay: ".1s",
          background: "radial-gradient(300px 300px at 50% 42%, hsl(var(--primary)/.06), transparent 70%), hsl(var(--card))",
        }}
      >
        <div className="flex items-center justify-between">
          <span className="cmd-lbl">Meta do mês</span>
          <Link to="/gestao-metas" className="text-[11.5px] font-bold text-muted-foreground transition-colors hover:text-primary">
            Ajustar →
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center">
          {gauge.target > 0 ? (
            <ClusterGauge
              currentPercent={gauge.currentPercent}
              expectedPercent={gauge.expectedPercent}
              subtitle={gauge.subtitle}
              statusText={gauge.statusText}
              isAhead={gauge.isAhead}
            />
          ) : (
            <div className="px-6 text-center text-[13px] text-muted-foreground">
              Configure uma meta de faturamento pra ligar o velocímetro.
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 border-t border-border/70 pt-3.5 text-center">
          <div>
            <b className="block text-[15px] font-extrabold tracking-[-0.02em] tabular-nums">{formatK(gauge.realized)}</b>
            <span className="text-[11px] font-semibold text-muted-foreground/70">Realizado</span>
          </div>
          <div className="border-l border-border/70">
            <b className="block text-[15px] font-extrabold tracking-[-0.02em] tabular-nums">{gauge.target > 0 ? formatK(gauge.target) : "—"}</b>
            <span className="text-[11px] font-semibold text-muted-foreground/70">Meta</span>
          </div>
          <div className="border-l border-border/70">
            <b className="block text-[15px] font-extrabold tracking-[-0.02em] tabular-nums">{gauge.target > 0 ? formatK(gauge.perBusinessDay) : "—"}</b>
            <span className="text-[11px] font-semibold text-muted-foreground/70">Por dia útil</span>
          </div>
        </div>
      </div>

      {/* KPIs compactos */}
      <div className="col-span-2">
        <KpiCardCompact
          label="Leads" value={m?.totalLeads ?? 0} format="int"
          delta={m && p ? deltaBadge(m.totalLeads, p.totalLeads) : undefined}
          caption={`${p?.totalLeads ?? 0} ${range.prevLabel}`}
          quickActionLabel="Ver leads do período →" quickActionTo="/leads" delay={0.14}
        />
      </div>
      <div className="col-span-2">
        <KpiCardCompact
          label="Reuniões" value={m?.reunioesMarcadas ?? 0} format="int"
          delta={m && p ? deltaBadge(m.reunioesMarcadas, p.reunioesMarcadas) : undefined}
          caption={`${p?.reunioesMarcadas ?? 0} ${range.prevLabel}`}
          quickActionLabel="Abrir agenda →" quickActionTo="/agenda" delay={0.18}
        />
      </div>
      <div className="col-span-2">
        <KpiCardCompact
          label="Propostas" value={m?.propostasEnviadas ?? 0} format="int"
          delta={m && p ? deltaBadge(m.propostasEnviadas, p.propostasEnviadas) : undefined}
          caption={`${p?.propostasEnviadas ?? 0} ${range.prevLabel}`}
          quickActionLabel="Ver propostas →" quickActionTo="/pipe-propostas" delay={0.22}
        />
      </div>
      <div className="col-span-2">
        <KpiCardCompact
          label="Vendas" value={m?.novosClientes ?? 0} format="int"
          delta={m && p ? deltaBadge(m.novosClientes, p.novosClientes) : undefined}
          caption={`${p?.novosClientes ?? 0} ${range.prevLabel}`}
          quickActionLabel="Ver fechamentos →" quickActionTo="/pipe-propostas" delay={0.26}
        />
      </div>
      <div className="col-span-2">
        <KpiCardCompact
          label="Ticket" value={m?.ticketMedio ?? 0} format="currencyK"
          delta={m && p ? deltaBadge(m.ticketMedio, p.ticketMedio) : undefined}
          caption={`${formatK(p?.ticketMedio ?? 0)} ${range.prevLabel}`}
          quickActionLabel="Por produto →" quickActionTo="/produtos" delay={0.3}
        />
      </div>
      <div className="col-span-2">
        <KpiCardCompact
          label="Resposta" value={m?.tempoMedioResposta ?? 0} format="minutes"
          delta={m && p ? deltaBadge(m.tempoMedioResposta, p.tempoMedioResposta, true) : undefined}
          caption={`${Math.round(p?.tempoMedioResposta ?? 0)}min ${range.prevLabel}`}
          quickActionLabel="Por vendedor →" quickActionTo="/performance" delay={0.34}
        />
      </div>
      <div className="col-span-2">
        <KpiCardCompact
          label="Conversão" value={m?.taxaConversao ?? 0} format="percent"
          delta={
            convDeltaPp !== null && Math.round(convDeltaPp) !== 0
              ? { label: `${convDeltaPp > 0 ? "+" : ""}${Math.round(convDeltaPp)}pp`, tone: convDeltaPp > 0 ? "up" : "down" }
              : undefined
          }
          caption={`${Math.round(p?.taxaConversao ?? 0)}% ${range.prevLabel}`}
          quickActionLabel="Funil completo →" quickActionTo="/funis" delay={0.38}
        />
      </div>
      <div className="col-span-2">
        <KpiCardCompact
          label="Follow-ups" value={overdueCount} format="int"
          delta={overdueCount > 0 ? { label: String(overdueCount), tone: "down" } : undefined}
          caption="atrasados agora"
          quickActionLabel="Resolver agora →" quickActionTo="/follow-ups" delay={0.42}
        />
      </div>

      {/* Receita acumulada */}
      <div className="col-span-8">
        <RevenueAccumulatedChart
          daily={m?.dailySales ?? []}
          prevDaily={p?.dailySales ?? []}
          periodStart={range.start}
          prevStart={range.prevStart}
          dayOfPeriod={range.dayOfPeriod}
          daysTotal={range.daysTotal}
          totalRevenue={m?.vendaTotal ?? 0}
          deltaPct={m && p ? pctDelta(m.vendaTotal, p.vendaTotal) : null}
          currentLabel={period === "month" ? MONTH_LONG[month - 1] : "Período atual"}
          prevLabel={range.prevLabel.replace("em ", "")}
        />
      </div>

      {/* Funil + Oráculo + Feed */}
      <div className="col-span-4">
        <TrapezoidFunnel
          stages={[
            { label: "Leads", value: totalMetrics?.totalLeads ?? 0 },
            { label: "Reuniões", value: totalMetrics?.funnelReunioesMarcadas ?? 0 },
            { label: "Propostas", value: totalMetrics?.funnelPropostas ?? 0 },
            { label: "Vendas", value: totalMetrics?.funnelVendas ?? 0 },
          ]}
          deltaPp={funnelConvCur !== null && funnelConvPrev !== null ? funnelConvCur - funnelConvPrev : null}
          prevLabel={range.prevLabel.replace("em ", "vs ")}
        />
      </div>
      <div className="col-span-4">
        <OraculoPanel insights={insights} onAsk={onAskOraculo} />
      </div>
      <div className="col-span-4">
        <LiveOpsFeed />
      </div>
    </div>
  );
}

export const TabVisaoGeralV2 = memo(TabVisaoGeralV2Base);
