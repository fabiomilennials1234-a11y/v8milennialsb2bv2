import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Target } from "lucide-react";
import { type MRREvolutionPoint } from "@/hooks/useAnalyticsFinanceiro";

interface Props {
  mrrEvolution: MRREvolutionPoint[];
  totalRevenue: number;
  newCustomers: number;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(1)}k`;
  return `R$ ${value.toFixed(0)}`;
}

interface ScenarioCardProps {
  label: string;
  projectedMRR: number;
  projectedRevenue: number;
  colorClass: string;
  bgClass: string;
}

function ScenarioCard({ label, projectedMRR, projectedRevenue, colorClass, bgClass }: ScenarioCardProps) {
  return (
    <div className={`rounded-xl border p-3 space-y-2 ${bgClass}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${colorClass}`}>{label}</p>
      <div>
        <p className="text-xs text-muted-foreground">Rec. Projetada</p>
        <p className={`text-lg font-bold ${colorClass}`}>{formatCurrency(projectedMRR)}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Receita Total (90d)</p>
        <p className="text-sm font-semibold">{formatCurrency(projectedRevenue)}</p>
      </div>
    </div>
  );
}

export function Projection90d({ mrrEvolution, totalRevenue, newCustomers }: Props) {
  // Calculate MRR growth rate from last 2 available months
  const validMonths = mrrEvolution.filter((m) => m.new_mrr > 0);
  const recentMonths = validMonths.slice(-3);

  let avgMonthlyGrowthRate = 0;
  if (recentMonths.length >= 2) {
    const rates: number[] = [];
    for (let i = 1; i < recentMonths.length; i++) {
      const prev = recentMonths[i - 1].new_mrr;
      const curr = recentMonths[i].new_mrr;
      if (prev > 0) rates.push((curr - prev) / prev);
    }
    if (rates.length > 0) {
      avgMonthlyGrowthRate = rates.reduce((a, b) => a + b, 0) / rates.length;
    }
  }

  // Base MRR: last month's net MRR or average
  const lastNetMRR = mrrEvolution.length > 0
    ? mrrEvolution[mrrEvolution.length - 1].net_mrr
    : 0;

  const baseMRR = Math.max(lastNetMRR, 0);

  // 3 month projections
  const pessimisticRate = avgMonthlyGrowthRate - 0.05; // subtract 5% growth
  const realisticRate = avgMonthlyGrowthRate;
  const optimisticRate = avgMonthlyGrowthRate + 0.05; // add 5% growth

  function projectMRR(rate: number, months: number): number {
    let mrr = baseMRR;
    for (let i = 0; i < months; i++) {
      mrr = mrr * (1 + rate);
    }
    return Math.max(mrr, baseMRR);
  }

  // Avg monthly revenue per customer to scale projections
  const avgMonthlyRevenue = totalRevenue > 0 && newCustomers > 0
    ? totalRevenue / Math.max(newCustomers, 1) / 3 // normalized to 90d window
    : 0;

  const pessimisticMRR = projectMRR(pessimisticRate, 3);
  const realisticMRR = projectMRR(realisticRate, 3);
  const optimisticMRR = projectMRR(optimisticRate, 3);

  // Project revenue as cumulative over 3 months
  const pessimisticRevenue = (baseMRR + pessimisticMRR) / 2 * 3 + avgMonthlyRevenue * newCustomers * 0.8 * 3;
  const realisticRevenue = (baseMRR + realisticMRR) / 2 * 3 + avgMonthlyRevenue * newCustomers * 1.0 * 3;
  const optimisticRevenue = (baseMRR + optimisticMRR) / 2 * 3 + avgMonthlyRevenue * newCustomers * 1.2 * 3;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Target className="h-4 w-4" />
          Projeção 90 dias
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2">
          <ScenarioCard
            label="Pessimista"
            projectedMRR={pessimisticMRR}
            projectedRevenue={pessimisticRevenue}
            colorClass="text-destructive"
            bgClass="bg-red-50/50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
          />
          <ScenarioCard
            label="Realista"
            projectedMRR={realisticMRR}
            projectedRevenue={realisticRevenue}
            colorClass="text-primary"
            bgClass="bg-primary/5 border-primary/20"
          />
          <ScenarioCard
            label="Otimista"
            projectedMRR={optimisticMRR}
            projectedRevenue={optimisticRevenue}
            colorClass="text-green-600"
            bgClass="bg-green-50/50 border-green-200 dark:bg-green-950/20 dark:border-green-800"
          />
        </div>
        <p className="text-xs text-muted-foreground mt-3 text-center">
          Baseado na taxa de crescimento dos últimos meses.
          {baseMRR === 0 && " Adicione dados de recorrência para projeções mais precisas."}
        </p>
      </CardContent>
    </Card>
  );
}
