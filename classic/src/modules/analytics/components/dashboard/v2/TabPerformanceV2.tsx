import { memo, useMemo } from "react";
import { RankingPodium } from "./RankingPodium";
import { ProductChampions } from "./ProductChampions";
import { TeamActivityCard } from "./TeamActivityCard";
import { LeadJourney } from "./LeadJourney";
import { TeamGoalsGauges, type TeamGoalGauge } from "./TeamGoalsGauges";
import { IndividualGoalsList } from "./IndividualGoalsList";
import { RealVsExpectedChart } from "./RealVsExpectedChart";
import { LossReasonsCard } from "./LossReasonsCard";
import { computePeriodRange, useCommandMetrics, type PeriodRange } from "@/modules/analytics/hooks/useCommandMetrics";
import { useFunnelHealth } from "@/modules/analytics/hooks/useFunnelHealth";
import { MILENNIALS_ORG_ID } from "@/modules/analytics/lib/org-overrides";
import { useTeamGoals } from "@/modules/engagement";
import { useCurrentTeamMember } from "@/modules/identity";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface TabPerformanceV2Props {
  section?: "ranking" | "produtos" | "atividade" | "jornada" | "metas-equipe" | "metas-individuais" | "perdas" | "real-esperado";
  month: number;
  year: number;
  /** Intervalo global do Comando (hoje/semana/mês/trim/personalizado). */
  range: PeriodRange;
  monthlyRange?: PeriodRange;
}

function formatK(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (value >= 1_000) return `R$ ${Math.round(value / 1_000)}K`;
  return `R$ ${Math.round(value)}`;
}

/**
 * Aba Performance do Comando v2 — pódio, metas da equipe, real vs esperado,
 * ganho/perda, metas individuais, produtos campeões, jornada e atividade.
 * Absorveu a antiga aba Inteligência (fusão 2026-06-11).
 */
