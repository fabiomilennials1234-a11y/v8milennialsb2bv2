import { memo, useMemo } from "react";
import { OraculoBriefing } from "./OraculoBriefing";
import { TeamGoalsGauges, type TeamGoalGauge } from "./TeamGoalsGauges";
import { IndividualGoalsList } from "./IndividualGoalsList";
import { RealVsExpectedChart } from "./RealVsExpectedChart";
import { LossReasonsCard } from "./LossReasonsCard";
import { computePeriodRange, useCommandMetrics } from "@/modules/analytics/hooks/useCommandMetrics";
import { useTeamGoals } from "@/modules/engagement";

interface TabInteligenciaV2Props {
  month: number;
  year: number;
}

function formatK(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (value >= 1_000) return `R$ ${Math.round(value / 1_000)}K`;
  return `R$ ${Math.round(value)}`;
}

/**
 * Aba Inteligência do Comando v2 — briefing do Oráculo, mini-gauges de metas,
 * metas individuais, real vs esperado e ganho/perda (mockup P1 aprovado).
 */
function TabInteligenciaV2Base({ month, year }: TabInteligenciaV2Props) {
  const range = useMemo(() => computePeriodRange("month", month, year), [month, year]);
  const { data: totalMetrics } = useCommandMetrics({ start: range.start, end: range.end }, null);
  const { data: teamGoals } = useTeamGoals(month, year);

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
    const reu = teamGoals?.find((g) => g.type === "reunioes" && g.target_value > 0);
    if (reu) {
      out.push({
        label: "Reuniões",
        current: m?.reunioesComparecidas ?? 0,
        target: reu.target_value,
        caption: `${m?.reunioesComparecidas ?? 0} / ${reu.target_value} feitas`,
      });
    }
    return out;
  }, [teamGoals, totalMetrics]);

  const faturamentoGoal = teamGoals?.find((g) => g.type === "faturamento" && g.target_value > 0);

  return (
    <div className="mt-3.5 grid grid-cols-12 gap-3.5">
      <div className="col-span-7">
        <OraculoBriefing />
      </div>
      <div className="col-span-5">
        <TeamGoalsGauges gauges={gauges} expectedPercent={expectedPercent} />
      </div>
      <div className="col-span-4">
        <IndividualGoalsList month={month} year={year} />
      </div>
      <div className="col-span-5">
        <RealVsExpectedChart
          dailySales={totalMetrics?.dailySales ?? []}
          goalTarget={faturamentoGoal?.target_value ?? 0}
          month={month}
          year={year}
        />
      </div>
      <div className="col-span-3">
        <LossReasonsCard
          startDate={range.start.toISOString()}
          endDate={range.end.toISOString()}
          totalWon={totalMetrics?.funnelVendas ?? 0}
        />
      </div>
    </div>
  );
}

export const TabInteligenciaV2 = memo(TabInteligenciaV2Base);
