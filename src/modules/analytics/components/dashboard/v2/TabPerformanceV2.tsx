import { memo, useMemo } from "react";
import { RankingPodium } from "./RankingPodium";
import { ProductChampions } from "./ProductChampions";
import { TeamActivityCard } from "./TeamActivityCard";
import { LeadJourney } from "./LeadJourney";
import { computePeriodRange, useCommandMetrics } from "@/modules/analytics/hooks/useCommandMetrics";

interface TabPerformanceV2Props {
  month: number;
  year: number;
}

/**
 * Aba Performance do Comando v2 — pódio com toggle vendas/reuniões, produtos
 * campeões, atividade da equipe legível e jornada do lead (mockup P1 aprovado).
 */
function TabPerformanceV2Base({ month, year }: TabPerformanceV2Props) {
  const range = useMemo(() => computePeriodRange("month", month, year), [month, year]);
  const { data: totalMetrics } = useCommandMetrics({ start: range.start, end: range.end }, null);

  return (
    <div className="mt-3.5 grid grid-cols-12 gap-3.5">
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
    </div>
  );
}

export const TabPerformanceV2 = memo(TabPerformanceV2Base);
