export interface PipelineCoverageInput {
  openPipelineValue: number;
  monthlyGoal: number | null;
}

export interface PipelineCoverageResult {
  ratio: number | null;
  label: string;
  status: "healthy" | "warning" | "critical" | "no-goal";
}

export function calculatePipelineCoverage(input: PipelineCoverageInput): PipelineCoverageResult {
  if (!input.monthlyGoal || input.monthlyGoal <= 0) {
    return { ratio: null, label: "Sem meta", status: "no-goal" };
  }

  const ratio = input.openPipelineValue / input.monthlyGoal;

  let status: PipelineCoverageResult["status"];
  if (ratio >= 3) status = "healthy";
  else if (ratio >= 1.5) status = "warning";
  else status = "critical";

  return {
    ratio,
    label: `${ratio.toFixed(1)}x`,
    status,
  };
}

export interface WinStreakInput {
  dates: string[];
}

export function calculateWinStreak(input: WinStreakInput): number {
  if (input.dates.length === 0) return 0;

  const sorted = [...input.dates]
    .map((d) => d.slice(0, 10))
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort()
    .reverse();

  const today = new Date().toISOString().slice(0, 10);
  if (sorted[0] !== today) return 0;

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diffMs = prev.getTime() - curr.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays === 1) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

export interface StaleLeadsSummary {
  total: number;
  critical: number;
  warning: number;
}

export function categorizeStaleLeads(
  leads: { days_inactive: number }[],
): StaleLeadsSummary {
  let critical = 0;
  let warning = 0;

  for (const lead of leads) {
    if (lead.days_inactive >= 14) critical++;
    else warning++;
  }

  return { total: leads.length, critical, warning };
}
