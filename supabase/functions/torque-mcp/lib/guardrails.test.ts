import { assertEquals } from "@std/assert";
import { runMutation } from "./guardrails.ts";

Deno.test("runMutation — without confirm returns dry-run plan and does NOT apply", async () => {
  let applyCalled = false;
  const res = await runMutation(
    {
      plan: (input: { id: string }) => ({ willDelete: input.id }),
      apply: () => {
        applyCalled = true;
        return { deleted: true };
      },
    },
    { id: "lead-1" }, // no confirm
  );

  assertEquals(res.dryRun, true);
  assertEquals(res.applied, false);
  assertEquals(res.plan, { willDelete: "lead-1" });
  assertEquals(applyCalled, false); // critical: nothing happened
  assertEquals(res.result, undefined);
});

Deno.test("runMutation — with confirm applies and audits", async () => {
  const auditCalls: Array<unknown[]> = [];
  const res = await runMutation(
    {
      plan: (input: { id: string }) => ({ willDelete: input.id }),
      apply: (_input, plan) => ({ deleted: plan.willDelete }),
      audit: (input, plan, result) => {
        auditCalls.push([input, plan, result]);
      },
    },
    { id: "lead-1", confirm: true },
  );

  assertEquals(res.dryRun, false);
  assertEquals(res.applied, true);
  assertEquals(res.plan, { willDelete: "lead-1" });
  assertEquals(res.result, { deleted: "lead-1" });
  assertEquals(auditCalls.length, 1);
  assertEquals(auditCalls[0], [
    { id: "lead-1", confirm: true },
    { willDelete: "lead-1" },
    { deleted: "lead-1" },
  ]);
});
