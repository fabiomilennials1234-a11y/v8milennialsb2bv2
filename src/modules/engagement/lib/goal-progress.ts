/**
 * Resolução de metas de reunião (ADR-0007 / CONTEXT.md):
 * - `reunioes_marcadas` mede Reuniões Marcadas (período da marcação)
 * - `reunioes_realizadas` mede Reuniões Realizadas (período da reunião)
 * - legado `reunioes` = realizadas; perde pro tipo novo quando ambos existem
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