function TabPerformanceV2Base({ month, year, range, monthlyRange, section }: TabPerformanceV2Props) {
  const show = (id: TabPerformanceV2Props["section"]) => !section || section === id;
  // Peças period-scoped (ranking, produtos, atividade, vendas, jornada, perda)
  // seguem o RANGE global — reagem a hoje/semana/mês/trim/personalizado.
  const { data: totalMetrics, isLoading, isError, refetch } = useCommandMetrics({ start: range.start, end: range.end }, null);

  // Metas são MENSAIS por natureza — a tabela `goals` é chaveada por month/year,
  // sem range. monthRange fixa o mês selecionado independentemente do período
  // global, pro gauge comparar realizado-do-mês vs meta-do-mês (mesmo padrão do
  // gauge da Visão Geral).
  const monthRange = useMemo(() => monthlyRange ?? computePeriodRange("month", month, year), [monthlyRange, month, year]);
  const gaugeQuery = useCommandMetrics({ start: monthRange.start, end: monthRange.end }, null);
  const goalsQuery = useTeamGoals(month, year);
  const { data: gaugeMetrics } = gaugeQuery;
  const { data: teamGoals } = goalsQuery;
  // Override Milennials: "reuniões marcadas" segue a coorte correta da aba
  // Saúde (get_funnel_health) em vez do get_dashboard_metrics inflado. Mensal,
  // pois alimenta o gauge de meta (também mensal).
  const { data: currentTeamMember } = useCurrentTeamMember();
  const isMilennials = currentTeamMember?.organization_id === MILENNIALS_ORG_ID;
  const { data: gaugeFunnel } = useFunnelHealth({ start: monthRange.start, end: monthRange.end });

  const expectedPercent = (monthRange.dayOfPeriod / monthRange.daysTotal) * 100;

  const gauges = useMemo<TeamGoalGauge[]>(() => {
    const out: TeamGoalGauge[] = [];
    const m = gaugeMetrics;
    const fat = teamGoals?.find((g) => g.type === "faturamento" && g.target_value > 0);
    if (fat) {
      out.push({
        label: "Faturamento",
        current: m?.vendaTotal ?? 0,
        target: fat.target_value,
        caption: `${formatK(m?.vendaTotal ?? 0)} / ${formatK(fat.target_value)}`,
      });
    }
    const cli = teamGoals?.find((g) => g.type === "clientes" && g.target_value > 0);
    if (cli) {
      out.push({
        label: "Clientes",
        current: m?.novosClientes ?? 0,
        target: cli.target_value,
        caption: `${m?.novosClientes ?? 0} / ${cli.target_value} novos`,
      });
    }
    // ADR-0007: metas novas separam realizadas (meeting_held) de marcadas
    // (meeting_booked); 'reunioes' legado segue como fallback de realizadas
    const reuRealizadas = teamGoals?.find((g) => g.type === "reunioes_realizadas" && g.target_value > 0)
      ?? teamGoals?.find((g) => g.type === "reunioes" && g.target_value > 0);
    if (reuRealizadas) {
      out.push({
        label: "Reuniões feitas",
        current: m?.reunioesComparecidas ?? 0,
        target: reuRealizadas.target_value,
        caption: `${m?.reunioesComparecidas ?? 0} / ${reuRealizadas.target_value} realizadas`,
      });
    }
    const reuMarcadas = teamGoals?.find((g) => g.type === "reunioes_marcadas" && g.target_value > 0);
    if (reuMarcadas) {
      const reuMarcadasValue = isMilennials
        ? (gaugeFunnel?.stages.reuniao ?? 0)
        : (m?.reunioesMarcadas ?? 0);
      out.push({
        label: "Reuniões marcadas",
        current: reuMarcadasValue,
        target: reuMarcadas.target_value,
        caption: `${reuMarcadasValue} / ${reuMarcadas.target_value} marcadas`,
      });
    }
    return out;
  }, [teamGoals, gaugeMetrics, isMilennials, gaugeFunnel]);

  const faturamentoGoal = teamGoals?.find((g) => g.type === "faturamento" && g.target_value > 0);

  const monthlyQueries = show("metas-equipe") || show("real-esperado") ? [gaugeQuery, goalsQuery] : [];
  if (isError || monthlyQueries.some((query) => query.isError)) return <div role="alert" className="p-4 text-sm">Não foi possível carregar a performance.<Button variant="link" onClick={() => { void refetch(); monthlyQueries.forEach((query) => void query.refetch()); }}>Tentar novamente</Button></div>;
  if (isLoading || monthlyQueries.some((query) => query.isLoading)) return <Skeleton className="h-full min-h-32 w-full" />;

  return (
    <div className={section ? "h-full [&>*]:h-full" : "mt-3.5 grid grid-cols-12 gap-3.5"}>
      {/* Peças period-scoped — seguem o range global */}
      {show("ranking") && <div className="col-span-8">
        <RankingPodium range={range} teamSalesTotal={totalMetrics?.vendaTotal ?? 0} />
      </div>}
      {show("produtos") && <div className="col-span-4">
        <ProductChampions range={range} />
      </div>}
      {show("atividade") && <div className="col-span-8">
        <TeamActivityCard range={range} />
      </div>}
      {show("jornada") && <div className="col-span-4">
        <LeadJourney
          startDate={range.start.toISOString()}
          endDate={range.end.toISOString()}
          totalSales={totalMetrics?.funnelVendas ?? 0}
        />
      </div>}

      {/* Blocos vindos da antiga aba Inteligência */}
      {show("metas-equipe") && <div className="col-span-5">
        <TeamGoalsGauges gauges={gauges} expectedPercent={expectedPercent} />
      </div>}
      {show("metas-individuais") && <div className="col-span-4">
        <IndividualGoalsList month={month} year={year} />
      </div>}
      {show("perdas") && <div className="col-span-3">
        <LossReasonsCard
          startDate={range.start.toISOString()}
          endDate={range.end.toISOString()}
          totalWon={totalMetrics?.funnelVendas ?? 0}
        />
      </div>}
      {show("real-esperado") && <div className="col-span-12">
        {/* Metas mensais: dailySales vem do gaugeMetrics (mês), não do range. */}
        <RealVsExpectedChart
          dailySales={gaugeMetrics?.dailySales ?? []}
          goalTarget={faturamentoGoal?.target_value ?? 0}
          month={month}
          year={year}
        />
      </div>}
    </div>
  );
}

export const TabPerformanceV2 = memo(TabPerformanceV2Base);
