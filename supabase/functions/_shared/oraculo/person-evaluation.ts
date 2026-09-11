export const PERSON_PARTICIPATION_FLOOR = 10;
export const PERSON_TEAM_FLOOR = 4;

export type PersonMetric = "meetings" | "sales";

export function derivePracticedMetrics(input: {
  meetingsAssignments: number;
  salesAssignments: number;
  declaredMetric: PersonMetric | null;
}): { practicedMetrics: PersonMetric[]; declaredAbsence: PersonMetric | null } {
  const practicedMetrics: PersonMetric[] = [];
  if (input.meetingsAssignments > 0) practicedMetrics.push("meetings");
  if (input.salesAssignments > 0) practicedMetrics.push("sales");
  return {
    practicedMetrics,
    declaredAbsence: input.declaredMetric && !practicedMetrics.includes(input.declaredMetric)
      ? input.declaredMetric
      : null,
  };
}

export function evaluateParticipation(input: {
  currentAssignments: number;
  currentSuccesses: number;
  benchmarkRate: number;
  averageTicket: number;
  minimum?: number;
}):
  | { status: "insufficient_volume"; minimum: number; currentAssignments: number }
  | {
    status: "evaluable";
    currentRate: number;
    benchmarkRate: number;
    estimatedLeakedRevenue: number;
  } {
  const minimum = input.minimum ?? PERSON_PARTICIPATION_FLOOR;
  if (input.currentAssignments < minimum) {
    return { status: "insufficient_volume", minimum, currentAssignments: input.currentAssignments };
  }
  const currentRate = input.currentSuccesses / input.currentAssignments;
  const leakedUnits = Math.max(0, input.benchmarkRate * input.currentAssignments - input.currentSuccesses);
  return {
    status: "evaluable",
    currentRate,
    benchmarkRate: input.benchmarkRate,
    estimatedLeakedRevenue: leakedUnits * Math.max(0, input.averageTicket),
  };
}

export function resolveMemberBenchmark(input: {
  teamRates: number[];
  ownHistoricalRate: number;
  teamFloor?: number;
}): { basis: "team_median" | "own_history"; rate: number; sampleSize: number } {
  const rates = input.teamRates.filter(Number.isFinite).toSorted((a, b) => a - b);
  const sampleSize = rates.length;
  if (sampleSize < (input.teamFloor ?? PERSON_TEAM_FLOOR)) {
    return { basis: "own_history", rate: input.ownHistoricalRate, sampleSize };
  }
  const middle = Math.floor(sampleSize / 2);
  const rate = sampleSize % 2 === 0 ? (rates[middle - 1] + rates[middle]) / 2 : rates[middle];
  return { basis: "team_median", rate, sampleSize };
}
