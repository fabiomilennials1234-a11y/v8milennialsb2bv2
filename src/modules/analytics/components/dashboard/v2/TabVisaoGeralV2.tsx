import { memo, useMemo } from "react";
import { Link } from "react-router-dom";
import { AlarmClock, AlertTriangle, CalendarCheck, FileText, Handshake, Percent, Receipt, Timer, UserPlus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useTeamGoals, useFollowUps } from "@/modules/engagement";
import {
  useCommandMetrics,
  computePeriodRange,
  type CommandPeriod,
  type PeriodRange,
} from "@/modules/analytics/hooks/useCommandMetrics";
import { useFunnelHealth } from "@/modules/analytics/hooks/useFunnelHealth";
import { useTeamResponseTime } from "@/modules/analytics/hooks/useTeamResponseTime";
import { MILENNIALS_ORG_ID } from "@/modules/analytics/lib/org-overrides";
import { useCurrentTeamMember } from "@/modules/identity";
import { ClusterGauge } from "./ClusterGauge";
import { GaugeEmptyState } from "./GaugeEmptyState";
import { KpiCardCompact, type KpiDelta } from "./KpiCardCompact";
import { RevenueAccumulatedChart } from "./RevenueAccumulatedChart";
import { TrapezoidFunnel } from "./TrapezoidFunnel";
import { OraculoBriefing } from "./OraculoBriefing";
import { LiveOpsFeed } from "./LiveOpsFeed";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TabVisaoGeralV2Props {
  section?: "meta" | "kpis" | "receita" | "funil" | "oraculo" | "feed";
  period: CommandPeriod;
  month: number;
  year: number;
  range: PeriodRange;
  monthlyRange?: PeriodRange;
  isAdmin: boolean;
  onAskOraculo: () => void;
  filterMemberId?: string | null;
}

const MONTH_LONG = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * Faixa de KPIs: grade de 4 (ou 2) por linha. No celular vira carrossel com
 * snap, o mesmo gesto do `KpiRow` — mas em DUAS linhas, porque a janela tem
 * altura fixa: empilhados, os oito cartões abriam uma rolagem vertical dentro
 * da janela, dentro da rolagem do painel; numa linha só, sobrava meia janela
 * vazia. Altura natural dos cartões: esticá-los cortava a legenda em Edição.
 */
const KPI_GRID = cn(
  "grid auto-cols-[78%] grid-flow-col grid-rows-2 snap-x snap-mandatory gap-3 overflow-x-auto scrollbar-hide [&>*]:snap-start",
  "sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-2 sm:grid-rows-none sm:gap-4 sm:overflow-visible lg:grid-cols-4",
);
const CARTAO_AVULSO = "rounded-card border border-card-border bg-card p-5 shadow-relevo";
const ROTULO = "text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground";

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
function businessDaysLeft(month: number, year: number, referenceDay?: number): number {
  const now = new Date();
  const isCurrent = month === now.getMonth() + 1 && year === now.getFullYear();
  const startDay = referenceDay ?? (isCurrent ? now.getDate() : 1);
  const totalDays = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = startDay; d <= totalDays; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return Math.max(count, 1);
}

