import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DENYLIST_CACHE_TTL_MS,
  DENYLIST_MIN_EXHAUSTED,
  isPoisonCount,
  makePoisonChecker,
} from "./poison-denylist.ts";

Deno.test("isPoisonCount: threshold boundary", () => {
  assertEquals(isPoisonCount(DENYLIST_MIN_EXHAUSTED - 1), false);
  assertEquals(isPoisonCount(DENYLIST_MIN_EXHAUSTED), true);
  assertEquals(isPoisonCount(23_135), true);
  assertEquals(isPoisonCount(0), false);
  assertEquals(isPoisonCount(null), false);
  assertEquals(isPoisonCount(undefined), false);
});

Deno.test("checker: poison verdict cached within TTL (single count query)", async () => {
  let calls = 0;
  let clock = 1_000;
  const check = makePoisonChecker({
    countExhausted: () => {
      calls += 1;
      return Promise.resolve(DENYLIST_MIN_EXHAUSTED);
    },
    now: () => clock,
  });

  assertEquals(await check("tok-a"), true);
  clock += DENYLIST_CACHE_TTL_MS - 1;
  assertEquals(await check("tok-a"), true);
  assertEquals(calls, 1);
});

Deno.test("checker: verdict re-counted after TTL expires", async () => {
  let calls = 0;
  let clock = 1_000;
  const counts = [DENYLIST_MIN_EXHAUSTED, 0];
  const check = makePoisonChecker({
    countExhausted: () => Promise.resolve(counts[calls++] ?? 0),
    now: () => clock,
  });

  assertEquals(await check("tok-a"), true);
  clock += DENYLIST_CACHE_TTL_MS + 1;
  // DLQ rows resolved meanwhile -> token healed
  assertEquals(await check("tok-a"), false);
  assertEquals(calls, 2);
});

Deno.test("checker: fail-open on count failure with no prior verdict", async () => {
  const check = makePoisonChecker({
    countExhausted: () => Promise.resolve(null),
  });
  assertEquals(await check("tok-a"), false);
});

Deno.test("checker: count failure keeps last known verdict", async () => {
  let calls = 0;
  let clock = 1_000;
  const check = makePoisonChecker({
    countExhausted: () => {
      calls += 1;
      return Promise.resolve(calls === 1 ? DENYLIST_MIN_EXHAUSTED : null);
    },
    now: () => clock,
  });

  assertEquals(await check("tok-a"), true);
  clock += DENYLIST_CACHE_TTL_MS + 1;
  // Query fails after TTL -> stale poison verdict survives (fail-open, not fail-flip)
  assertEquals(await check("tok-a"), true);
});

Deno.test("checker: tokens are independent", async () => {
  const check = makePoisonChecker({
    countExhausted: (token) =>
      Promise.resolve(token === "poison" ? DENYLIST_MIN_EXHAUSTED : 0),
  });
  assertEquals(await check("poison"), true);
  assertEquals(await check("fresh"), false);
});
