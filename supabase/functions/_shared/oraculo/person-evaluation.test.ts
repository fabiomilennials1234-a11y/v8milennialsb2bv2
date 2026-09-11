import { assertEquals } from "jsr:@std/assert@^1.0.0";
import {
  derivePracticedMetrics,
  evaluateParticipation,
  resolveMemberBenchmark,
} from "./person-evaluation.ts";

Deno.test("perfil de atuação — campo declarado sozinho não cria cobrança", () => {
  assertEquals(derivePracticedMetrics({
    meetingsAssignments: 0,
    salesAssignments: 0,
    declaredMetric: "meetings",
  }), {
    practicedMetrics: [],
    declaredAbsence: "meetings",
  });
});

Deno.test("perfil de atuação — prática pode contradizer o declarado", () => {
  assertEquals(derivePracticedMetrics({
    meetingsAssignments: 0,
    salesAssignments: 12,
    declaredMetric: "meetings",
  }), {
    practicedMetrics: ["sales"],
    declaredAbsence: "meetings",
  });
});

Deno.test("piso de participação — nove atribuições ficam marcadas e não comparadas", () => {
  assertEquals(evaluateParticipation({
    currentAssignments: 9,
    currentSuccesses: 2,
    benchmarkRate: 0.5,
    averageTicket: 1_000,
  }), {
    status: "insufficient_volume",
    minimum: 10,
    currentAssignments: 9,
  });
});

Deno.test("piso de participação — dez atribuições publicam impacto monetário", () => {
  assertEquals(evaluateParticipation({
    currentAssignments: 10,
    currentSuccesses: 2,
    benchmarkRate: 0.5,
    averageTicket: 1_000,
  }), {
    status: "evaluable",
    currentRate: 0.2,
    benchmarkRate: 0.5,
    estimatedLeakedRevenue: 3_000,
  });
});

Deno.test("piso de time — quatro pessoas permitem mediana anônima", () => {
  assertEquals(resolveMemberBenchmark({
    teamRates: [0.2, 0.4, 0.6, 0.8],
    ownHistoricalRate: 0.3,
  }), { basis: "team_median", rate: 0.5, sampleSize: 4 });
});

Deno.test("piso de time — três pessoas forçam histórico próprio", () => {
  assertEquals(resolveMemberBenchmark({
    teamRates: [0.2, 0.4, 0.6],
    ownHistoricalRate: 0.3,
  }), { basis: "own_history", rate: 0.3, sampleSize: 3 });
});
