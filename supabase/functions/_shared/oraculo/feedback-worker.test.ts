import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { type FeedbackWorkerDeps, processFeedbackWorker } from "./feedback-worker.ts";

function setup() {
  const sent: string[] = [];
  const finished: Array<{ id: string; sent: boolean }> = [];
  const deps: FeedbackWorkerDeps = {
    claimAlert: () => Promise.resolve(null),
    finishAlert: (id, ok) => {
      finished.push({ id, sent: ok });
      return Promise.resolve();
    },
    prepareWeekly: () => Promise.resolve(null),
    finishWeekly: (id, ok) => {
      finished.push({ id, sent: ok });
      return Promise.resolve();
    },
    send: (text) => {
      sent.push(text);
      return Promise.resolve({ ok: true });
    },
  };
  return { deps, sent, finished };
}

Deno.test("feedback worker — alerta pendente é enviado e concluído", async () => {
  const ctx = setup();
  let calls = 0;
  ctx.deps.claimAlert = () =>
    Promise.resolve(
      calls++ === 0
        ? {
          alertId: "alert-1",
          feedbackId: "feedback-1",
          organizationName: "Indústria Sol",
          comment: null,
        }
        : null,
    );

  const result = await processFeedbackWorker("alerts", ctx.deps);
  assertEquals(result, { processed: 1, sent: 1, failed: 0 });
  assertStringIncludes(ctx.sent[0], "Indústria Sol");
  assertEquals(ctx.finished, [{ id: "alert-1", sent: true }]);
});

Deno.test("feedback worker — resumo semanal vazio também é enviado", async () => {
  const ctx = setup();
  ctx.deps.prepareWeekly = () =>
    Promise.resolve({
      deliveryId: "digest-1",
      periodStart: "2026-08-25",
      periodEnd: "2026-08-31",
      conversations: 0,
      positive: 0,
      negative: 0,
      invented: 0,
    });

  const result = await processFeedbackWorker("weekly", ctx.deps);
  assertEquals(result, { processed: 1, sent: 1, failed: 0 });
  assertStringIncludes(ctx.sent[0], "0 conversas");
  assertEquals(ctx.finished, [{ id: "digest-1", sent: true }]);
});

Deno.test("feedback worker — semana já entregue é idempotente", async () => {
  const ctx = setup();
  const result = await processFeedbackWorker("weekly", ctx.deps);
  assertEquals(result, { processed: 0, sent: 0, failed: 0 });
  assertEquals(ctx.sent, []);
});
