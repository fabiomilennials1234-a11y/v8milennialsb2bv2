import { assertEquals, assertRejects } from "@std/assert";
import { runMutation } from "./guardrails.ts";
import { sha256hex, stableStringify } from "./crypto.ts";

const spec = (calls: string[]) => ({
  plan: (input: { id: string }) => ({ willDelete: input.id }),
  apply: (_i: { id: string }, p: { willDelete: string }) => {
    calls.push("apply");
    return { deleted: p.willDelete };
  },
  audit: (_i: { id: string }, _p: unknown) => {
    calls.push("audit");
  },
});

Deno.test("runMutation — no token returns dry-run plan + confirmToken, applies nothing", async () => {
  const calls: string[] = [];
  const res = await runMutation(spec(calls), { id: "lead-1" });
  assertEquals(res.dryRun, true);
  assertEquals(res.applied, false);
  assertEquals(res.plan, { willDelete: "lead-1" });
  assertEquals(res.confirmToken, await sha256hex(stableStringify({ willDelete: "lead-1" })));
  assertEquals(calls, []); // no apply, no audit
});

Deno.test("runMutation — correct token audits THEN applies", async () => {
  const calls: string[] = [];
  const token = await sha256hex(stableStringify({ willDelete: "lead-1" }));
  const res = await runMutation(spec(calls), { id: "lead-1", confirm_token: token });
  assertEquals(res.applied, true);
  assertEquals(res.result, { deleted: "lead-1" });
  assertEquals(calls, ["audit", "apply"]); // audit-first
});

Deno.test("runMutation — wrong token rejects, applies nothing", async () => {
  const calls: string[] = [];
  await assertRejects(
    () => runMutation(spec(calls), { id: "lead-1", confirm_token: "deadbeef" }),
    Error,
    "confirm_token",
  );
  assertEquals(calls, []);
});

Deno.test("runMutation — failed audit aborts before apply", async () => {
  const calls: string[] = [];
  const token = await sha256hex(stableStringify({ willDelete: "lead-1" }));
  await assertRejects(
    () =>
      runMutation({
        plan: (i: { id: string }) => ({ willDelete: i.id }),
        apply: () => {
          calls.push("apply");
          return {};
        },
        audit: () => {
          throw new Error("audit write failed");
        },
      }, { id: "lead-1", confirm_token: token }),
    Error,
    "audit write failed",
  );
  assertEquals(calls, []); // apply never ran
});
