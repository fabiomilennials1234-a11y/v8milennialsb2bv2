import { memo, useMemo } from "react";
import { RankingPodium } from "./RankingPodium";
import { ProductChampions } from "./ProductChampions";
import { TeamActivityCard } from "./TeamActivityCard";
import { LeadJourney } from "./LeadJourney";
import { TeamGoalsGauges, type TeamGoalGauge } from "./TeamGoalsGauges";
import { IndividualGoalsList } from "./IndividualGoalsList";
import { RealVsExpectedChart } from "./RealVsExpectedChart";
import { LossReasonsCard } from "./LossReasonsCard";
import { computePeriodRange, useCommandMetrics } from "@/modules/analytics/hooks/useCommandMetrics";
import { useFunnelHealth } from "@/modules/analytics/hooks/useFunnelHealth";
import { MILENNIALS_ORG_ID } from "@/modules/analytics/lib/org-overrides";
import { useTeamGoals } from "@/modules/engagement";
import { useCurrentTeamMember } from "@/modules/identity";

interface TabPerformanceV2Props {
  month: number;
  year: number;
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
function TabPerformanceV2Base({ month, year }: TabPerformanceV2Props) {
  const range = useMemo(() => computePeriodRange("month", month, year), [month, year]);
  const { data: totalMetrics } = useCommandMetrics({ start: range.start, end: range.end }, null);
  const { data: teamGoals } = useTeamGoals(month, year);
  // Override Milennials: "reuniões marcadas" segue a coorte correta da aba
  // Saúde (get_funnel_health) em vez do get_dashboard_metrics inflado.
  const { data: currentTeamMember } = useCurrentTeamMember();
  const isMilennials = currentTeamMember?.organization_id === MILENNIALS_ORG_ID;
  const { data: funnelHealth } = useFunnelHealth({ start: range.start, end: range.end });

  const expectedPercent = (range.dayOfPeriod / range.daysTotal) * 100;

  const gauges = useMemo<TeamGoalGauge[]>(() => {
    const out: TeamGoalGauge[] = [];
    const m = totalMetrics;
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
        ? (funnelHealth?.stages.reuniao ?? 0)
        : (m?.reunioesMarcadas ?? 0);
      out.push({
        label: "Reuniões marcadas",
        current: reuMarcadasValue,
        target: reuMarcadas.target_value,
        caption: `${reuMarcadasValue} / ${reuMarcadas.target_value} marcadas`,
      });
    }
    return out;
  }, [teamGoals, totalMetrics, isMilennials, funnelHealth]);

  const faturamentoGoal = teamGoals?.find((g) => g.type === "faturamento" && g.target_value > 0);

  return (
    <div className="mt-3.5 grid grid-cols-12 gap-3.5">
      {/* Performance original — intocada */}
      <div className="col-span-8">
        <RankingPodium month={month} year={year} teamSalesTotal={totalMetrics?.vendaTotal ?? 0} />
      </div>
      <div className="col-span-4">
        <ProductChampions month={month} year={year} />
      </div>
      <div className="col-span-8">
        <TeamActivityCard month={month} year={year} />
      </div>
      <div className="col-span-4">
        <LeadJourney
          startDate={range.start.toISOString()}
          endDate={range.end.toISOString()}
          totalSales={totalMetrics?.funnelVendas ?? 0}
        />
      </div>

      {/* Blocos vindos da antiga aba Inteligência */}
      <div className="col-span-5">
        <TeamGoalsGauges gauges={gauges} expectedPercent={expectedPercent} />
      </div>
      <div className="col-span-4">
        <IndividualGoalsList month={month} year={year} />
      </div>
      <div className="col-span-3">
        <LossReasonsCard
          startDate={range.start.toISOString()}
          endDate={range.end.toISOString()}
          totalWon={totalMetrics?.funnelVendas ?? 0}
        />
      </div>
      <div className="col-span-12">
        <RealVsExpectedChart
          dailySales={totalMetrics?.dailySales ?? []}
          goalTarget={faturamentoGoal?.target_value ?? 0}
          month={month}
          year={year}
        />
      </div>
    </div>
  );
}

export const TabPerformanceV2 = memo(TabPerformanceV2Base);
