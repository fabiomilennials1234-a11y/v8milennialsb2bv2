import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { runMutation } from "./guardrails.ts";

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

// Frozen clock so confirm_token expiry is deterministic.
const FIXED = 1_700_000_000_000;
const clock = (t: number) => ({ now: () => t });

Deno.test("runMutation — no token returns dry-run plan + exp.hash confirmToken, applies nothing", async () => {
  const calls: string[] = [];
  const res = await runMutation(spec(calls), { id: "lead-1" }, clock(FIXED));
  assertEquals(res.dryRun, true);
  assertEquals(res.applied, false);
  assertEquals(res.plan, { willDelete: "lead-1" });
  // token format: `${exp}.${hash}` with exp = now + 5min default window
  const [exp] = res.confirmToken!.split(".");
  assertEquals(Number(exp), FIXED + 5 * 60 * 1000);
  assertEquals(calls, []); // no apply, no audit
});

Deno.test("runMutation — correct token audits THEN applies", async () => {
  const calls: string[] = [];
  const dry = await runMutation(spec(calls), { id: "lead-1" }, clock(FIXED));
  const res = await runMutation(
    spec(calls),
    { id: "lead-1", confirm_token: dry.confirmToken },
    clock(FIXED + 1000), // still inside the window
  );
  assertEquals(res.applied, true);
  assertEquals(res.result, { deleted: "lead-1" });
  assertEquals(calls, ["audit", "apply"]); // audit-first
});

Deno.test("runMutation — wrong/malformed token rejects, applies nothing", async () => {
  const calls: string[] = [];
  await assertRejects(
    () => runMutation(spec(calls), { id: "lead-1", confirm_token: "deadbeef" }, clock(FIXED)),
    Error,
    "confirm_token",
  );
  assertEquals(calls, []);
});

Deno.test("runMutation — token for a different plan rejects (hash covers plan)", async () => {
  const calls: string[] = [];
  const dry = await runMutation(spec(calls), { id: "lead-1" }, clock(FIXED));
  // same token, but the plan now differs (different id) → hash mismatch
  await assertRejects(
    () =>
      runMutation(spec(calls), { id: "lead-2", confirm_token: dry.confirmToken }, clock(FIXED + 1)),
    Error,
    "mismatch",
  );
  assertEquals(calls, []);
});

Deno.test("runMutation — expired token rejects, applies nothing", async () => {
  const calls: string[] = [];
  const dry = await runMutation(spec(calls), { id: "lead-1" }, clock(FIXED));
  await assertRejects(
    () =>
      runMutation(
        spec(calls),
        { id: "lead-1", confirm_token: dry.confirmToken },
        clock(FIXED + 5 * 60 * 1000 + 1), // 1ms past the window
      ),
    Error,
    "expired",
  );
  assertEquals(calls, []);
});

Deno.test("runMutation — tampered expiry in token rejects via hash check", async () => {
  const calls: string[] = [];
  const dry = await runMutation(spec(calls), { id: "lead-1" }, clock(FIXED));
  const [, hash] = dry.confirmToken!.split(".");
  const forged = `${FIXED + 10 * 60 * 1000}.${hash}`; // push expiry out, keep old hash
  const err = await assertRejects(
    () => runMutation(spec(calls), { id: "lead-1", confirm_token: forged }, clock(FIXED + 1)),
    Error,
  );
  assertStringIncludes(err.message, "mismatch");
  assertEquals(calls, []);
});

Deno.test("runMutation — failed audit aborts before apply", async () => {
  const calls: string[] = [];
  const dry = await runMutation(
    { plan: (i: { id: string }) => ({ willDelete: i.id }), apply: () => ({}) },
    { id: "lead-1" },
    clock(FIXED),
  );
  await assertRejects(
    () =>
      runMutation(
        {
          plan: (i: { id: string }) => ({ willDelete: i.id }),
          apply: () => {
            calls.push("apply");
            return {};
          },
          audit: () => {
            throw new Error("audit write failed");
          },
        },
        { id: "lead-1", confirm_token: dry.confirmToken },
        clock(FIXED + 1),
      ),
    Error,
    "audit write failed",
  );
  assertEquals(calls, []); // apply never ran
});
