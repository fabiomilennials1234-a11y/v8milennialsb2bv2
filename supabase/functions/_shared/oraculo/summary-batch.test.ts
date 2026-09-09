import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { processSummaryBatch } from "./summary-batch.ts";

Deno.test("resumo em lote — teto interno impede corrida de custo", async () => {
  let claimedLimit = 0;
  const result = await processSummaryBatch({
    claim: (limit) => {
      claimedLimit = limit;
      return Promise.resolve([]);
    },
    summarize: () => Promise.resolve(),
    finish: () => Promise.resolve(),
  }, 9999);

  assertEquals(claimedLimit, 20);
  assertEquals(result, { claimed: 0, completed: 0, failed: 0 });
});

Deno.test("resumo em lote — mede sucesso e falha por job", async () => {
  const finished: Array<[string, string | null]> = [];
  const result = await processSummaryBatch({
    claim: () =>
      Promise.resolve([
        { id: "job-1", leadId: "lead-1", instanceId: "box-1" },
        { id: "job-2", leadId: "lead-2", instanceId: "box-2" },
      ]),
    summarize: (job) =>
      job.id === "job-1" ? Promise.resolve() : Promise.reject(new Error("provider down")),
    finish: (id, error) => {
      finished.push([id, error]);
      return Promise.resolve();
    },
  }, 2);

  assertEquals(result, { claimed: 2, completed: 1, failed: 1 });
  assertEquals(finished, [["job-1", null], ["job-2", "provider down"]]);
});