function TabVisaoGeralV2Base({ period, month, year, range, monthlyRange, isAdmin, onAskOraculo, section, filterMemberId }: TabVisaoGeralV2Props) {
  const show = (id: TabVisaoGeralV2Props["section"]) => !section || section === id;
  // KPIs respeitam o filtro automático (membro vê o seu, admin vê total)
  const { data: metrics, isLoading, isError, refetch } = useCommandMetrics({ start: range.start, end: range.end }, filterMemberId);
  // Funil é sempre total da org
  const { data: totalMetrics } = useCommandMetrics({ start: range.start, end: range.end }, null);
  // Override Milennials: reuniões marcadas do funil seguem a coorte correta da
  // aba Saúde (get_funnel_health) em vez do get_dashboard_metrics inflado.
  const { data: currentTeamMember } = useCurrentTeamMember();
  const isMilennials = currentTeamMember?.organization_id === MILENNIALS_ORG_ID;
  const { data: funnelHealth } = useFunnelHealth({ start: range.start, end: range.end });
  // Período anterior pros deltas (mesmo filtro dos KPIs)
  const { data: prevMetrics } = useCommandMetrics({ start: range.prevStart, end: range.prevEnd }, filterMemberId);
  const response = useTeamResponseTime({ start: range.start, end: range.end }, show("kpis"));
  const prevResponse = useTeamResponseTime({ start: range.prevStart, end: range.prevEnd }, show("kpis"));

  // Gauge é sempre mensal — meta de faturamento é do mês, independente do range selecionado
  const monthRange = useMemo(() => monthlyRange ?? computePeriodRange("month", month, year), [monthlyRange, month, year]);
  const gaugeQuery = useCommandMetrics({ start: monthRange.start, end: monthRange.end }, null);
  const goalsQuery = useTeamGoals(month, year);
  const { data: gaugeMetrics } = gaugeQuery;
  const { data: teamGoals } = goalsQuery;

  const { data: overdueFollowUps } = useFollowUps({ dateFilter: "overdue", showCompleted: false });
  const overdueCount = overdueFollowUps?.length ?? 0;

  // "Ver leads do período" precisa levar o período junto — sem isso a lista abre
  // com os leads todos e o número do card fica impossível de conferir. As bordas
  // são as MESMAS que foram pra RPC (já cortadas no fuso da org), então a
  // contagem da lista reproduz exatamente o valor exibido aqui.
  const leadsPeriodLink = useMemo(
    () => `/leads?from=${encodeURIComponent(range.start.toISOString())}&to=${encodeURIComponent(range.end.toISOString())}`,
    [range.start, range.end],
  );

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
    const perBusinessDay = remaining / businessDaysLeft(month, year, monthlyRange?.dayOfPeriod);
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
  }, [gaugeMetrics?.vendaTotal, faturamentoGoal?.target_value, monthRange, monthlyRange, month, year]);


  const monthlyQueries = show("meta") ? [gaugeQuery, goalsQuery] : [];
  if (isError || monthlyQueries.some((query) => query.isError)) return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 py-4 text-center">
      <AlertTriangle className="h-5 w-5 text-destructive/80" aria-hidden />
      <p className="text-[13px] font-semibold">Não foi possível carregar os indicadores.</p>
      <Button variant="outline" size="sm" onClick={() => { void refetch(); monthlyQueries.forEach((query) => void query.refetch()); }}>Tentar novamente</Button>
    </div>
  );
  if (isLoading || monthlyQueries.some((query) => query.isLoading)) {
    // Dentro de uma janela do Estúdio o esqueleto tem a forma do próprio bloco.
    if (section === "kpis") return (
      <div className={KPI_GRID}>
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="min-h-[96px] rounded-card" />)}
      </div>
    );
    if (section) return <Skeleton className="h-full min-h-32 w-full rounded-2xl" />;
    return (
      <div className="mt-3.5 grid grid-cols-2 gap-3.5 md:grid-cols-12">
        <Skeleton className="col-span-2 h-[200px] rounded-2xl md:col-span-4 md:row-span-3 md:h-[460px]" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="col-span-1 h-[100px] rounded-2xl md:col-span-2" />
        ))}
        <Skeleton className="col-span-2 h-[210px] rounded-2xl md:col-span-8" />
        <Skeleton className="col-span-2 h-[340px] rounded-2xl md:col-span-4" />
        <Skeleton className="col-span-2 h-[340px] rounded-2xl md:col-span-4" />
        <Skeleton className="col-span-2 h-[340px] rounded-2xl md:col-span-4" />
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

  // Dentro do Estúdio cada seção mora numa janela, e a janela JÁ é o cartão
  // (título, raio, sombra): o bloco desenha só o corpo. Sem `section` (grade
  // completa, hoje sem consumidor) cada bloco volta a ser o próprio cartão.
  const cartao = section ? "" : CARTAO_AVULSO;
  const kpiCol = section ? "min-w-0" : "col-span-1 md:col-span-2";

  return (
    <div className={section === "kpis" ? KPI_GRID : !section ? "grid grid-cols-2 gap-4 md:grid-cols-12" : "h-full [&>*]:h-full"}>
      {/* Velocímetro da meta */}
      {show("meta") && (
      <div className={cn("col-span-2 flex flex-col md:col-span-4 md:row-span-3", cartao)}>
        <div className="flex items-center justify-between gap-2">
          {!section && <span className={ROTULO}>Meta do mês</span>}
          <Link to="/gestao-metas" className="ml-auto text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
            Ajustar →
          </Link>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center">
          {gauge.target > 0 ? (
            <ClusterGauge
              currentPercent={gauge.currentPercent}
              expectedPercent={gauge.expectedPercent}
              subtitle={gauge.subtitle}
              statusText={gauge.statusText}
              isAhead={gauge.isAhead}
            />
          ) : (
            <GaugeEmptyState />
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="min-w-0 rounded-2xl bg-sunken px-1.5 py-2.5">
            <b className="block truncate text-[15px] font-extrabold tracking-[-0.03em] tabular-nums">{formatK(gauge.realized)}</b>
            <span className="text-[10.5px] font-bold uppercase tracking-[.06em] text-muted-foreground">Realizado</span>
          </div>
          <div className="min-w-0 rounded-2xl bg-sunken px-1.5 py-2.5">
            <b className="block truncate text-[15px] font-extrabold tracking-[-0.03em] tabular-nums">{gauge.target > 0 ? formatK(gauge.target) : "—"}</b>
            <span className="text-[10.5px] font-bold uppercase tracking-[.06em] text-muted-foreground">Meta</span>
          </div>
          <div className="min-w-0 rounded-2xl bg-sunken px-1.5 py-2.5">
            <b className="block truncate text-[15px] font-extrabold tracking-[-0.03em] tabular-nums">{gauge.target > 0 ? formatK(gauge.perBusinessDay) : "—"}</b>
            <span className="text-[10.5px] font-bold uppercase tracking-[.06em] text-muted-foreground">Por dia útil</span>
          </div>
        </div>
      </div>

      )}
      {/* KPIs compactos */}
      {show("kpis") && <>
      <div className={kpiCol}>
        <KpiCardCompact
          label="Leads novos" icon={UserPlus} tone="gold" value={m?.totalLeads ?? 0} format="int"
          delta={m && p ? deltaBadge(m.totalLeads, p.totalLeads) : undefined}
          caption={`${p?.totalLeads ?? 0} ${range.prevLabel}`}
          quickActionLabel="Ver leads do período →" quickActionTo={leadsPeriodLink} delay={0.14}
        />
      </div>
      <div className={kpiCol}>
        <KpiCardCompact
          label="Reuniões" icon={CalendarCheck} tone="info" value={m?.reunioesMarcadas ?? 0} format="int"
          delta={m && p ? deltaBadge(m.reunioesMarcadas, p.reunioesMarcadas) : undefined}
          caption={`${p?.reunioesMarcadas ?? 0} ${range.prevLabel}`}
          quickActionLabel="Abrir agenda →" quickActionTo="/agenda" delay={0.18}
        />
      </div>
      <div className={kpiCol}>
        <KpiCardCompact
          label="Propostas" icon={FileText} tone="neutral" value={m?.propostasEnviadas ?? 0} format="int"
          delta={m && p ? deltaBadge(m.propostasEnviadas, p.propostasEnviadas) : undefined}
          caption={`${p?.propostasEnviadas ?? 0} ${range.prevLabel}`}
          quickActionLabel="Ver propostas →" quickActionTo="/funis" delay={0.22}
        />
      </div>
      <div className={kpiCol}>
        <KpiCardCompact
          label="Vendas" icon={Handshake} tone="good" value={m?.novosClientes ?? 0} format="int"
          delta={m && p ? deltaBadge(m.novosClientes, p.novosClientes) : undefined}
          caption={`${p?.novosClientes ?? 0} ${range.prevLabel}`}
          quickActionLabel="Ver fechamentos →" quickActionTo="/funis" delay={0.26}
        />
      </div>
      <div className={kpiCol}>
        <KpiCardCompact
          label="Ticket" icon={Receipt} tone="neutral" value={m?.ticketMedio ?? 0} format="currencyK"
          delta={m && p ? deltaBadge(m.ticketMedio, p.ticketMedio) : undefined}
          caption={`${formatK(p?.ticketMedio ?? 0)} ${range.prevLabel}`}
          quickActionLabel="Por produto →" quickActionTo="/produtos" delay={0.3}
        />
      </div>
      <div className={kpiCol}>
        <KpiCardCompact
          label="Resposta da equipe" icon={Timer} tone="info" value={response.isError ? null : response.data ?? null} format="minutes"
          delta={!response.isError && !prevResponse.isError && response.data != null && prevResponse.data != null ? deltaBadge(response.data, prevResponse.data, true) : undefined}
          caption={response.isError ? "Resposta temporariamente indisponível" : response.isPending ? "Carregando respostas…" : response.data == null ? "Sem respostas medidas no período" : "WhatsApp · recebida até a próxima resposta"}
          quickActionLabel="Abrir conversas →" quickActionTo="/chat-whatsapp" delay={0.34}
        />
      </div>
      <div className={kpiCol}>
        <KpiCardCompact
          label="Conversão" icon={Percent} tone="gold" value={m?.taxaConversao ?? 0} format="percent"
          delta={
            convDeltaPp !== null && Math.round(convDeltaPp) !== 0
              ? { label: `${convDeltaPp > 0 ? "+" : ""}${Math.round(convDeltaPp)}pp`, tone: convDeltaPp > 0 ? "up" : "down" }
              : undefined
          }
          caption={`${Math.round(p?.taxaConversao ?? 0)}% ${range.prevLabel}`}
          quickActionLabel="Funil completo →" quickActionTo="/funis" delay={0.38}
        />
      </div>
      <div className={kpiCol}>
        <KpiCardCompact
          label="Follow-ups" icon={AlarmClock} tone="bad" value={overdueCount} format="int"
          delta={overdueCount > 0 ? { label: String(overdueCount), tone: "down" } : undefined}
          caption="atrasados agora"
          quickActionLabel="Resolver agora →" quickActionTo="/follow-ups" delay={0.42}
        />
      </div>

      </>}
      {/* Receita acumulada */}
      {show("receita") && (
      <div className={cn("col-span-2 md:col-span-8", cartao)}>
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

      )}
      {/* Funil + Oráculo + Feed */}
      {show("funil") && (
      <div className={cn("col-span-2 md:col-span-4", cartao)}>
        <TrapezoidFunnel
          stages={[
            { label: "Leads", value: totalMetrics?.totalLeads ?? 0 },
            { label: "Reuniões", value: isMilennials ? (funnelHealth?.stages.reuniao ?? 0) : (totalMetrics?.funnelReunioesMarcadas ?? 0) },
            { label: "Propostas", value: totalMetrics?.funnelPropostas ?? 0 },
            { label: "Vendas", value: totalMetrics?.funnelVendas ?? 0 },
          ]}
          deltaPp={funnelConvCur !== null && funnelConvPrev !== null ? funnelConvCur - funnelConvPrev : null}
          prevLabel={range.prevLabel.replace("em ", "vs ")}
        />
      </div>
      )}
      {show("oraculo") && <div className={cn("col-span-2 md:col-span-4", cartao)}><OraculoBriefing onAsk={onAskOraculo} /></div>}
      {show("feed") && <div className={cn("col-span-2 md:col-span-4", cartao)}><LiveOpsFeed /></div>}
    </div>
  );
}

export const TabVisaoGeralV2 = memo(TabVisaoGeralV2Base);
