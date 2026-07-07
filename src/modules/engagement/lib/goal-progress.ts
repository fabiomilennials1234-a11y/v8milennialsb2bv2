/**
 * Resolução de metas (ADR-0007 / ADR-0017 §6 / CONTEXT.md):
 * - `reunioes_marcadas` mede Reuniões Marcadas (período da marcação)
 * - `reunioes_realizadas` mede Reuniões Realizadas (período da reunião)
 * - legado `reunioes` = realizadas; perde pro tipo novo quando ambos existem
 * - meta de VENDA (faturamento/vendas/clientes) deriva do MESMO número canônico
 *   que o pódio e o dashboard mostram (get_ranking / get_sales_metrics), via
 *   resolveSalesGoalProgress. Uma barra, um pódio, um bônus OTE — um número só
 *   (mata o "3º formula" do finding #9 da auditoria 2026-07-02).
 */

export interface GoalLike {
  type: string;
  target_value: number;
}

export interface MeetingMetrics {
  reunioesMarcadas: number;
  reunioesComparecidas: number;
}

export interface MeetingGoalProgress {
  target: number;
  current: number;
  progress: number;
}

export interface MeetingGoals {
  marcadas: MeetingGoalProgress | null;
  realizadas: MeetingGoalProgress | null;
}

function toProgress(goal: GoalLike, current: number): MeetingGoalProgress {
  const target = goal.target_value;
  return {
    target,
    current,
    progress: target > 0 ? (current / target) * 100 : 0,
  };
}

/**
 * Progresso de uma meta de VENDA a partir do valor CANÔNICO (o mesmo que o pódio
 * e o dashboard exibem). Meta de faturamento/vendas-em-R$ → base sobre a receita
 * canônica (get_ranking.revenue == get_commission_ledger.base_revenue por membro,
 * invariante do #997); meta de contagem (vendas/clientes) → base sobre a contagem
 * canônica de vendas. UMA fórmula: `current / target * 100`. `target <= 0` → 0.
 */
export function resolveSalesGoalProgress(input: {
  goalTarget: number;
  goalIsRevenue: boolean;
  canonicalRevenue: number;
  canonicalSaleCount: number;
}): { target: number; current: number; progress: number } {
  const current = input.goalIsRevenue ? input.canonicalRevenue : input.canonicalSaleCount;
  const target = input.goalTarget;
  return {
    target,
    current,
    progress: target > 0 ? (current / target) * 100 : 0,
  };
}

export function resolveMeetingGoals(
  goals: GoalLike[],
  metrics: MeetingMetrics,
): MeetingGoals {
  const marcadasGoal = goals.find((g) => g.type === "reunioes_marcadas") ?? null;

  const realizadasGoal =
    goals.find((g) => g.type === "reunioes_realizadas") ??
    goals.find((g) => g.type === "reunioes") ??
    null;

  return {
    marcadas: marcadasGoal ? toProgress(marcadasGoal, metrics.reunioesMarcadas) : null,
    realizadas: realizadasGoal ? toProgress(realizadasGoal, metrics.reunioesComparecidas) : null,
  };
}
